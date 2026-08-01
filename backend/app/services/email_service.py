from __future__ import annotations
import smtplib
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import partial
import html

from ..config import settings


def _send_sync(to_email: str, subject: str, html_body: str) -> None:
    if not settings.smtp_user or not settings.smtp_password:
        print(f"[email] SMTP not configured — skipping email to {to_email}")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_user}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_user, to_email, msg.as_string())


async def send_email(to_email: str, subject: str, html_body: str) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, partial(_send_sync, to_email, subject, html_body))


async def send_welcome_email(to_email: str, full_name: str, setup_link: str) -> None:
    subject = "Welcome to Recipe Generator — Set your password"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">Welcome, {full_name}!</h2>
      <p style="color:#475569">An account has been created for you on <strong>Recipe Generator</strong>.</p>
      <p style="color:#475569">Click the button below to set your password. This link expires in <strong>5 minutes</strong>.</p>
      <a href="{setup_link}"
         style="display:inline-block;margin:16px 0;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
        Set My Password
      </a>
      <p style="color:#94a3b8;font-size:13px">If you did not expect this email, you can ignore it.</p>
      <p style="color:#94a3b8;font-size:13px">Or copy this link: {setup_link}</p>
    </div>
    """
    await send_email(to_email, subject, html)


async def send_password_reset_email(to_email: str, reset_link: str) -> None:
    subject = "Reset your Recipe Generator password"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">Reset your password</h2>
      <p style="color:#475569">We received a request to reset the password for your <strong>Recipe Generator</strong> account.</p>
      <p style="color:#475569">Click the button below to choose a new password. This link expires in <strong>15 minutes</strong>.</p>
      <a href="{reset_link}"
         style="display:inline-block;margin:16px 0;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
        Reset My Password
      </a>
      <p style="color:#94a3b8;font-size:13px">If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
      <p style="color:#94a3b8;font-size:13px">Or copy this link: {reset_link}</p>
    </div>
    """
    await send_email(to_email, subject, html)


async def send_project_invite_email(
    to_email: str, full_name: str, project_name: str, role: str, app_url: str
) -> None:
    subject = f"You've been added to project \"{project_name}\""
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="color:#1e293b">Hi {full_name},</h2>
      <p style="color:#475569">You have been added to the project <strong>{project_name}</strong> as <strong>{role}</strong>.</p>
      <a href="{app_url}"
         style="display:inline-block;margin:16px 0;padding:12px 24px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
        Open Recipe Generator
      </a>
    </div>
    """
    await send_email(to_email, subject, html)


async def send_facebook_spy_sheet_low_email(
    to_email: str,
    full_name: str,
    project_name: str,
    remaining_rows: int,
) -> None:
    safe_name = html.escape(full_name or "there")
    safe_project = html.escape(project_name)
    plural = "s" if remaining_rows != 1 else ""
    await send_email(
        to_email,
        f"Facebook Spy Sheet is running low - {project_name}",
        f"""
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
          <h2 style="color:#1877f2">Your Facebook Spy Sheet needs more data</h2>
          <p>Hi {safe_name},</p>
          <p>
            The Spy Sheet for <strong>{safe_project}</strong> has
            <strong>{remaining_rows}</strong> row{plural} remaining.
          </p>
          <p>Add more video links and post titles now so the generation queue does not run empty.</p>
        </div>
        """,
    )
