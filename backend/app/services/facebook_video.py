from __future__ import annotations

import base64
import ipaddress
import json
import logging
import math
import os
import shutil
import socket
import subprocess
import uuid
from dataclasses import dataclass
from http.cookiejar import LoadError, MozillaCookieJar
from io import BytesIO
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from openai import OpenAI
from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)

UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
FACEBOOK_UPLOADS = UPLOADS_ROOT / "facebook"
MAX_VIDEO_BYTES = 500 * 1024 * 1024
MAX_FACEBOOK_HTML_BYTES = 12 * 1024 * 1024
FACEBOOK_REEL_MIN_WIDTH = 540
FACEBOOK_REEL_MIN_HEIGHT = 960
FACEBOOK_REEL_MIN_FPS = 23.0
FACEBOOK_REEL_MIN_DURATION = 4.0
FACEBOOK_REEL_MAX_DURATION = 60.0
VIDEO_FORMAT_DIMENSIONS = {
    "2:3": (1024, 1536),
    "9:16": (1080, 1920),
    "4:5": (1080, 1350),
    "1:1": (1080, 1080),
}
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


def video_dimensions(video_format: str) -> tuple[int, int]:
    """Return the validated even-sized output dimensions for a project preset."""
    try:
        return VIDEO_FORMAT_DIMENSIONS[video_format]
    except KeyError as exc:
        raise ValueError(f"Unsupported Facebook video format: {video_format}") from exc


def _cover_resize_dimensions(
    source_width: float,
    source_height: float,
    target_width: int,
    target_height: int,
) -> tuple[int, int]:
    """Scale a frame until it fully covers the target without black padding."""
    if min(source_width, source_height, target_width, target_height) <= 0:
        raise ValueError("Video dimensions must be positive.")
    scale = max(target_width / source_width, target_height / source_height)
    width = max(target_width, math.ceil(source_width * scale))
    height = max(target_height, math.ceil(source_height * scale))
    # libx264/yuv420p requires even dimensions.
    return width + width % 2, height + height % 2


def _recipe_card_size(width: int, height: int) -> str:
    """Return a gpt-image-2 size at least as large as the final video frame."""

    if width <= 0 or height <= 0:
        raise ValueError("Recipe card dimensions must be positive.")
    aligned_width = math.ceil(width / 16) * 16
    aligned_height = math.ceil(height / 16) * 16
    return f"{aligned_width}x{aligned_height}"


def _prepare_recipe_card(card: Image.Image, width: int, height: int) -> Image.Image:
    """Match the supplied script: RGB conversion followed by LANCZOS resize."""

    return card.convert("RGB").resize(
        (width, height),
        Image.Resampling.LANCZOS,
    )


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


def _facebook_video_id(raw_url: str) -> str | None:
    parts = [part for part in urlparse(raw_url).path.split("/") if part]
    for marker in ("reel", "videos", "watch"):
        if marker in parts:
            index = parts.index(marker) + 1
            if index < len(parts) and parts[index].isdigit():
                return parts[index]
    query_video_id = parse_qs(urlparse(raw_url).query).get("v", [""])[0]
    return query_video_id if query_video_id.isdigit() else None


