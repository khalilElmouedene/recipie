from datetime import datetime, timezone
import unittest
import uuid
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.db_models import FacebookContentStatus, FacebookDeliveryStatus
from app.routes.facebook import (
    FacebookDeliveryScheduleUpdate,
    schedule_facebook_delivery,
)
from app.services.facebook_schedule import (
    FacebookSchedulePolicy,
    generate_schedule_slots,
    validate_policy,
)


def _local_times(slots, timezone_name="UTC"):
    zone = timezone.utc if timezone_name == "UTC" else ZoneInfo(timezone_name)
    return [slot.astimezone(zone).strftime("%Y-%m-%d %H:%M") for slot in slots]


class FacebookScheduleTests(unittest.TestCase):
    def test_example_window_rolls_remaining_posts_to_next_day(self):
        policy = FacebookSchedulePolicy(
            start_time="12:00",
            end_time="19:00",
            max_posts_per_day=10,
            interval_minutes=180,
            timezone_name="UTC",
        )
        slots = generate_schedule_slots(
            start_at=datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc),
            count=5,
            policy=policy,
        )

        self.assertEqual(
            _local_times(slots),
            [
                "2026-01-01 12:00",
                "2026-01-01 15:00",
                "2026-01-01 18:00",
                "2026-01-02 12:00",
                "2026-01-02 15:00",
            ],
        )

    def test_daily_maximum_applies_even_when_window_has_more_slots(self):
        policy = FacebookSchedulePolicy(
            start_time="09:00",
            end_time="18:00",
            max_posts_per_day=2,
            interval_minutes=60,
            timezone_name="UTC",
        )
        slots = generate_schedule_slots(
            start_at=datetime(2026, 2, 10, 8, 0, tzinfo=timezone.utc),
            count=4,
            policy=policy,
        )

        self.assertEqual(
            _local_times(slots, "UTC"),
            [
                "2026-02-10 09:00",
                "2026-02-10 10:00",
                "2026-02-11 09:00",
                "2026-02-11 10:00",
            ],
        )

    def test_existing_deliveries_reserve_daily_capacity_and_matching_slots(self):
        policy = FacebookSchedulePolicy(
            start_time="12:00",
            end_time="19:00",
            max_posts_per_day=3,
            interval_minutes=180,
            timezone_name="UTC",
        )
        slots = generate_schedule_slots(
            start_at=datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc),
            count=3,
            policy=policy,
            existing=[datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)],
        )

        self.assertEqual(
            _local_times(slots, "UTC"),
            [
                "2026-03-01 15:00",
                "2026-03-01 18:00",
                "2026-03-02 12:00",
            ],
        )

    def test_invalid_schedule_policy_is_rejected(self):
        invalid = [
            FacebookSchedulePolicy(start_time="19:00", end_time="12:00"),
            FacebookSchedulePolicy(max_posts_per_day=0),
            FacebookSchedulePolicy(interval_minutes=0),
            FacebookSchedulePolicy(timezone_name="Not/A_Timezone"),
        ]
        for policy in invalid:
            with self.subTest(policy=policy):
                with self.assertRaises(ValueError):
                    validate_policy(policy)


class _ScheduleResult:
    def __init__(self, record):
        self.record = record

    def one_or_none(self):
        return self.record


class _ScheduleSession:
    def __init__(self, record):
        self.record = record
        self.commits = 0

    async def execute(self, _statement):
        return _ScheduleResult(self.record)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        return None


class FacebookDeliveryScheduleStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_published_delivery_cannot_be_rescheduled(self):
        owner_id = uuid.uuid4()
        delivery = SimpleNamespace(
            status=FacebookDeliveryStatus.published,
            scheduled_at=None,
            published_at=datetime.now(timezone.utc),
            facebook_post_id="reel-123",
            error_message=None,
        )
        content = SimpleNamespace(status=FacebookContentStatus.ready)
        page = SimpleNamespace(id=uuid.uuid4(), name="Recipe Page")
        project = SimpleNamespace(owner_id=owner_id)
        session = _ScheduleSession((delivery, content, page, project))

        with self.assertRaises(HTTPException) as raised:
            await schedule_facebook_delivery(
                uuid.uuid4(),
                FacebookDeliveryScheduleUpdate(
                    scheduled_at=datetime.now(timezone.utc),
                ),
                SimpleNamespace(id=owner_id),
                session,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(session.commits, 0)
        self.assertEqual(delivery.status, FacebookDeliveryStatus.published)
