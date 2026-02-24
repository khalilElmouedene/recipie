from __future__ import annotations
import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy import select

from ..config import settings
from ..database import SessionLocal
from ..db_models import User, Job
from ..dependencies import check_project_access
from ..workers.job_manager import job_manager

router = APIRouter()


@router.websocket("/ws/logs/{job_id}")
async def websocket_logs(websocket: WebSocket, job_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=4001, reason="Invalid token")
            return
    except JWTError:
        await websocket.close(code=4001, reason="Invalid token")
        return

    async with SessionLocal() as db:
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return

        job_result = await db.execute(select(Job).where(Job.id == uuid.UUID(job_id)))
        job = job_result.scalar_one_or_none()
        if not job:
            await websocket.close(code=4004, reason="Job not found")
            return

        try:
            await check_project_access(job.project_id, user, db)
        except Exception:
            await websocket.close(code=4003, reason="Access denied")
            return

    await websocket.accept()

    rj = job_manager.get_running(job_id)
    if not rj:
        await websocket.send_text("Job not currently running")
        await websocket.close()
        return

    queue = rj.subscribe()
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                await websocket.send_text("")
            except WebSocketDisconnect:
                break
    finally:
        rj.unsubscribe(queue)