def _is_facebook_cdn_video_url(raw_url: str) -> bool:
    parsed = urlparse(raw_url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    return (
        parsed.scheme == "https"
        and (hostname == "fbcdn.net" or hostname.endswith(".fbcdn.net"))
        and parsed.path.lower().endswith(".mp4")
    )


def _walk_json(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_json(child)


def _extract_facebook_progressive_urls(html: str, target_video_id: str) -> list[str]:
    """Return target Reel progressive MP4 URLs, highest advertised bitrate first."""
    soup = BeautifulSoup(html, "html.parser")
    target_nodes: list[dict] = []
    identity_keys = {"id", "video_id", "root_video_id", "initial_node_id"}
    for script in soup.find_all("script", attrs={"type": "application/json"}):
        raw_json = script.string or script.get_text() or ""
        try:
            document = json.loads(raw_json)
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _walk_json(document):
            if not isinstance(item, dict):
                continue
            if any(str(item.get(key) or "") == target_video_id for key in identity_keys):
                target_nodes.append(item)

    candidates: dict[str, int] = {}
    for node in target_nodes:
        for item in _walk_json(node):
            if not isinstance(item, dict):
                continue
            candidate = item.get("progressive_url")
            if not isinstance(candidate, str) or not _is_facebook_cdn_video_url(candidate):
                continue
            raw_bitrate = parse_qs(urlparse(candidate).query).get("bitrate", ["0"])[0]
            try:
                bitrate = int(raw_bitrate)
            except (TypeError, ValueError):
                bitrate = 0
            candidates[candidate] = max(candidates.get(candidate, 0), bitrate)
    return [url for url, _bitrate in sorted(candidates.items(), key=lambda item: item[1], reverse=True)]


def _fetch_authenticated_facebook_html(
    raw_url: str,
    cookie_path: Path,
) -> str:
    cookie_jar = MozillaCookieJar(str(cookie_path))
    try:
        cookie_jar.load(ignore_discard=True, ignore_expires=False)
    except (LoadError, OSError) as exc:
        raise ValueError(
            "FACEBOOK_COOKIES_FILE is not a valid readable Netscape cookies.txt file."
        ) from exc

    session = requests.Session()
    session.cookies.update(cookie_jar)
    with session.get(
        raw_url,
        stream=True,
        timeout=(15, 60),
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    ) as response:
        response.raise_for_status()
        media_type = (response.headers.get("Content-Type") or "").lower()
        if "html" not in media_type:
            raise ValueError("Facebook authenticated fallback did not return an HTML page.")
        chunks: list[bytes] = []
        written = 0
        for chunk in response.iter_content(256 * 1024):
            if not chunk:
                continue
            written += len(chunk)
            if written > MAX_FACEBOOK_HTML_BYTES:
                raise ValueError("Facebook HTML response exceeded the 12 MB safety limit.")
            chunks.append(chunk)
        encoding = response.encoding or "utf-8"
        return b"".join(chunks).decode(encoding, errors="replace")


def _download_facebook_html_fallback(
    raw_url: str,
    destination: Path,
    *,
    cookie_path: Path,
    log: Callable[[str], None],
) -> bool:
    video_id = _facebook_video_id(raw_url)
    if not video_id:
        log("Could not identify the Facebook video ID for the HTML fallback.")
        return False
    log("Trying the authenticated Facebook HTML video fallback.")
    html = _fetch_authenticated_facebook_html(raw_url, cookie_path)
    candidates = _extract_facebook_progressive_urls(html, video_id)
    if not candidates:
        log("Authenticated Facebook HTML contained no progressive MP4 for this Reel.")
        return False
    log(f"Authenticated Facebook HTML exposed {len(candidates)} progressive MP4 candidate(s).")
    for index, candidate in enumerate(candidates, 1):
        destination.unlink(missing_ok=True)
        try:
            _download_source(candidate, destination, log=log)
            log(f"Downloaded Facebook progressive MP4 candidate {index}.")
            return True
        except Exception as exc:
            destination.unlink(missing_ok=True)
            log(
                f"Facebook progressive MP4 candidate {index} failed "
                f"({type(exc).__name__}); trying the next quality."
            )
    return False


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
        # Route warnings through _YtDlpLogger so the project generation log
        # explains resolver failures without writing cookies or tokens.
        "no_warnings": False,
        "overwrites": True,
        "continuedl": False,
        "retries": 3,
        "fragment_retries": 3,
        "extractor_retries": 3,
        "socket_timeout": 30,
        "max_filesize": MAX_VIDEO_BYTES,
        "logger": _YtDlpLogger(log),
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    }
    cookie_file = os.getenv(
        "FACEBOOK_COOKIES_FILE",
        "/app/uploads/facebook/cookies.txt",
    ).strip()
    cookie_configured = False
    cookie_path: Path | None = None
    if cookie_file:
        cookie_path = Path(cookie_file).resolve()
        if cookie_path.is_file():
            options["cookiefile"] = str(cookie_path)
            cookie_configured = True
            log("Using the configured Facebook browser session cookie file.")
        elif "FACEBOOK_COOKIES_FILE" in os.environ:
            log(
                "FACEBOOK_COOKIES_FILE is configured, but the file is not available "
                "inside the backend container."
            )

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
        technical = " ".join(str(exc).split())[-700:]
        if technical:
            log(f"Facebook Reel resolver failed: {technical}")
        if cookie_configured and cookie_path is not None:
            try:
                if _download_facebook_html_fallback(
                    raw_url,
                    destination,
                    cookie_path=cookie_path,
                    log=log,
                ):
                    return
            except Exception as fallback_exc:
                destination.unlink(missing_ok=True)
                log(
                    "Authenticated Facebook HTML fallback failed "
                    f"({type(fallback_exc).__name__})."
                )
        if cookie_configured:
            guidance = (
                "Facebook still denied the video while using the configured browser "
                "session. Export a fresh Netscape cookies.txt file from a Facebook "
                "account that can watch this Reel, or upload the video to the workspace."
            )
        else:
            guidance = (
                "The Reel URL returned a Facebook web page instead of a video file; "
                "HTTP 200 alone does not mean the response is an MP4. This Reel may "
                "require Facebook login or age verification (18+). "
                "Upload the video to the workspace, paste a direct video/CDN URL, or "
                "configure FACEBOOK_COOKIES_FILE with a Netscape cookies.txt file."
            )
        raise ValueError(
            f"Facebook could not provide the Reel video. {guidance}"
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


def _frame_rate(value: object) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    try:
        numerator, separator, denominator = raw.partition("/")
        if separator:
            divisor = float(denominator)
            return float(numerator) / divisor if divisor else 0.0
        return float(raw)
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def validate_facebook_reel_file(path: Path) -> dict:
    """Validate the rendered asset against Meta's hosted-Reel requirements."""

    if not path.is_file() or path.stat().st_size < 1024:
        raise ValueError(
            "The generated Reel video is missing or incomplete. Regenerate the video."
        )
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                (
                    "stream=width,height,avg_frame_rate,r_frame_rate,duration:"
                    "format=duration,format_name"
                ),
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
        raise ValueError("The generated Reel could not be inspected within 30 seconds.") from exc

    if probe.returncode != 0:
        technical = (probe.stderr or "ffprobe could not decode the file").strip()
        technical = " ".join(technical.split())[-600:]
        raise ValueError(
            "The generated Reel is not a valid or complete video. "
            f"ffprobe: {technical}"
        )
    try:
        payload = json.loads(probe.stdout or "{}")
        stream = (payload.get("streams") or [])[0]
        video_format = payload.get("format") or {}
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
        duration = float(video_format.get("duration") or stream.get("duration") or 0)
        fps = _frame_rate(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
    except (IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("The generated Reel has no readable video metadata.") from exc

    problems: list[str] = []
    if width < FACEBOOK_REEL_MIN_WIDTH or height < FACEBOOK_REEL_MIN_HEIGHT:
        problems.append(
            f"resolution is {width}x{height}; minimum is "
            f"{FACEBOOK_REEL_MIN_WIDTH}x{FACEBOOK_REEL_MIN_HEIGHT}"
        )
    if duration < FACEBOOK_REEL_MIN_DURATION or duration > FACEBOOK_REEL_MAX_DURATION:
        problems.append(
            f"duration is {duration:.1f}s; Facebook Reels require "
            f"{FACEBOOK_REEL_MIN_DURATION:.0f}-{FACEBOOK_REEL_MAX_DURATION:.0f}s"
        )
    if fps < FACEBOOK_REEL_MIN_FPS:
        problems.append(
            f"frame rate is {fps:.2f} fps; Facebook Reels require at least "
            f"{FACEBOOK_REEL_MIN_FPS:.0f} fps"
        )
    if problems:
        raise ValueError(
            "Generated video is not publishable as a Facebook Reel: "
            + "; ".join(problems)
            + "."
        )

    return {
        "width": width,
        "height": height,
        "duration": duration,
        "fps": fps,
        "format_name": str(video_format.get("format_name") or ""),
    }


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
                    f"Direct Link returned HTTP {response.status_code} with {media_type}, "
                    "not a video file. A successful HTTP status does not prove the body "
                    "is an MP4. Upload the video to the workspace and use its generated URL."
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
        video_format: str = "9:16",
        intro_seconds: float = 5.0,
        fps: int = 30,
        bitrate_kbps: int = 8000,
        log: Callable[[str], None] | None = None,
    ) -> ProcessedFacebookVideo:
        emit = log or (lambda _message: None)
        if not openai_api_key:
            raise ValueError("OpenAI API key is required for Facebook video generation.")
        video_width, video_height = video_dimensions(video_format)
        intro_seconds = min(15.0, max(1.0, float(intro_seconds)))
        fps = fps if fps in {24, 30, 60} else 30
        bitrate_kbps = min(20000, max(1000, int(bitrate_kbps)))

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
                    fps=fps,
                    ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
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
                size=_recipe_card_size(video_width, video_height),
            )
        image_base64 = image_result.data[0].b64_json
        if not image_base64:
            raise ValueError("OpenAI returned an empty Facebook recipe card.")
        image_bytes = base64.b64decode(image_base64)
        card = Image.open(BytesIO(image_bytes)).convert("RGB")
        card = _prepare_recipe_card(card, video_width, video_height)
        card.save(recipe_card_path, format="PNG", quality=100)
        emit(f"Generated the recipe card at {video_width}x{video_height}.")

        audio = AudioFileClip(str(audio_path))
        source = VideoFileClip(str(silent_path))
        layers = []
        try:
            duration = float(audio.duration or 0)
            if duration <= 0:
                raise ValueError("Generated Facebook voice-over has no duration.")
            lead_duration = min(intro_seconds, duration, float(source.duration or 0))
            resized_width, resized_height = _cover_resize_dimensions(
                source.w,
                source.h,
                video_width,
                video_height,
            )
            lead = source.subclipped(0, lead_duration).resized(
                (resized_width, resized_height)
            )
            lead = lead.cropped(
                x_center=lead.w / 2,
                y_center=lead.h / 2,
                width=video_width,
                height=video_height,
            )
            layers.append(lead)
            emit(
                f"Fitted the source video to {video_width}x{video_height} "
                "without black padding."
            )
            remaining = max(0.0, duration - lead_duration)
            if remaining > 0:
                card_clip = (
                    ImageClip(str(recipe_card_path))
                    .with_duration(remaining)
                    .with_start(lead_duration)
                    .resized((video_width, video_height))
                    .with_position(("center", "center"))
                )
                layers.append(card_clip)
            final = CompositeVideoClip(layers, size=(video_width, video_height)).with_audio(audio)
            try:
                final.write_videofile(
                    str(output_path),
                    fps=fps,
                    codec="libx264",
                    audio_codec="aac",
                    bitrate=f"{bitrate_kbps}k",
                    ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"],
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
