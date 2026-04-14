from __future__ import annotations

import enum
import uuid
from contextvars import ContextVar
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session


_actor_user_id_ctx: ContextVar[str | None] = ContextVar("audit_actor_user_id", default=None)
_actor_email_ctx: ContextVar[str | None] = ContextVar("audit_actor_email", default=None)
_request_method_ctx: ContextVar[str | None] = ContextVar("audit_request_method", default=None)
_request_path_ctx: ContextVar[str | None] = ContextVar("audit_request_path", default=None)
_ip_address_ctx: ContextVar[str | None] = ContextVar("audit_ip_address", default=None)

_AUDIT_REGISTERED = False
_MAX_TEXT_LENGTH = 2000
_SKIP_TABLES = {"audit_logs", "job_logs"}
_SENSITIVE_TOKENS = ("password", "token", "secret", "encrypted", "access_key", "private_key")
_SENSITIVE_KEYS = {
    "password_hash",
    "wp_password_enc",
    "wp_users_enc",
    "encrypted_value",
    "app_secret",
    "access_token",
    "token_hash",
}


def set_audit_actor(user_id: uuid.UUID | str | None, email: str | None = None) -> None:
    _actor_user_id_ctx.set(str(user_id) if user_id else None)
    _actor_email_ctx.set(email or None)


def set_audit_request_context(method: str | None, path: str | None, ip_address: str | None) -> None:
    _request_method_ctx.set(method or None)
    _request_path_ctx.set(path or None)
    _ip_address_ctx.set(ip_address or None)


def clear_audit_context() -> None:
    _actor_user_id_ctx.set(None)
    _actor_email_ctx.set(None)
    _request_method_ctx.set(None)
    _request_path_ctx.set(None)
    _ip_address_ctx.set(None)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in _SENSITIVE_KEYS:
        return True
    return any(token in lowered for token in _SENSITIVE_TOKENS)


def _serialize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > _MAX_TEXT_LENGTH:
            return value[:_MAX_TEXT_LENGTH] + "...[truncated]"
        return value
    if isinstance(value, (uuid.UUID, datetime, enum.Enum, Decimal)):
        return str(value.value) if isinstance(value, enum.Enum) else str(value)
    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"
    if isinstance(value, list):
        return [_serialize_value(v) for v in value]
    if isinstance(value, tuple):
        return [_serialize_value(v) for v in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            out[key] = "[REDACTED]" if _is_sensitive_key(key) else _serialize_value(v)
        return out
    return str(value)


def _snapshot_instance(instance: Any) -> dict[str, Any]:
    state = inspect(instance)
    snapshot: dict[str, Any] = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        raw = getattr(instance, key, None)
        snapshot[key] = "[REDACTED]" if _is_sensitive_key(key) else _serialize_value(raw)
    return snapshot


def _entity_pk(instance: Any) -> str | None:
    state = inspect(instance)
    parts: list[str] = []
    for col in state.mapper.primary_key:
        key = col.key
        value = getattr(instance, key, None)
        parts.append(f"{key}={_serialize_value(value)}")
    joined = ",".join(parts).strip()
    return joined or None


def register_audit_listeners() -> None:
    global _AUDIT_REGISTERED
    if _AUDIT_REGISTERED:
        return
    _AUDIT_REGISTERED = True

    from .db_models import AuditLog

    @event.listens_for(Session, "before_flush")
    def _audit_before_flush(session: Session, flush_context, instances) -> None:  # noqa: ANN001
        if session.info.get("_audit_in_progress"):
            return

        audit_entries: list[AuditLog] = []
        actor_user_id = _actor_user_id_ctx.get()
        actor_email = _actor_email_ctx.get()
        request_method = _request_method_ctx.get()
        request_path = _request_path_ctx.get()
        ip_address = _ip_address_ctx.get()

        def _make_entry(
            *,
            action: str,
            instance: Any,
            old_values: dict[str, Any] | None,
            new_values: dict[str, Any] | None,
            changed_fields: list[str] | None,
        ) -> None:
            table_name = getattr(instance, "__tablename__", "")
            if not table_name or table_name in _SKIP_TABLES:
                return
            actor_uuid = None
            if actor_user_id:
                try:
                    actor_uuid = uuid.UUID(actor_user_id)
                except Exception:
                    actor_uuid = None
            audit_entries.append(
                AuditLog(
                    actor_user_id=actor_uuid,
                    actor_email=actor_email,
                    action=action,
                    table_name=table_name,
                    entity_pk=_entity_pk(instance),
                    changed_fields=changed_fields,
                    old_values=old_values,
                    new_values=new_values,
                    request_method=request_method,
                    request_path=request_path,
                    ip_address=ip_address,
                )
            )

        for instance in list(session.new):
            if isinstance(instance, AuditLog):
                continue
            if not hasattr(instance, "__table__"):
                continue
            new_values = _snapshot_instance(instance)
            _make_entry(
                action="insert",
                instance=instance,
                old_values=None,
                new_values=new_values,
                changed_fields=list(new_values.keys()),
            )

        for instance in list(session.dirty):
            if isinstance(instance, AuditLog):
                continue
            if instance in session.new or instance in session.deleted:
                continue
            if not hasattr(instance, "__table__"):
                continue
            if not session.is_modified(instance, include_collections=False):
                continue

            state = inspect(instance)
            old_values: dict[str, Any] = {}
            new_values: dict[str, Any] = {}
            changed_fields: list[str] = []

            for attr in state.mapper.column_attrs:
                key = attr.key
                history = state.attrs[key].history
                if not history.has_changes():
                    continue
                old_raw = history.deleted[0] if history.deleted else None
                new_raw = history.added[0] if history.added else getattr(instance, key, None)
                if _is_sensitive_key(key):
                    old_values[key] = "[REDACTED]"
                    new_values[key] = "[REDACTED]"
                else:
                    old_values[key] = _serialize_value(old_raw)
                    new_values[key] = _serialize_value(new_raw)
                changed_fields.append(key)

            if not changed_fields:
                continue

            _make_entry(
                action="update",
                instance=instance,
                old_values=old_values,
                new_values=new_values,
                changed_fields=changed_fields,
            )

        for instance in list(session.deleted):
            if isinstance(instance, AuditLog):
                continue
            if not hasattr(instance, "__table__"):
                continue
            old_values = _snapshot_instance(instance)
            _make_entry(
                action="delete",
                instance=instance,
                old_values=old_values,
                new_values=None,
                changed_fields=list(old_values.keys()),
            )

        if not audit_entries:
            return

        session.info["_audit_in_progress"] = True
        try:
            session.add_all(audit_entries)
        finally:
            session.info["_audit_in_progress"] = False
