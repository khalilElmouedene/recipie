from __future__ import annotations

from fastapi import Response
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


def apply_limit_offset(stmt: Select, limit: int | None, offset: int) -> Select:
    if offset:
        stmt = stmt.offset(offset)
    if limit is not None:
        stmt = stmt.limit(limit)
    return stmt


async def count_rows(db: AsyncSession, stmt: Select) -> int:
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = await db.scalar(count_stmt)
    return int(total or 0)


def set_total_count(response: Response, total: int) -> None:
    response.headers["X-Total-Count"] = str(total)
