from __future__ import annotations

import base64
import ipaddress
import json
import logging
import os
import shutil
import socket
import subprocess
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse

import requests
from openai import OpenAI
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
FACEBOOK_UPLOADS = UPLOADS_ROOT / "facebook"
MAX_VIDEO_BYTES = 500 * 1024 * 1024
VIDEO_WIDTH = 1024
VIDEO_HEIGHT = 1536
FACEBOOK_VIDEO_HOSTS = {
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "web.facebook.com",
    "fb.watch",
}


@dataclass(frozen=True)
class ProcessedFacebookVideo:
    screenshot_url: str
    processed_video_url: str
    voice_over: str


def _public_upload_url(path: Path) -> str:
    relative = path.resolve().relative_to(UPLOADS_ROOT.resolve()).as_posix()
    return f"{settings.server_base_url.rstrip('/')}/uploads/{relative}"


def _safe_workspace_path(raw_url: str) -> Path | None:
    parsed = urlparse(raw_url)
    path = parsed.path if parsed.scheme else raw_url
    marker = "/uploads/"
    if marker not in path:
        return None
    suffix = path.split(marker, 1)[1]
    candidate = (UPLOADS_ROOT / suffix).resolve()
    try:
        candidate.relative_to(UPLOADS_ROOT.resolve())
    except ValueError:
        raise ValueError("Video path escapes the workspace uploads directory.")
    if not candidate.is_file():
        raise ValueError("Workspace video was not found.")
    return candidate


def _is_public_http_url(raw_url: str) -> bool:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror:
        return False
    for raw_address in addresses:
        address = ipaddress.ip_address(raw_address)
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            return False
    return True


