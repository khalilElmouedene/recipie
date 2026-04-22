from __future__ import annotations
import time
import requests
from typing import Callable


class MidjourneyApi:
    """Midjourney image generation via Discord API."""

    def __init__(
        self,
        prompt: str,
        application_id: str,
        guild_id: str,
        channel_id: str,
        version: str,
        mj_id: str,
        authorization: str,
        wait_time: int = 190,
        upscale_gap_seconds: int = 10,
        log: Callable[[str], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ):
        self.application_id = application_id
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.version = version
        self.id = mj_id
        self.authorization = authorization
        self.prompt = prompt
        self.wait_time = wait_time
        self.upscale_gap_seconds = max(1, min(120, upscale_gap_seconds))
        self.message_id = ""
        self.custom_ids: list[str] = []
        self._log = log or print
        self._should_stop = should_stop or (lambda: False)

    def _interruptible_sleep(self, seconds: int) -> None:
        """Sleep in 1-second chunks, raising ValueError immediately if stop is requested."""
        elapsed = 0
        while elapsed < seconds:
            if self._should_stop():
                raise ValueError("Generation stopped by user")
            time.sleep(min(1, seconds - elapsed))
            elapsed += 1

    def _headers(self) -> dict:
        return {
            "Authorization": self.authorization,
            "Content-Type": "application/json",
        }

    def _get_latest_message_id(self) -> str:
        """Return the ID of the most recent message in the channel (used as a baseline)."""
        try:
            r = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages?limit=1",
                headers=self._headers(),
            )
            msgs = r.json()
            if msgs:
                return msgs[0]["id"]
        except Exception:
            pass
        return "0"

    def send_message(self) -> requests.Response:
        # Snapshot the channel before sending so we can filter to OUR messages only
        self.baseline_id = self._get_latest_message_id()
        url = "https://discord.com/api/v9/interactions"
        data = {
            "type": 2,
            "application_id": self.application_id,
            "guild_id": self.guild_id,
            "channel_id": self.channel_id,
            "session_id": "cannot be empty",
            "data": {
                "version": self.version,
                "id": self.id,
                "name": "imagine",
                "type": 1,
                "options": [{"type": 3, "name": "prompt", "value": self.prompt}],
                "application_command": {
                    "id": self.id,
                    "application_id": self.application_id,
                    "version": self.version,
                    "default_member_permissions": None,
                    "type": 1,
                    "nsfw": False,
                    "name": "imagine",
                    "description": "Create images with Midjourney",
                    "dm_permission": True,
                    "contexts": None,
                    "options": [
                        {
                            "type": 3,
                            "name": "prompt",
                            "description": "The prompt to imagine",
                            "required": True,
                        }
                    ],
                },
                "attachments": [],
            },
        }
        response = requests.post(url, headers=self._headers(), json=data)
        self._log(f"Midjourney prompt sent (status {response.status_code})")
        return response

    def _find_grid_in_messages(self, messages: list) -> bool:
        """Return True and set message_id/custom_ids if a grid message is found."""
        for msg in messages:
            try:
                comps = msg.get("components", [])
                if not comps:
                    continue
                buttons = [
                    c for c in comps[0].get("components", [])
                    if c.get("label") in ["U1", "U2", "U3", "U4"]
                ]
                if len(buttons) >= 4:
                    self.message_id = msg["id"]
                    self.custom_ids = [b["custom_id"] for b in buttons]
                    return True
            except (KeyError, IndexError):
                continue
        return False

    def get_message(self, poll_interval: int = 15) -> None:
        """Poll Discord every poll_interval seconds until the grid appears or wait_time expires."""
        self._log(f"Waiting up to {self.wait_time}s for Midjourney grid...")
        elapsed = 0
        while elapsed < self.wait_time:
            self._interruptible_sleep(min(poll_interval, self.wait_time - elapsed))
            elapsed += poll_interval
            try:
                response = requests.get(
                    f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                    headers=self._headers(),
                    params={"after": self.baseline_id, "limit": 50},
                    timeout=15,
                )
                if self._find_grid_in_messages(response.json()):
                    self._log(f"Got grid message {self.message_id} after {elapsed}s")
                    return
                self._log(f"Grid not ready yet ({elapsed}/{self.wait_time}s)...")
            except Exception as e:
                self._log(f"Grid poll error (will retry): {e}")
        raise ValueError(f"No Midjourney grid found after {self.wait_time}s")

    def choose_images(self, button_retries: int = 3) -> None:
        """Click U1–U4 to upscale all 4 grid images, retrying each button on failure."""
        url = "https://discord.com/api/v9/interactions"
        self.get_message()
        if not self.custom_ids:
            raise ValueError("No buttons found to upscale images")
        # Record baseline just before triggering upscales so download_image can
        # find only the 4 upscaled images that belong to this recipe
        self.upscale_baseline_id = self._get_latest_message_id()
        failed = 0
        for custom_id in self.custom_ids[:4]:
            data = {
                "type": 3,
                "guild_id": self.guild_id,
                "channel_id": self.channel_id,
                "message_flags": 0,
                "message_id": self.message_id,
                "application_id": self.application_id,
                "session_id": "cannot be empty",
                "data": {"component_type": 2, "custom_id": custom_id},
            }
            sent = False
            for attempt in range(button_retries):
                response = requests.post(url, headers=self._headers(), json=data, timeout=15)
                if response.status_code == 204:
                    sent = True
                    break
                self._log(f"Upscale button attempt {attempt + 1}/{button_retries} failed (status {response.status_code})")
                if attempt < button_retries - 1:
                    self._interruptible_sleep(5)
            if not sent:
                failed += 1
                self._log(f"Upscale button {custom_id} failed after {button_retries} attempts — skipping")
            self._interruptible_sleep(self.upscale_gap_seconds)
        if failed == 4:
            raise ValueError("All 4 upscale buttons failed — Discord may be down")
        if failed:
            self._log(f"Warning: {failed}/4 upscale buttons failed — continuing with partial upscales")
        self._log(f"Upscale requests sent ({4 - failed}/4 succeeded)")

    def download_image(self, post_upscale_wait: int = 120, poll_interval: int = 10) -> list[str]:
        """Poll Discord every poll_interval seconds until upscaled images appear or post_upscale_wait expires."""
        after_id = getattr(self, "upscale_baseline_id", self.message_id)
        elapsed = 0
        while elapsed < post_upscale_wait:
            self._interruptible_sleep(min(poll_interval, post_upscale_wait - elapsed))
            elapsed += poll_interval
            try:
                response = requests.get(
                    f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                    headers=self._headers(),
                    params={"after": after_id, "limit": 50},
                    timeout=15,
                )
                img_urls: list[str] = []
                for msg in response.json():
                    try:
                        if msg.get("attachments"):
                            img_urls.append(msg["attachments"][0]["url"])
                            if len(img_urls) >= 4:
                                break
                    except (KeyError, IndexError):
                        continue
                if img_urls:
                    self._log(f"Got {len(img_urls)} upscaled image(s) after {elapsed}s")
                    return img_urls
                self._log(f"Upscaled images not ready yet ({elapsed}/{post_upscale_wait}s)...")
            except Exception as e:
                self._log(f"Image download poll error (will retry): {e}")
        raise ValueError(f"No upscaled images found after {post_upscale_wait}s")


