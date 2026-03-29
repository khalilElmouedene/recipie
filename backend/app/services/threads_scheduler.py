from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.crypto import decrypt
from app.database import SessionLocal
from app.db_models import ThreadsAccount, ThreadsPost, ThreadsPostStatus
from app.services.threads_api import add_reply, publish_post


async def run_threads_scheduler(stop_event: asyncio.Event) -> None:
    """Background loop: publish scheduled Threads posts whose scheduled_at has arrived."""
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            rows = await db.execute(
                select(ThreadsPost).where(
                    ThreadsPost.status == ThreadsPostStatus.scheduled,
                    ThreadsPost.scheduled_at.isnot(None),
                    ThreadsPost.scheduled_at <= now,
                )
            )
            posts = rows.scalars().all()

            for post in posts:
                try:
                    # Load the linked account to get the decrypted token
                    acc_row = await db.execute(
                        select(ThreadsAccount).where(ThreadsAccount.id == post.account_id)
                    )
                    account = acc_row.scalar_one_or_none()
                    if account is None:
                        post.status = ThreadsPostStatus.failed
                        post.error_message = "Linked Threads account not found"
                        continue

                    access_token = decrypt(account.access_token)
                    threads_user_id = account.threads_user_id

                    threads_post_id = publish_post(
                        access_token=access_token,
                        user_id=threads_user_id,
                        text=post.text_content,
                        image_url=post.image_url,
                    )

                    # Optionally post first comment as a reply
                    if post.first_comment:
                        try:
                            add_reply(
                                access_token=access_token,
                                user_id=threads_user_id,
                                post_id=threads_post_id,
                                text=post.first_comment,
                            )
                        except Exception as reply_exc:
                            # Non-fatal: the main post succeeded
                            print(f"[threads_scheduler] reply failed for post {post.id}: {reply_exc}")

                    post.status = ThreadsPostStatus.published
                    post.published_at = datetime.now(timezone.utc)
                    post.threads_post_id = threads_post_id
                    post.error_message = None

                except Exception as exc:
                    post.status = ThreadsPostStatus.failed
                    post.error_message = str(exc)

            await db.commit()

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
