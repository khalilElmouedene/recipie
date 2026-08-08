from __future__ import annotations

DEFAULT_GRID_WAIT_SECONDS = 600
MIN_GRID_WAIT_SECONDS = 600
MAX_GRID_WAIT_SECONDS = 900

UPSCALE_GAP_SECONDS = 10
POST_UPSCALE_WAIT_SECONDS = 600
GRID_GRACE_PERIOD_SECONDS = 120  # extra wait + one final poll after wait_time expires

DISCORD_HTTP_TIMEOUT_SECONDS = 15
INITIAL_SEND_MAX_ATTEMPTS = 3

# Maximum number of concurrent Midjourney generations allowed per Discord account.
# Running too many at once on a single account triggers Discord/Midjourney bans.
MAX_CONCURRENT_MJ_PER_ACCOUNT = 2


def clamp_grid_wait(seconds: int) -> int:
    return max(MIN_GRID_WAIT_SECONDS, min(MAX_GRID_WAIT_SECONDS, int(seconds)))
