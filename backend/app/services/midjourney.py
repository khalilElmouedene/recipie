from __future__ import annotations
import base64
import json
import random
import re
import time
import uuid
import requests
from datetime import datetime, timezone
from typing import Callable

_SUPER_PROPERTIES: str = base64.b64encode(
    json.dumps(
        {
            "os": "Windows",
            "browser": "Chrome",
            "device": "",
            "system_locale": "en-US",
            "browser_user_agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "browser_version": "124.0.0.0",
            "os_version": "10",
            "referrer": "",
            "referring_domain": "",
            "referrer_current": "",
            "referring_domain_current": "",
            "release_channel": "stable",
            "client_build_number": 294044,
            "client_event_source": None,
        },
        separators=(",", ":"),
    ).encode()
).decode()

from ..midjourney_settings import (
    DEFAULT_GRID_WAIT_SECONDS,
    DISCORD_HTTP_TIMEOUT_SECONDS,
    GRID_GRACE_PERIOD_SECONDS,
    INITIAL_SEND_MAX_ATTEMPTS,
    POST_UPSCALE_WAIT_SECONDS,
    UPSCALE_GAP_SECONDS,
)


# ---------------------------------------------------------------------------
# Prompt sanitizer — replaces words Midjourney's content filter commonly rejects
# in food/recipe contexts. Plural forms must come before singulars so the shorter
# pattern doesn't leave a stray "s" behind.
# ---------------------------------------------------------------------------
_MJ_SUBSTITUTIONS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bbreasts\b", re.IGNORECASE), "fillets"),
    (re.compile(r"\bbreast\b",  re.IGNORECASE), "fillet"),
    (re.compile(r"\bbutts\b",   re.IGNORECASE), "shoulders"),
    (re.compile(r"\bbutt\b",    re.IGNORECASE), "shoulder"),
    (re.compile(r"\bthighs\b",  re.IGNORECASE), "pieces"),
    (re.compile(r"\bthigh\b",   re.IGNORECASE), "piece"),
    (re.compile(r"\bnaked\b",   re.IGNORECASE), "plain"),
    (re.compile(r"\bboners?\b", re.IGNORECASE), ""),
]


def _sanitize_mj_prompt(text: str, log: Callable[[str], None] = print) -> str:
    """Replace flagged words with safe food synonyms before sending to Midjourney."""
    for pattern, replacement in _MJ_SUBSTITUTIONS:
        sanitized = pattern.sub(replacement, text)
        if sanitized != text:
            safe = replacement or "(removed)"
            log(f"Prompt sanitized: '{pattern.pattern[2:-2]}' → '{safe}'")
            text = sanitized
    return re.sub(r" {2,}", " ", text).strip()


