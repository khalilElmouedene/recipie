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

    def get_message(self):
        self._log(f"Waiting {self.wait_time}s for Midjourney generation...")
        self._interruptible_sleep(self.wait_time)
        try:
            # Only look at messages that appeared AFTER we sent our prompt
            response = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                headers=self._headers(),
                params={"after": self.baseline_id, "limit": 50},
            )
            messages = response.json()
            # Find the grid message that has U1/U2/U3/U4 upscale buttons
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
                        self._log(f"Got grid message {self.message_id} with {len(self.custom_ids)} upscale buttons")
                        return
                except (KeyError, IndexError):
                    continue
            raise ValueError("No grid message with upscale buttons found")
        except ValueError:
            raise
        except Exception as e:
            self._log(f"Error getting messages: {e}")
            raise ValueError("Timeout")

    def choose_images(self):
        """Click U1–U4 to upscale all 4 grid images (round 1)."""
        url = "https://discord.com/api/v9/interactions"
        self.get_message()
        if not self.custom_ids:
            raise ValueError("No buttons found to upscale images")
        # Record baseline just before triggering upscales so download_image can
        # find only the 4 upscaled images that belong to this recipe
        self.upscale_baseline_id = self._get_latest_message_id()
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
            response = requests.post(url, headers=self._headers(), json=data)
            if response.status_code != 204:
                self._log(f"Failed to upscale button {custom_id}, status: {response.status_code}")
            self._interruptible_sleep(self.upscale_gap_seconds)
        self._log("Upscale requests sent for all 4 images")

    def _find_upscale_2x_buttons(self) -> list[dict]:
        """Find messages after baseline that have image attachments and an 'Upscale (2x)' button."""
        after_id = getattr(self, "upscale_baseline_id", self.message_id)
        try:
            response = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                headers=self._headers(),
                params={"after": after_id, "limit": 50},
            )
            messages = response.json()
        except Exception as e:
            self._log(f"Error fetching messages for further upscale: {e}")
            return []

        result = []
        for msg in messages:
            if not msg.get("attachments"):
                continue
            upscale_2x_id = None
            for row in msg.get("components", []):
                for btn in row.get("components", []):
                    label = btn.get("label", "")
                    custom_id = btn.get("custom_id", "")
                    # Match "Upscale (2x)" label or known Midjourney v6 custom_id patterns
                    if "2x" in label or "upsample_v6_2x" in custom_id or "upscale_v6_2x" in custom_id:
                        upscale_2x_id = custom_id
                        break
                if upscale_2x_id:
                    break
            if upscale_2x_id:
                result.append({"message_id": msg["id"], "custom_id": upscale_2x_id})
            if len(result) >= 4:
                break
        return result

    def upscale_further(self) -> None:
        """Perform one additional upscale round by clicking 'Upscale (2x)' on each image."""
        upscale_targets = self._find_upscale_2x_buttons()
        if not upscale_targets:
            raise ValueError("No 'Upscale (2x)' buttons found — cannot perform additional upscale round")

        # Update baseline before triggering so download_image finds the new results
        self.upscale_baseline_id = self._get_latest_message_id()

        url = "https://discord.com/api/v9/interactions"
        for item in upscale_targets:
            data = {
                "type": 3,
                "guild_id": self.guild_id,
                "channel_id": self.channel_id,
                "message_flags": 0,
                "message_id": item["message_id"],
                "application_id": self.application_id,
                "session_id": "cannot be empty",
                "data": {"component_type": 2, "custom_id": item["custom_id"]},
            }
            response = requests.post(url, headers=self._headers(), json=data)
            if response.status_code != 204:
                self._log(f"Further upscale failed for message {item['message_id']}: {response.status_code}")
            self._interruptible_sleep(self.upscale_gap_seconds)
        self._log(f"Further upscale requests sent for {len(upscale_targets)} images")

    def download_image(self) -> list[str]:
        img_urls: list[str] = []
        try:
            # Only look at messages after our upscale requests were sent
            after_id = getattr(self, "upscale_baseline_id", self.message_id)
            response = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                headers=self._headers(),
                params={"after": after_id, "limit": 50},
            )
            messages = response.json()
            # Collect the first 4 messages that have image attachments
            for msg in messages:
                try:
                    if msg.get("attachments"):
                        img_urls.append(msg["attachments"][0]["url"])
                        if len(img_urls) >= 4:
                            break
                except (KeyError, IndexError):
                    continue
            if not img_urls:
                raise ValueError("No upscaled images found")
            self._log(f"Downloaded {len(img_urls)} image URLs")
            return img_urls
        except ValueError:
            raise
        except Exception as e:
            self._log(f"Error downloading images: {e}")
            raise ValueError("Timeout")


def generate_images(
    recipe_name: str,
    img_url: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    wait_time: int = 190,
    upscale_gap_seconds: int = 10,
    num_upscales: int = 1,
    post_upscale_wait_seconds: int = 30,
    max_attempts: int | None = None,
    retry_delay_seconds: int = 15,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> list[str]:
    """High-level function to generate Midjourney images for a recipe.
    num_upscales controls how many upscale rounds to perform:
      1 = standard (U1-U4 only)
      2 = U1-U4, then Upscale (2x) on each result
      3 = U1-U4, then Upscale (2x) twice
    credentials dict must contain: discord_app_id, discord_guild, discord_channel,
    mj_version, mj_id, discord_auth
    """
    _log = log or print
    _should_stop = should_stop or (lambda: False)
    from .prompts import get_prompt
    tpl = get_prompt(prompts or {}, "midjourney_imagine")
    prompt = tpl.format(recipe_name=recipe_name, img_url=img_url, source_img=img_url)

    rounds = max(1, min(3, int(num_upscales)))
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

    # Round 1: standard U1–U4 upscale
    mj.choose_images()
    _log(f"Waiting {post_wait}s for upscaled images to appear...")
    mj._interruptible_sleep(post_wait)

    # Rounds 2+: click "Upscale (2x)" on each result
    for round_num in range(2, rounds + 1):
        _log(f"Upscale round {round_num}/{rounds}: clicking 'Upscale (2x)' on all images...")
        mj.upscale_further()
        _log(f"Waiting {post_wait}s for round {round_num} images to appear...")
        mj._interruptible_sleep(post_wait)

    image_urls = mj.download_image()
    if not image_urls:
        raise ValueError("Midjourney returned no image URLs")
    return image_urls
