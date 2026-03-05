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
        log: Callable[[str], None] | None = None,
    ):
        self.application_id = application_id
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.version = version
        self.id = mj_id
        self.authorization = authorization
        self.prompt = prompt
        self.wait_time = wait_time
        self.message_id = ""
        self.custom_ids: list[str] = []
        self._log = log or print

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
        time.sleep(self.wait_time)
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
            time.sleep(10)
        self._log("Upscale requests sent for all 4 images")

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
    source_img: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    wait_time: int = 190,
    log: Callable[[str], None] | None = None,
) -> list[str]:
    """High-level function to generate 4 Midjourney images for a recipe.
    credentials dict must contain: discord_app_id, discord_guild, discord_channel,
    mj_version, mj_id, discord_auth
    """
    _log = log or print
    from .prompts import get_prompt
    tpl = get_prompt(prompts or {}, "midjourney_imagine")
    prompt = tpl.format(recipe_name=recipe_name, source_img=source_img)

    while True:
        try:
            mj = MidjourneyApi(
                prompt=prompt,
                application_id=credentials.get("discord_app_id", ""),
                guild_id=credentials.get("discord_guild", ""),
                channel_id=credentials.get("discord_channel", ""),
                version=credentials.get("mj_version", ""),
                mj_id=credentials.get("mj_id", ""),
                authorization=credentials.get("discord_auth", ""),
                wait_time=wait_time,
                log=_log,
            )
            break
        except Exception as e:
            _log(f"Regenerate MJ client... {e}")

    mj.send_message()
    mj.choose_images()

    time.sleep(60)

    return mj.download_image()