class MidjourneyPermanentError(ValueError):
    """Raised when Midjourney/Discord rejects a request that should not be retried."""


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
        recipe_name: str = "",
        source_img_url: str = "",
        wait_time: int = DEFAULT_GRID_WAIT_SECONDS,
        upscale_gap_seconds: int = UPSCALE_GAP_SECONDS,
        log: Callable[[str], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
        tracking_state: dict | None = None,
        on_tracking_update: Callable[[dict], None] | None = None,
    ):
        state = tracking_state or {}
        self.application_id = application_id
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.version = version
        self.id = mj_id
        self.authorization = authorization
        self.recipe_name = recipe_name
        self.source_img_url = source_img_url
        self.prompt = prompt
        self.wait_time = wait_time
        self.upscale_gap_seconds = max(1, min(120, upscale_gap_seconds))
        self.session_id = str(state.get("discord_session_id") or uuid.uuid4())
        self.interaction_nonce = str(state.get("interaction_nonce") or "")
        self.baseline_id = str(state.get("baseline_message_id") or "0")
        self.tracked_message_id = str(state.get("tracked_message_id") or "")
        self.message_id = str(state.get("grid_message_id") or "")
        self.custom_ids = [str(value) for value in (state.get("grid_custom_ids") or [])]
        self.grid_job_tokens = {
            str(value).lower() for value in (state.get("grid_job_tokens") or [])
        }
        self.upscale_baseline_id = str(
            state.get("upscale_baseline_message_id") or self.message_id or "0"
        )
        self.requested_custom_ids = [
            str(value) for value in (state.get("requested_custom_ids") or [])
        ]
        self.expected_upscale_count = max(
            1, int(state.get("expected_upscale_count") or 4)
        )
        self.result_message_ids = [
            str(value) for value in (state.get("result_message_ids") or [])
        ]
        self.image_urls = [str(value) for value in (state.get("image_urls") or [])]
        self.tracking_status = str(state.get("status") or "created")
        self._last_grid_scan: dict[str, int] = {}
        self._log = log or print
        self._should_stop = should_stop or (lambda: False)
        self._on_tracking_update = on_tracking_update

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(timezone.utc)

    def _update_tracking(self, status: str | None = None, **values) -> None:
        if status:
            self.tracking_status = status
            values["status"] = status
        if not self._on_tracking_update:
            return
        try:
            self._on_tracking_update(values)
        except Exception as exc:
            self._log(f"Warning: could not persist Midjourney tracking state: {exc}")

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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "X-Super-Properties": _SUPER_PROPERTIES,
            "X-Discord-Locale": "en-US",
        }

    @staticmethod
    def _nonce() -> str:
        return str(random.randint(100_000_000_000_000_000, 999_999_999_999_999_999))

    def _check_rate_limit(self, response: requests.Response) -> bool:
        """Sleep retry_after seconds if Discord returned 429. Returns True so callers can continue."""
        if response.status_code == 429:
            try:
                retry_after = int(response.json().get("retry_after", 5)) + 1
            except Exception:
                retry_after = 6
            self._log(f"Discord rate limit hit, sleeping {retry_after}s...")
            self._interruptible_sleep(retry_after)
            return True
        return False

    def _message_text(self, msg: dict) -> str:
        """Read prompt text from legacy and newer Discord message layouts."""
        parts: list[str] = []
        pending_messages = [msg]
        while pending_messages:
            current = pending_messages.pop()
            if not isinstance(current, dict):
                continue
            parts.append(str(current.get("content", "")))
            for embed in current.get("embeds", []) or []:
                if not isinstance(embed, dict):
                    continue
                parts.extend(
                    [
                        str(embed.get("title", "")),
                        str(embed.get("description", "")),
                        str((embed.get("footer") or {}).get("text", "")),
                        str((embed.get("author") or {}).get("name", "")),
                    ]
                )
                for field in embed.get("fields", []) or []:
                    if isinstance(field, dict):
                        parts.extend([str(field.get("name", "")), str(field.get("value", ""))])

            pending_components = list(current.get("components", []) or [])
            while pending_components:
                component = pending_components.pop()
                if not isinstance(component, dict):
                    continue
                for key in ("content", "label", "description", "placeholder"):
                    value = component.get(key)
                    if isinstance(value, str):
                        parts.append(value)
                pending_components.extend(component.get("components", []) or [])

            for snapshot in current.get("message_snapshots", []) or []:
                if not isinstance(snapshot, dict):
                    continue
                snapshot_message = snapshot.get("message")
                if isinstance(snapshot_message, dict):
                    pending_messages.append(snapshot_message)
        return " ".join(parts)

    @staticmethod
    def _normalize_text(value: str) -> str:
        text = str(value or "").lower()
        # Discord decorates Midjourney prompts with Markdown (usually **bold**)
        # and may wrap links. Those presentation characters must not make an
        # otherwise identical prompt fail correlation.
        text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1 \2", text)
        text = text.replace("\u200b", " ").replace("\ufeff", " ")
        text = re.sub(r"[*_`~>|]", " ", text)
        return " ".join(text.split())

    @classmethod
    def _normalize_prompt_text(cls, value: str) -> str:
        """Normalize prompt text while ignoring rewritten Discord/MJ URLs."""
        without_urls = re.sub(r"https?://\S+", " ", str(value or ""))
        return cls._normalize_text(without_urls)

    def _job_markers(self) -> list[str]:
        markers: list[str] = []
        for raw, min_length in ((self.prompt, 8),):
            cleaned = re.sub(r"https?://\S+", " ", raw or "")
            normalized = self._normalize_text(cleaned)
            if len(normalized) >= min_length:
                markers.append(normalized[:160])
        source_marker = self._normalize_text(self.source_img_url)
        if len(source_marker) >= 8:
            markers.append(source_marker[:160])
        return list(dict.fromkeys(markers))

    def _message_matches_job(self, msg: dict) -> bool:
        text = self._normalize_text(self._message_text(msg))
        if not text:
            return False
        return any(marker in text for marker in self._job_markers())

    def _message_matches_prompt(self, msg: dict) -> bool:
        """Strong match used when Discord publishes the final grid as a new message.

        Midjourney commonly replaces the source URL with an s.mj.run URL, so the
        URL is deliberately excluded while the meaningful prompt body remains.
        """
        expected = self._normalize_prompt_text(self.prompt)
        actual = self._normalize_prompt_text(self._message_text(msg))
        if not expected or not actual:
            return False
        marker = expected[:240]
        if len(marker) >= 16 and marker in actual:
            return True

        # Discord occasionally truncates or reformats part of a long prompt.
        # Require the exact recipe name plus a strong word overlap so a public
        # result can still be correlated without accepting another job.
        recipe_marker = self._normalize_text(self.recipe_name)
        if len(recipe_marker) < 4 or recipe_marker not in actual:
            return False
        expected_words = set(re.findall(r"[a-z0-9]+", expected))
        actual_words = set(re.findall(r"[a-z0-9]+", actual))
        if not expected_words:
            return False
        overlap = len(expected_words & actual_words) / len(expected_words)
        return overlap >= 0.65

    def _message_is_from_midjourney(self, msg: dict) -> bool:
        """Check that a message was produced by the configured Midjourney app."""
        author = msg.get("author") or {}
        candidate_ids = {
            str(author.get("id") or ""),
            str(msg.get("application_id") or ""),
        }
        return bool(self.application_id and self.application_id in candidate_ids)

    def _message_has_midjourney_controls(self, msg: dict) -> bool:
        """Recognize real Midjourney controls when Discord omits app identity."""
        for custom_id in self._component_custom_ids(msg):
            normalized = custom_id.lower()
            if normalized.startswith("mj::") and "::upsample::" in normalized:
                return True
        return False

    def _message_is_after_baseline(self, msg: dict) -> bool:
        """Return whether a Discord snowflake was posted after this job started."""
        message_id = str(msg.get("id") or "0")
        baseline_ids = [self.baseline_id, self.tracked_message_id]
        try:
            message_int = int(message_id)
        except (TypeError, ValueError):
            return False
        for baseline_id in baseline_ids:
            try:
                baseline_int = int(str(baseline_id or "0"))
            except (TypeError, ValueError):
                continue
            if message_int > baseline_int > 0:
                return True
        return False

    def _message_matches_recipe_title(self, msg: dict) -> bool:
        """Match the exact recipe title when Discord omits the rest of the prompt."""
        recipe_title = self._normalize_text(self.recipe_name)
        actual = self._normalize_text(self._message_text(msg))
        return len(recipe_title) >= 4 and recipe_title in actual

    def _is_safe_recipe_fallback(self, msg: dict) -> bool:
        """Allow a narrow fallback only for this app's unique, post-baseline grid."""
        return (
            (self._message_is_from_midjourney(msg) or self._message_has_midjourney_controls(msg))
            and self._message_is_after_baseline(msg)
            and self._message_matches_recipe_title(msg)
        )

    @staticmethod
    def _component_custom_ids(msg: dict) -> list[str]:
        """Return every component custom_id, including nested action rows."""
        custom_ids: list[str] = []
        pending = list(msg.get("components", []) or [])
        while pending:
            component = pending.pop()
            if not isinstance(component, dict):
                continue
            custom_id = component.get("custom_id")
            if custom_id:
                custom_ids.append(str(custom_id))
            pending.extend(component.get("components", []) or [])
        return custom_ids

    def _upscale_buttons(self, msg: dict) -> list[dict]:
        """Find U1-U4 controls in both legacy and nested Discord components."""
        found: dict[int, dict] = {}
        pending = list(msg.get("components", []) or [])
        while pending:
            component = pending.pop()
            if not isinstance(component, dict):
                continue
            pending.extend(component.get("components", []) or [])
            custom_id = str(component.get("custom_id") or "")
            if not custom_id:
                continue
            label = self._normalize_text(component.get("label", "")).replace(" ", "")
            label_match = re.fullmatch(r"u([1-4])", label)
            custom_match = re.search(
                r"::upsample::([1-4])(?:::|$)", custom_id, re.IGNORECASE
            )
            match = label_match or custom_match
            if match:
                found.setdefault(int(match.group(1)), component)
        return [found[index] for index in sorted(found)]

    @staticmethod
    def _midjourney_job_tokens(custom_ids: list[str]) -> set[str]:
        """Extract Midjourney job tokens as a secondary correlation signal."""
        tokens: set[str] = set()
        for custom_id in custom_ids:
            parts = [part.strip() for part in str(custom_id).split("::") if part.strip()]
            if len(parts) < 2 or parts[0].upper() != "MJ":
                continue
            for part in reversed(parts):
                normalized = part.lower()
                if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{27,}", normalized):
                    tokens.add(normalized)
                    break
        return tokens

    def _message_matches_grid_job_token(self, msg: dict) -> bool:
        if not self.grid_job_tokens:
            return False
        haystack = " ".join(
            [self._message_text(msg), *self._component_custom_ids(msg)]
        ).lower()
        return any(token in haystack for token in self.grid_job_tokens)

    def _message_references_grid(self, msg: dict) -> bool:
        if not self.message_id:
            return False
        ref = msg.get("message_reference") or {}
        if str(ref.get("message_id", "")) == self.message_id:
            return True
        referenced = msg.get("referenced_message") or {}
        if str(referenced.get("id", "")) == self.message_id:
            return True
        return self._message_matches_grid_job_token(msg)

    @staticmethod
    def _message_sort_id(msg: dict) -> int:
        try:
            return int(str(msg.get("id", "0")))
        except ValueError:
            return 0

    def _get_latest_message_id(self) -> str:
        """Return the ID of the most recent message in the channel (used as a baseline)."""
        for _ in range(2):
            try:
                r = requests.get(
                    f"https://discord.com/api/v9/channels/{self.channel_id}/messages?limit=1",
                    headers=self._headers(),
                    timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
                )
                if self._check_rate_limit(r):
                    continue
                msgs = r.json()
                if msgs:
                    return msgs[0]["id"]
                return "0"
            except Exception:
                pass
        return "0"

    def send_message(self) -> requests.Response:
        # Snapshot the channel before sending so we can filter to OUR messages only
        self.baseline_id = self._get_latest_message_id()
        self.interaction_nonce = self._nonce()
        url = "https://discord.com/api/v9/interactions"
        data = {
            "type": 2,
            "application_id": self.application_id,
            "guild_id": self.guild_id,
            "channel_id": self.channel_id,
            "session_id": self.session_id,
            "nonce": self.interaction_nonce,
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
        response = requests.post(
            url,
            headers=self._headers(),
            json=data,
            timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
        )
        self._log(f"Midjourney prompt sent (status {response.status_code})")
        if response.status_code == 204:
            self._update_tracking(
                "submitted",
                discord_session_id=self.session_id,
                interaction_nonce=self.interaction_nonce,
                baseline_message_id=self.baseline_id,
                submitted_at=self._utcnow(),
                last_error=None,
            )
        return response

    def _accept_grid(self, msg: dict, buttons: list[dict]) -> bool:
        """Persist a confirmed Midjourney grid and its upscale controls."""
        self.message_id = str(msg["id"])
        self.tracked_message_id = self.message_id
        self.custom_ids = [button["custom_id"] for button in buttons]
        self.grid_job_tokens = self._midjourney_job_tokens(self.custom_ids)
        self._update_tracking(
            "grid_ready",
            tracked_message_id=self.tracked_message_id,
            grid_message_id=self.message_id,
            grid_custom_ids=list(self.custom_ids),
            grid_job_tokens=sorted(self.grid_job_tokens),
            grid_ready_at=self._utcnow(),
            last_polled_at=self._utcnow(),
            last_error=None,
        )
        return True

    def _find_grid_in_messages(self, messages: list) -> bool:
        """Return True and set message_id/custom_ids if a grid message is found."""
        candidates: list[tuple[int, dict, list[dict]]] = []
        fallback_candidates: list[tuple[int, dict, list[dict]]] = []
        strong_identity_candidates: list[tuple[int, dict, list[dict]]] = []
        diagnostics = {
            "messages": len(messages) if isinstance(messages, list) else 0,
            "job_matches": 0,
            "prompt_matches": 0,
            "matching_attachments": 0,
            "matching_controls": 0,
            "safe_fallback_candidates": 0,
            "grid_candidates": 0,
            "midjourney_author_matches": 0,
            "midjourney_control_matches": 0,
            "post_baseline_candidates": 0,
            "recipe_title_matches": 0,
            "unmatched_grid_candidates": 0,
            "strong_identity_candidates": 0,
        }
        unmatched_grid_candidates = 0
        if not isinstance(messages, list):
            self._last_grid_scan = diagnostics
            return False
        for msg in messages:
            if not isinstance(msg, dict):
                continue
            try:
                msg_id = str(msg.get("id", ""))
                prompt_match = self._message_matches_prompt(msg)
                job_match = self._message_matches_job(msg)
                if job_match:
                    diagnostics["job_matches"] += 1
                if prompt_match:
                    diagnostics["prompt_matches"] += 1
                if (prompt_match or job_match) and msg.get("attachments"):
                    diagnostics["matching_attachments"] += 1
                buttons = self._upscale_buttons(msg)
                if (prompt_match or job_match) and len(buttons) >= 4:
                    diagnostics["matching_controls"] += 1
                if len(buttons) >= 4:
                    diagnostics["grid_candidates"] += 1
                    exact_message = bool(
                        self.tracked_message_id and msg_id == self.tracked_message_id
                    )
                    from_midjourney = self._message_is_from_midjourney(msg)
                    has_midjourney_controls = self._message_has_midjourney_controls(msg)
                    after_baseline = self._message_is_after_baseline(msg)
                    title_match = self._message_matches_recipe_title(msg)
                    if from_midjourney:
                        diagnostics["midjourney_author_matches"] += 1
                    if has_midjourney_controls:
                        diagnostics["midjourney_control_matches"] += 1
                    if after_baseline:
                        diagnostics["post_baseline_candidates"] += 1
                    if title_match:
                        diagnostics["recipe_title_matches"] += 1
                    safe_fallback = (
                        (from_midjourney or has_midjourney_controls)
                        and after_baseline
                        and title_match
                    )
                    strong_identity_fallback = (
                        from_midjourney
                        and has_midjourney_controls
                        and after_baseline
                        and bool(msg.get("attachments"))
                    )
                    # A queued/progress interaction can remain on one Discord
                    # message while Relax mode posts the completed grid on a new
                    # message. Accept a new message when its prompt matches, or
                    # keep narrow fallbacks so newer/truncated Discord payloads
                    # do not hide the finished grid.
                    if (
                        self.tracked_message_id
                        and not exact_message
                        and not prompt_match
                        and not safe_fallback
                        and not strong_identity_fallback
                    ):
                        unmatched_grid_candidates += 1
                        continue
                    score = 6 if exact_message else 0
                    if prompt_match:
                        score += 4
                    elif job_match:
                        score += 2
                    if msg.get("attachments"):
                        score += 1
                    if score >= 2:
                        candidates.append((score, msg, buttons))
                    elif safe_fallback:
                        fallback_candidates.append((score, msg, buttons))
                        diagnostics["safe_fallback_candidates"] += 1
                    elif strong_identity_fallback:
                        strong_identity_candidates.append((score, msg, buttons))
                        diagnostics["strong_identity_candidates"] += 1
                    else:
                        unmatched_grid_candidates += 1
            except (KeyError, IndexError, TypeError, AttributeError):
                continue
        self._last_grid_scan = diagnostics
        if candidates:
            candidates.sort(key=lambda item: (item[0], self._message_sort_id(item[1])), reverse=True)
            _, best_msg, best_buttons = candidates[0]
            return self._accept_grid(best_msg, best_buttons)

        if len(fallback_candidates) == 1:
            _, best_msg, best_buttons = fallback_candidates[0]
            self._log(
                "Accepting the single post-baseline Midjourney grid by exact recipe title; "
                "the full prompt was not present in Discord's response."
            )
            return self._accept_grid(best_msg, best_buttons)

        if len(fallback_candidates) > 1:
            self._log("Ignoring Midjourney grids: multiple safe fallback candidates are ambiguous.")
        elif len(strong_identity_candidates) == 1:
            _, best_msg, best_buttons = strong_identity_candidates[0]
            self._log(
                "Accepting the single post-baseline Midjourney grid by app/control identity; "
                "Discord did not expose the expected prompt or recipe title."
            )
            return self._accept_grid(best_msg, best_buttons)
        elif len(strong_identity_candidates) > 1:
            self._log("Ignoring Midjourney grids: multiple strong identity fallback candidates are ambiguous.")
        elif unmatched_grid_candidates:
            diagnostics["unmatched_grid_candidates"] = unmatched_grid_candidates
            self._log(
                "Ignoring Midjourney grid candidate without an exact prompt or message-ID match "
                f"(grids={diagnostics['grid_candidates']}, "
                f"prompt={diagnostics['prompt_matches']}, "
                f"job={diagnostics['job_matches']}, "
                f"title={diagnostics['recipe_title_matches']}, "
                f"after_baseline={diagnostics['post_baseline_candidates']}, "
                f"mj_author={diagnostics['midjourney_author_matches']}, "
                f"mj_controls={diagnostics['midjourney_control_matches']}, "
                f"strong_identity={diagnostics['strong_identity_candidates']}, "
                f"tracked={self.tracked_message_id or 'none'}, "
                f"baseline={self.baseline_id or 'none'})."
            )
        return False

    def _track_progress_message(self, messages: list) -> bool:
        """Capture the first exact progress message and keep tracking only its ID."""
        if self.tracked_message_id:
            return True
        candidates = [
            msg for msg in messages
            if msg.get("id") and self._message_matches_job(msg)
        ]
        if not candidates:
            return False
        candidates.sort(key=self._message_sort_id)
        self.tracked_message_id = str(candidates[0]["id"])
        self._update_tracking(
            "tracking",
            tracked_message_id=self.tracked_message_id,
            last_polled_at=self._utcnow(),
            last_error=None,
        )
        self._log(f"Tracking Midjourney Discord message {self.tracked_message_id}.")
        return True

    def _poll_grid_once(self) -> bool:
        """Single Discord channel read to check for a grid message. Returns True if found."""
        if self.tracked_message_id:
            response = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages/{self.tracked_message_id}",
                headers=self._headers(),
                timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
            )
            if self._check_rate_limit(response):
                return False
            if response.status_code == 200:
                payload = response.json()
                if self._find_grid_in_messages([payload] if isinstance(payload, dict) else []):
                    return True
                # Do not return here: Discord/Midjourney may leave the progress
                # response on this ID and publish the completed grid under a new
                # public message ID, especially while using Relax mode.

        response = requests.get(
            f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
            headers=self._headers(),
            params={"after": self.baseline_id, "limit": 50},
            timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
        )
        if self._check_rate_limit(response):
            return False
        messages = response.json()
        if self._find_grid_in_messages(messages):
            return True
        self._track_progress_message(messages)
        return False

    def get_message(self, poll_interval: int = 5, grace_seconds: int = GRID_GRACE_PERIOD_SECONDS) -> None:
        """Poll Discord every poll_interval seconds until the grid appears or wait_time expires.
        After wait_time, sleeps grace_seconds and makes one final attempt before giving up."""
        self._log(f"Waiting up to {self.wait_time}s for Midjourney grid...")
        elapsed = 0
        while elapsed < self.wait_time:
            step = min(poll_interval, self.wait_time - elapsed)
            self._interruptible_sleep(step)
            elapsed += step
            try:
                if self._poll_grid_once():
                    self._log(f"Got grid message {self.message_id} after {elapsed}s")
                    return
                self._log(f"Grid not ready yet ({elapsed}/{self.wait_time}s)...")
            except Exception as e:
                self._log(f"Grid poll error (will retry): {e}")
        # Grace period: one last attempt after a short extra wait
        self._log(f"Grid not found after {self.wait_time}s — waiting {grace_seconds}s more for final check...")
        self._interruptible_sleep(grace_seconds)
        try:
            if self._poll_grid_once():
                self._log(f"Got grid message {self.message_id} after {elapsed + grace_seconds}s (grace period)")
                return
        except Exception as e:
            self._log(f"Final grid poll error: {e}")
        # Last-resort: fetch the most recent messages WITHOUT the after filter in case
        # the baseline_id was wrong (e.g. captured "0") or messages exceed limit=50.
        try:
            response = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                headers=self._headers(),
                params={"limit": 10},
                timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
            )
            if not self._check_rate_limit(response):
                if self._find_grid_in_messages(response.json()):
                    self._log(f"Got grid message {self.message_id} via fallback scan (baseline may have been off)")
                    return
        except Exception as e:
            self._log(f"Fallback scan error: {e}")
        scan = self._last_grid_scan
        self._log(
            "Midjourney Discord scan: "
            f"{scan.get('messages', 0)} recent message(s), "
            f"{scan.get('prompt_matches', 0)} prompt match(es), "
            f"{scan.get('matching_attachments', 0)} matching image message(s), "
            f"{scan.get('matching_controls', 0)} matching message(s) with U1-U4 controls."
        )
        if scan.get("matching_attachments", 0) and not scan.get("matching_controls", 0):
            detail = (
                "The matching Midjourney image is visible, but Discord did not return its "
                "U1-U4 upscale controls in the message payload"
            )
        elif scan.get("prompt_matches", 0):
            detail = "A matching Midjourney message was found, but it is not a completed grid yet"
        else:
            detail = (
                "No recent public Discord message matched this exact Midjourney prompt; "
                "the result may be ephemeral or outside the recent message window"
            )
        error = (
            f"No Midjourney grid found after {self.wait_time}s + {grace_seconds}s grace period. "
            f"{detail}"
        )
        self._update_tracking(
            "delayed" if self.tracked_message_id else "failed",
            tracked_message_id=self.tracked_message_id or None,
            delayed_at=self._utcnow() if self.tracked_message_id else None,
            last_polled_at=self._utcnow(),
            last_error=error,
        )
        raise ValueError(error)

    def choose_images(self, button_retries: int = 3) -> None:
        """Click U1–U4 to upscale all 4 grid images, retrying each button on failure."""
        url = "https://discord.com/api/v9/interactions"
        if not self.message_id or not self.custom_ids:
            self.get_message()
        if not self.custom_ids:
            raise ValueError("No buttons found to upscale images")
        # Record baseline just before triggering upscales so download_image can
        # find only the 4 upscaled images that belong to this recipe
        if not self.upscale_baseline_id or self.upscale_baseline_id == "0":
            self.upscale_baseline_id = self._get_latest_message_id()
        failed = 0
        for custom_id in self.custom_ids[:4]:
            if custom_id in self.requested_custom_ids:
                continue
            data = {
                "type": 3,
                "guild_id": self.guild_id,
                "channel_id": self.channel_id,
                "message_flags": 0,
                "message_id": self.message_id,
                "application_id": self.application_id,
                "session_id": self.session_id,
                "nonce": self._nonce(),
                "data": {"component_type": 2, "custom_id": custom_id},
            }
            sent = False
            for attempt in range(button_retries):
                response = requests.post(
                    url,
                    headers=self._headers(),
                    json=data,
                    timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
                )
                if response.status_code == 204:
                    sent = True
                    self.requested_custom_ids.append(custom_id)
                    self._update_tracking(
                        "upscaling",
                        upscale_baseline_message_id=self.upscale_baseline_id,
                        requested_custom_ids=list(self.requested_custom_ids),
                        expected_upscale_count=len(self.requested_custom_ids),
                        last_polled_at=self._utcnow(),
                        last_error=None,
                    )
                    break
                if self._check_rate_limit(response):
                    continue
                self._log(f"Upscale button attempt {attempt + 1}/{button_retries} failed (status {response.status_code})")
                if attempt < button_retries - 1:
                    self._interruptible_sleep(5)
            if not sent:
                failed += 1
                self._log(f"Upscale button {custom_id} failed after {button_retries} attempts — skipping")
            self._interruptible_sleep(self.upscale_gap_seconds)
        if not self.requested_custom_ids:
            raise ValueError("All 4 upscale buttons failed — Discord may be down")
        if failed:
            self._log(f"Warning: {failed}/4 upscale buttons failed — continuing with partial upscales")
        self.expected_upscale_count = len(self.requested_custom_ids)
        self._update_tracking(
            "upscaling",
            upscale_baseline_message_id=self.upscale_baseline_id,
            requested_custom_ids=list(self.requested_custom_ids),
            expected_upscale_count=self.expected_upscale_count,
            last_error=None,
        )
        self._log(
            f"Upscale requests ready ({self.expected_upscale_count}/4 tracked for this grid)"
        )

    def download_image(self, post_upscale_wait: int = 120, poll_interval: int = 30) -> list[str]:
        """Return only images linked to this generation's exact grid message."""
        after_id = getattr(self, "upscale_baseline_id", self.message_id)
        expected_count = max(1, int(getattr(self, "expected_upscale_count", 4)))
        linked_messages: dict[str, list[str]] = {
            f"saved-{index}": [url]
            for index, url in enumerate(self.image_urls)
            if url
        }
        elapsed = 0
        while elapsed < post_upscale_wait:
            step = min(poll_interval, post_upscale_wait - elapsed)
            self._interruptible_sleep(step)
            elapsed += step
            try:
                response = requests.get(
                    f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                    headers=self._headers(),
                    params={"after": after_id, "limit": 50},
                    timeout=DISCORD_HTTP_TIMEOUT_SECONDS,
                )
                if self._check_rate_limit(response):
                    continue
                for msg in response.json():
                    try:
                        if not msg.get("attachments") or not self._message_references_grid(msg):
                            continue
                        urls = [
                            str(attachment["url"])
                            for attachment in msg["attachments"]
                            if isinstance(attachment, dict) and attachment.get("url")
                        ]
                        if urls:
                            message_key = str(msg.get("id") or urls[0])
                            linked_messages[message_key] = urls
                    except (KeyError, IndexError, TypeError):
                        continue
                ordered_messages = sorted(
                    linked_messages.items(),
                    key=lambda item: self._message_sort_id({"id": item[0]}),
                )
                img_urls = list(dict.fromkeys(
                    url
                    for _message_id, urls in ordered_messages
                    for url in urls
                ))
                if len(img_urls) >= expected_count:
                    self.image_urls = img_urls[:expected_count]
                    self.result_message_ids = [
                        message_id
                        for message_id, _urls in ordered_messages
                        if not message_id.startswith("saved-")
                    ]
                    self._update_tracking(
                        "completed",
                        result_message_ids=list(self.result_message_ids),
                        image_urls=list(self.image_urls),
                        last_polled_at=self._utcnow(),
                        completed_at=self._utcnow(),
                        delayed_at=None,
                        last_error=None,
                    )
                    self._log(
                        f"Got all {expected_count} upscaled image(s) linked to grid "
                        f"{self.message_id} after {elapsed}s"
                    )
                    return list(self.image_urls)
                self.result_message_ids = [
                    message_id
                    for message_id, _urls in ordered_messages
                    if not message_id.startswith("saved-")
                ]
                self.image_urls = list(img_urls)
                self._update_tracking(
                    "upscaling",
                    result_message_ids=list(self.result_message_ids),
                    image_urls=list(self.image_urls),
                    last_polled_at=self._utcnow(),
                )
                self._log(
                    f"Upscaled images linked to grid {self.message_id}: "
                    f"{len(img_urls)}/{expected_count} ({elapsed}/{post_upscale_wait}s)..."
                )
            except Exception as e:
                self._log(f"Image download poll error (will retry): {e}")
        received_count = sum(len(urls) for urls in linked_messages.values())
        error = (
            f"Expected {expected_count} upscaled images linked to Midjourney grid "
            f"{self.message_id}, but received {received_count} after {post_upscale_wait}s"
        )
        self._update_tracking(
            "delayed",
            result_message_ids=list(self.result_message_ids),
            image_urls=list(dict.fromkeys(
                url for urls in linked_messages.values() for url in urls
            )),
            last_polled_at=self._utcnow(),
            delayed_at=self._utcnow(),
            last_error=error,
        )
        raise ValueError(error)