def _is_facebook_video_url(raw_url: str) -> bool:
    parsed = urlparse(raw_url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    return parsed.scheme in {"http", "https"} and hostname in FACEBOOK_VIDEO_HOSTS


class _YtDlpLogger:
    def __init__(self, emit: Callable[[str], None]) -> None:
        self._emit = emit

    def debug(self, _message: str) -> None:
        return

    def warning(self, message: str) -> None:
        if message:
            self._emit(f"Facebook resolver warning: {str(message)[:500]}")

    def error(self, _message: str) -> None:
        return


def _download_facebook_source(
    raw_url: str,
    destination: Path,
    *,
    log: Callable[[str], None],
) -> None:
    if not _is_public_http_url(raw_url):
        raise ValueError("Facebook Reel URL must resolve to a public HTTPS address.")
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise RuntimeError(
            "Facebook Reel support is not installed in the backend container."
        ) from exc

    log("Resolving the public Facebook Reel video.")
    download_template = destination.with_name(
        f"{destination.stem}-facebook.%(ext)s"
    )
    options = {
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "outtmpl": str(download_template),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "overwrites": True,
        "continuedl": False,
        "retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 30,
        "max_filesize": MAX_VIDEO_BYTES,
        "logger": _YtDlpLogger(log),
    }
    cookie_file = os.getenv(
        "FACEBOOK_COOKIES_FILE",
        "/app/uploads/facebook/cookies.txt",
    ).strip()
    if cookie_file:
        cookie_path = Path(cookie_file).resolve()
        if cookie_path.is_file():
            options["cookiefile"] = str(cookie_path)

    prefix = f"{destination.stem}-facebook."
    destination.unlink(missing_ok=True)
    for stale in destination.parent.glob(f"{prefix}*"):
        if stale.is_file():
            stale.unlink(missing_ok=True)
    try:
        with YoutubeDL(options) as downloader:
            downloader.extract_info(raw_url, download=True)
    except DownloadError as exc:
        for artifact in destination.parent.glob(f"{prefix}*"):
            if artifact.is_file():
                artifact.unlink(missing_ok=True)
        raise ValueError(
            "Facebook could not provide the Reel video. Make sure the Reel is public, "
            "or upload the video to the workspace. If Facebook requires a login, "
            "configure FACEBOOK_COOKIES_FILE in the backend."
        ) from exc
    finally:
        for partial in destination.parent.glob(f"{prefix}*.part"):
            partial.unlink(missing_ok=True)

    candidates = [
        path
        for path in destination.parent.glob(f"{prefix}*")
        if path.is_file() and path.suffix.lower() not in {".part", ".ytdl", ".json"}
    ]
    if not candidates:
        raise ValueError(
            "Facebook Reel extraction finished without a downloadable video. "
            "Upload the original video to the workspace."
        )
    source = max(candidates, key=lambda path: path.stat().st_size)
    if source.stat().st_size > MAX_VIDEO_BYTES:
        for candidate in candidates:
            candidate.unlink(missing_ok=True)
        raise ValueError("Video exceeds the 500 MB limit.")
    shutil.move(str(source), str(destination))
    for candidate in candidates:
        if candidate != source:
            candidate.unlink(missing_ok=True)
    log(
        f"Downloaded Facebook Reel "
        f"({destination.stat().st_size / (1024 * 1024):.1f} MB)."
    )


def validate_video_file(path: Path) -> float:
    """Return video duration after ffprobe confirms the file is complete and decodable."""
    if not path.is_file() or path.stat().st_size < 1024:
        raise ValueError(
            "The source video is empty or incomplete. Upload the original video again."
        )
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe is not installed in the backend container.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("The source video could not be inspected within 30 seconds.") from exc

    if probe.returncode != 0:
        technical = (probe.stderr or "ffprobe could not decode the file").strip()
        technical = " ".join(technical.split())[-600:]
        raise ValueError(
            "The source file is not a valid or complete video. Re-upload the original "
            f"MP4, MOV, or WebM file. ffprobe: {technical}"
        )
    try:
        duration = float(json.loads(probe.stdout or "{}").get("format", {}).get("duration") or 0)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("The source video has no readable duration.") from exc
    if duration <= 0:
        raise ValueError("The source video has no readable duration.")
    return duration


def _download_source(
    raw_url: str,
    destination: Path,
    *,
    log: Callable[[str], None] | None = None,
) -> None:
    emit = log or (lambda _message: None)
    workspace_path = _safe_workspace_path(raw_url)
    if workspace_path is not None:
        emit("Copying video from the workspace upload volume.")
        shutil.copyfile(workspace_path, destination)
        return
    if _is_facebook_video_url(raw_url):
        _download_facebook_source(raw_url, destination, log=emit)
        return
    current_url = raw_url
    for _ in range(6):
        if not _is_public_http_url(current_url):
            raise ValueError("Direct Link must be a workspace upload or a public HTTP(S) video URL.")
        response = requests.get(
            current_url,
            stream=True,
            timeout=(15, 180),
            allow_redirects=False,
        )
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise ValueError("Video download redirect did not include a destination.")
            current_url = urljoin(current_url, location)
            continue
        with response:
            response.raise_for_status()
            media_type = (
                (response.headers.get("Content-Type") or "")
                .split(";", 1)[0]
                .strip()
                .lower()
            )
            if media_type.startswith("text/") or media_type in {
                "application/json",
                "application/xml",
            }:
                raise ValueError(
                    f"Direct Link returned {media_type}, not a video file. Upload the "
                    "video to the workspace and use its generated URL."
                )
            content_length = int(response.headers.get("Content-Length") or 0)
            if content_length > MAX_VIDEO_BYTES:
                raise ValueError("Video exceeds the 500 MB limit.")
            written = 0
            with destination.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > MAX_VIDEO_BYTES:
                        raise ValueError("Video exceeds the 500 MB limit.")
                    output.write(chunk)
            emit(f"Downloaded source video ({written / (1024 * 1024):.1f} MB).")
            return
    raise ValueError("Video download followed too many redirects.")


def _prompt(template: str, title: str) -> str:
    return template.replace("{recipe_title}", title)


class FacebookVideoProcessor:
    """FastAPI-facing version of the supplied imagetovideo V2.py pipeline."""

    def process(
        self,
        *,
        content_id: uuid.UUID,
        source_url: str,
        recipe_title: str,
        openai_api_key: str,
        script_prompt: str,
        recipe_card_prompt: str,
        log: Callable[[str], None] | None = None,
    ) -> ProcessedFacebookVideo:
        emit = log or (lambda _message: None)
        if not openai_api_key:
            raise ValueError("OpenAI API key is required for Facebook video generation.")

        # Import lazily so the API can boot and report a clear pipeline error if
        # a worker image was deployed without its optional video dependencies.
        try:
            from moviepy import AudioFileClip, CompositeVideoClip, ImageClip, VideoFileClip
        except ImportError as exc:
            raise RuntimeError("MoviePy is not installed in the backend environment.") from exc

        work_dir = FACEBOOK_UPLOADS / str(content_id)
        work_dir.mkdir(parents=True, exist_ok=True)
        source_path = work_dir / "source.mp4"
        silent_path = work_dir / "source-silent.mp4"
        screenshot_path = work_dir / "first-frame.jpg"
        audio_path = work_dir / "voice-over.mp3"
        recipe_card_path = work_dir / "recipe-card.png"
        output_path = work_dir / "processed-video.mp4"

        emit("Preparing source video.")
        _download_source(source_url, source_path, log=emit)
        duration = validate_video_file(source_path)
        emit(f"Video validated ({duration:.1f} seconds).")
        client = OpenAI(api_key=openai_api_key)

        try:
            clip = VideoFileClip(str(source_path))
        except Exception as exc:
            raise ValueError(
                "The validated source video could not be opened by MoviePy. "
                "Re-encode it as H.264 MP4 and upload it again."
            ) from exc
        try:
            frame_at = min(0.05, max(0.0, float(clip.duration or 0) / 2))
            frame = clip.get_frame(frame_at)
            Image.fromarray(frame).convert("RGB").save(screenshot_path, quality=94)
            emit("Captured the first video frame.")

            # Always render a silent intermediate, even when no audio track exists.
            silent_clip = clip.without_audio()
            try:
                silent_clip.write_videofile(
                    str(silent_path),
                    codec="libx264",
                    audio=False,
                    fps=clip.fps or 30,
                    logger=None,
                )
                emit("Removed the original video audio.")
            finally:
                silent_clip.close()
        finally:
            clip.close()

        script_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _prompt(script_prompt, recipe_title)}],
            temperature=1,
        )
        voice_over = (script_response.choices[0].message.content or "").strip()
        if not voice_over:
            raise ValueError("OpenAI returned an empty Facebook voice-over.")
        emit("Generated the voice-over script.")

        with client.audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts",
            voice="nova",
            input=voice_over,
        ) as response:
            response.stream_to_file(audio_path)
        emit("Generated the voice-over audio.")

        with screenshot_path.open("rb") as screenshot:
            image_result = client.images.edit(
                model="gpt-image-2",
                image=screenshot,
                prompt=_prompt(recipe_card_prompt, recipe_title),
                quality="low",
                size=f"{VIDEO_WIDTH}x{VIDEO_HEIGHT}",
            )
        image_base64 = image_result.data[0].b64_json
        if not image_base64:
            raise ValueError("OpenAI returned an empty Facebook recipe card.")
        image_bytes = base64.b64decode(image_base64)
        card = Image.open(BytesIO(image_bytes)).convert("RGB")
        card = card.resize((VIDEO_WIDTH, VIDEO_HEIGHT), Image.Resampling.LANCZOS)
        card.save(recipe_card_path, quality=96)
        emit("Generated the vertical recipe card.")

        audio = AudioFileClip(str(audio_path))
        source = VideoFileClip(str(silent_path))
        layers = []
        try:
            duration = float(audio.duration or 0)
            if duration <= 0:
                raise ValueError("Generated Facebook voice-over has no duration.")
            lead_duration = min(5.0, duration, float(source.duration or 0))
            lead = source.subclipped(0, lead_duration).resized(height=VIDEO_HEIGHT)
            lead = lead.cropped(
                x_center=lead.w / 2,
                y_center=lead.h / 2,
                width=VIDEO_WIDTH,
                height=VIDEO_HEIGHT,
            )
            layers.append(lead)
            remaining = max(0.0, duration - lead_duration)
            if remaining > 0:
                card_clip = (
                    ImageClip(str(recipe_card_path))
                    .with_duration(remaining)
                    .with_start(lead_duration)
                    .resized((VIDEO_WIDTH, VIDEO_HEIGHT))
                    .with_position(("center", "center"))
                )
                layers.append(card_clip)
            final = CompositeVideoClip(layers, size=(VIDEO_WIDTH, VIDEO_HEIGHT)).with_audio(audio)
            try:
                final.write_videofile(
                    str(output_path),
                    fps=30,
                    codec="libx264",
                    audio_codec="aac",
                    bitrate="8000k",
                    logger=None,
                )
                emit("Rendered the final Facebook video.")
            finally:
                final.close()
        finally:
            for layer in layers:
                layer.close()
            source.close()
            audio.close()

        return ProcessedFacebookVideo(
            screenshot_url=_public_upload_url(screenshot_path),
            processed_video_url=_public_upload_url(output_path),
            voice_over=voice_over,
        )