def generate_images(
    recipe_name: str,
    img_url: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    wait_time: int = 190,
    upscale_gap_seconds: int = 10,
    post_upscale_wait_seconds: int = 30,
    max_attempts: int | None = None,
    retry_delay_seconds: int = 15,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> list[str]:
    """High-level function to generate Midjourney images for a recipe.
    credentials dict must contain: discord_app_id, discord_guild, discord_channel,
    mj_version, mj_id, discord_auth
    """
    _log = log or print
    _should_stop = should_stop or (lambda: False)
    from .prompts import get_prompt
    tpl = get_prompt(prompts or {}, "midjourney_imagine")
    prompt = tpl.format(recipe_name=recipe_name, img_url=img_url, source_img=img_url)

    retry_delay = max(1, min(300, int(retry_delay_seconds)))
    post_wait = max(10, min(600, post_upscale_wait_seconds))
    attempts_limit = max(1, int(max_attempts)) if max_attempts is not None else None
    attempt = 0
    while True:
        attempt += 1
        if _should_stop():
            raise ValueError("Generation stopped by user")
        try:
            if attempts_limit is None:
                _log(f"Midjourney initial communication attempt {attempt}")
            else:
                _log(f"Midjourney initial communication attempt {attempt}/{attempts_limit}")

            mj = MidjourneyApi(
                prompt=prompt,
                application_id=credentials.get("discord_app_id", ""),
                guild_id=credentials.get("discord_guild", ""),
                channel_id=credentials.get("discord_channel", ""),
                version=credentials.get("mj_version", ""),
                mj_id=credentials.get("mj_id", ""),
                authorization=credentials.get("discord_auth", ""),
                wait_time=wait_time,
                upscale_gap_seconds=upscale_gap_seconds,
                log=_log,
                should_stop=_should_stop,
            )

            send_resp = mj.send_message()
            # Discord interactions should return 204 on success.
            if send_resp.status_code != 204:
                body = ""
                try:
                    body = (send_resp.text or "").strip()
                except Exception:
                    body = ""
                if len(body) > 240:
                    body = body[:240] + "...[truncated]"
                raise ValueError(
                    f"Midjourney prompt send failed (status {send_resp.status_code})"
                    + (f": {body}" if body else "")
                )
            break
        except Exception as e:
            if attempts_limit is None:
                _log(f"Midjourney initial communication failed (attempt {attempt}): {e}. Retrying in {retry_delay}s...")
            else:
                if attempt >= attempts_limit:
                    raise ValueError(f"Midjourney initial communication failed after {attempts_limit} attempt(s): {e}")
                _log(
                    f"Midjourney initial communication failed "
                    f"(attempt {attempt}/{attempts_limit}): {e}. Retrying in {retry_delay}s..."
                )
            for _ in range(retry_delay):
                if _should_stop():
                    raise ValueError("Generation stopped by user")
                time.sleep(1)

    mj.choose_images()
    image_urls = mj.download_image(post_upscale_wait=post_wait)
    if not image_urls:
        raise ValueError("Midjourney returned no image URLs")
    return image_urls
