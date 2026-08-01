from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class FacebookSchedulePolicy:
    start_time: str = "12:00"
    end_time: str = "19:00"
    max_posts_per_day: int = 10
    interval_minutes: int = 180
    timezone_name: str = "UTC"


def _parse_time(value: str) -> time:
    try:
        hour, minute = value.split(":", 1)
        parsed = time(hour=int(hour), minute=int(minute))
    except (TypeError, ValueError):
        raise ValueError(f"Invalid time '{value}'. Expected HH:MM.")
    return parsed


def _timezone(name: str) -> tzinfo:
    if (name or "UTC").upper() == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone '{name}'.") from exc


def validate_policy(policy: FacebookSchedulePolicy) -> None:
    start = _parse_time(policy.start_time)
    end = _parse_time(policy.end_time)
    if end <= start:
        raise ValueError("Publishing end time must be later than start time.")
    if not 1 <= policy.max_posts_per_day <= 100:
        raise ValueError("Maximum posts per day must be between 1 and 100.")
    if not 1 <= policy.interval_minutes <= 1440:
        raise ValueError("Publishing interval must be between 1 and 1440 minutes.")
    _timezone(policy.timezone_name)


def _day_slots(day: date, policy: FacebookSchedulePolicy, tz: tzinfo) -> list[datetime]:
    start_clock = _parse_time(policy.start_time)
    end_clock = _parse_time(policy.end_time)
    cursor = datetime.combine(day, start_clock, tzinfo=tz)
    end_at = datetime.combine(day, end_clock, tzinfo=tz)
    slots: list[datetime] = []
    while cursor <= end_at and len(slots) < policy.max_posts_per_day:
        slots.append(cursor)
        cursor += timedelta(minutes=policy.interval_minutes)
    return slots


def generate_schedule_slots(
    *,
    start_at: datetime,
    count: int,
    policy: FacebookSchedulePolicy,
    existing: list[datetime] | None = None,
) -> list[datetime]:
    """Return UTC publication slots that obey a page's local daily window.

    Existing future deliveries count toward the daily maximum and reserve their
    matching time slots. Remaining work automatically rolls to following days.
    """
    if count <= 0:
        return []
    validate_policy(policy)
    tz = _timezone(policy.timezone_name)
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=timezone.utc)
    local_start = start_at.astimezone(tz)

    local_existing = [
        item.replace(tzinfo=timezone.utc).astimezone(tz)
        if item.tzinfo is None
        else item.astimezone(tz)
        for item in (existing or [])
    ]
    existing_by_day: dict[date, list[datetime]] = {}
    for item in local_existing:
        existing_by_day.setdefault(item.date(), []).append(item)

    result: list[datetime] = []
    day = local_start.date()
    for _ in range(3660):
        occupied = existing_by_day.get(day, [])
        remaining_capacity = max(0, policy.max_posts_per_day - len(occupied))
        if remaining_capacity:
            for candidate in _day_slots(day, policy, tz):
                if candidate < local_start:
                    continue
                if any(abs((candidate - item).total_seconds()) < 30 for item in occupied):
                    continue
                result.append(candidate.astimezone(timezone.utc))
                remaining_capacity -= 1
                if len(result) == count:
                    return result
                if remaining_capacity == 0:
                    break
        day += timedelta(days=1)

    raise ValueError("Unable to allocate publication slots in the next ten years.")