def generate_images(
    recipe_name: str,
    img_url: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    wait_time: int = DEFAULT_GRID_WAIT_SECONDS,
    upscale_gap_seconds: int = UPSCALE_GAP_SECONDS,
    post_upscale_wait_seconds: int = POST_UPSCALE_WAIT_SECONDS,
    max_attempts: int | None = INITIAL_SEND_MAX_ATTEMPTS,
    retry_delay_seconds: int = 15,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    tracking_state: dict | None = None,
    on_tracking_update: Callable[[dict], None] | None = None,
) -> list[str]:
    """High-level function to generate Midjourney images for a recipe.
    credentials dict must contain: discord_app_id, discord_guild, discord_channel,
    mj_version, mj_id, discord_auth
    """
    _log = log or print
    _should_stop = should_stop or (lambda: False)
    from .prompts import get_prompt
    tpl = get_prompt(prompts or {}, "midjourney_imagine")
    safe_recipe_name = _sanitize_mj_prompt(recipe_name, _log)
    prompt = tpl.format(recipe_name=safe_recipe_name, img_url=img_url, source_img=img_url)

    retry_delay = max(1, min(300, int(retry_delay_seconds)))
    post_wait = max(10, min(600, post_upscale_wait_seconds))
    attempts_limit = max(1, int(max_attempts)) if max_attempts is not None else None
    state = tracking_state or {}
    identity_changed = bool(
        (state.get("prompt") and str(state["prompt"]) != prompt)
        or (
            state.get("source_image_url")
            and str(state["source_image_url"]) != img_url
        )
    )
    if identity_changed:
        _log("Midjourney prompt or source image changed; starting a new tracked generation.")
        if on_tracking_update:
            try:
                on_tracking_update({
                    "status": "created",
                    "prompt": prompt,
                    "source_image_url": img_url,
                    "discord_session_id": None,
                    "interaction_nonce": None,
                    "baseline_message_id": None,
                    "tracked_message_id": None,
                    "grid_message_id": None,
                    "grid_custom_ids": [],
                    "grid_job_tokens": [],
                    "upscale_baseline_message_id": None,
                    "requested_custom_ids": [],
                    "expected_upscale_count": 4,
                    "result_message_ids": [],
                    "image_urls": [],
                    "cached_image_urls": [],
                    "last_error": None,
                    "submitted_at": None,
                    "grid_ready_at": None,
                    "delayed_at": None,
                    "completed_at": None,
                    "last_polled_at": None,
                })
            except Exception as exc:
                _log(f"Warning: could not reset Midjourney tracking state: {exc}")
        state = {}
    saved_urls = [str(value) for value in (state.get("image_urls") or []) if value]
    saved_expected = max(1, int(state.get("expected_upscale_count") or 4))
    if state.get("status") == "completed" and len(saved_urls) >= saved_expected:
        _log(
            f"Resuming completed Midjourney generation from grid "
            f"{state.get('grid_message_id') or state.get('tracked_message_id')}"
        )
        return saved_urls[:saved_expected]

    mj = MidjourneyApi(
        prompt=prompt,
        application_id=credentials.get("discord_app_id", ""),
        guild_id=credentials.get("discord_guild", ""),
        channel_id=credentials.get("discord_channel", ""),
        version=credentials.get("mj_version", ""),
        mj_id=credentials.get("mj_id", ""),
        authorization=credentials.get("discord_auth", ""),
        recipe_name=safe_recipe_name,
        source_img_url=img_url,
        wait_time=wait_time,
        upscale_gap_seconds=upscale_gap_seconds,
        log=_log,
        should_stop=_should_stop,
        tracking_state=state,
        on_tracking_update=on_tracking_update,
    )
    mj._update_tracking(
        recipe_name=safe_recipe_name,
        source_image_url=img_url,
        prompt=prompt,
        discord_application_id=mj.application_id,
        discord_guild_id=mj.guild_id,
        discord_channel_id=mj.channel_id,
        discord_command_version=mj.version,
        discord_command_id=mj.id,
        discord_session_id=mj.session_id,
    )

    resume_submitted = bool(
        state.get("status") in {"submitted", "tracking", "delayed"}
        and mj.baseline_id
        and mj.baseline_id != "0"
    )
    attempt = 0
    while not (mj.tracked_message_id or mj.message_id or resume_submitted):
        attempt += 1
        if _should_stop():
            mj._update_tracking("cancelled", last_error="Generation stopped by user")
            raise ValueError("Generation stopped by user")
        try:
            if attempts_limit is None:
                _log(f"Midjourney initial communication attempt {attempt}")
            else:
                _log(f"Midjourney initial communication attempt {attempt}/{attempts_limit}")

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
                error = (
                    f"Midjourney prompt send failed (status {send_resp.status_code})"
                    + (f": {body}" if body else "")
                )
                if send_resp.status_code in {400, 401, 403, 404}:
                    mj._update_tracking("failed", last_error=error)
                    raise MidjourneyPermanentError(error)
                raise ValueError(error)
            break
        except MidjourneyPermanentError:
            raise
        except Exception as e:
            if attempts_limit is None:
                _log(f"Midjourney initial communication failed (attempt {attempt}): {e}. Retrying in {retry_delay}s...")
            else:
                if attempt >= attempts_limit:
                    error = (
                        f"Midjourney initial communication failed after "
                        f"{attempts_limit} attempt(s): {e}"
                    )
                    mj._update_tracking("failed", last_error=error)
                    raise ValueError(error)
                _log(
                    f"Midjourney initial communication failed "
                    f"(attempt {attempt}/{attempts_limit}): {e}. Retrying in {retry_delay}s..."
                )
            for _ in range(retry_delay):
                if _should_stop():
                    mj._update_tracking("cancelled", last_error="Generation stopped by user")
                    raise ValueError("Generation stopped by user")
                time.sleep(1)

    if mj.tracked_message_id or mj.message_id:
        _log(
            f"Resuming Midjourney tracking from Discord message "
            f"{mj.message_id or mj.tracked_message_id}."
        )

    try:
        mj.choose_images()
        image_urls = mj.download_image(post_upscale_wait=post_wait)
    except Exception as exc:
        message = str(exc)
        if message == "Generation stopped by user":
            mj._update_tracking("cancelled", last_error=message)
        elif mj.tracking_status not in {"delayed", "failed"}:
            mj._update_tracking("failed", last_error=message)
        raise
    if not image_urls:
        mj._update_tracking("failed", last_error="Midjourney returned no image URLs")
        raise ValueError("Midjourney returned no image URLs")
    return image_urls
