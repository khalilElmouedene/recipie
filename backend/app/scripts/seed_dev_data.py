"""
Seed the database with one project, sites, and credentials.
All keys are read from:
  - article_writ (1) (1).py  → OpenAI API key, Discord/Midjourney (app id, guild, channel, version, mj id, auth)
  - Articles_Publishing_Winsome (1).py → WordPress URL/domain, spreadsheet/sheet, WP accounts

Place both files in the project root (same folder as backend/). Fallbacks used only if a file is missing.

Run: docker compose exec backend python -m app.scripts.seed_dev_data
  or: cd backend && python -m app.scripts.seed_dev_data
"""
from __future__ import annotations
import asyncio
import glob
import os
import re

# Load .env only for ENCRYPTION_KEY / DATABASE_URL (optional)
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
if os.path.isfile(env_path):
    from dotenv import load_dotenv
    load_dotenv(env_path)

# Fallback when key files are not found; openai used directly so seed always has a key
_LOCAL_KEYS = {
    "openai": "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",
    "discord_app_id": "",
    "discord_guild": "",
    "discord_channel": "",
    "mj_version": "",
    "mj_id": "",
    "discord_auth": "",
}
_LOCAL_WINSOME = {
    "wp_url": "",
    "wp_domain": "",
    "wp_user": "",
    "wp_pass": "",
    "spreadsheet_id": "",
    "sheet_name": "",
}

from sqlalchemy import select
from app.database import SessionLocal
from app.db_models import (
    User, UserRole, Project, ProjectMember,
    ProjectCredential, Site,
)
from app.auth import hash_password
from app.crypto import encrypt


def _workspace_root() -> str | None:
    if os.path.isdir("/workspace"):
        return "/workspace"
    # backend_dir = .../backend; parent = repo root
    parent = os.path.dirname(backend_dir)
    if os.path.isdir(parent):
        return parent
    return None


def _find_article_writ_path(root: str) -> str | None:
    for name in [
        "article_writ (1) (1).py",
        "article_writ (1)(1).py",
        "article_writ(1)(1).py",
    ]:
        p = os.path.join(root, name)
        if os.path.isfile(p):
            return p
    for p in glob.glob(os.path.join(root, "article_writ*.py")):
        if os.path.isfile(p):
            return p
    return None


def _find_winsome_path(root: str) -> str | None:
    for name in [
        "Articles_Publishing_Winsome (1).py",
        "Articles_Publishing_Winsome(1).py",
    ]:
        p = os.path.join(root, name)
        if os.path.isfile(p):
            return p
    for p in glob.glob(os.path.join(root, "Articles_Publishing*.py")):
        if os.path.isfile(p):
            return p
    return None


def _extract_from_article_writ(root: str) -> dict[str, str]:
    path = _find_article_writ_path(root)
    out = {}
    if not path:
        return out
    try:
        text = open(path, "r", encoding="utf-8", errors="ignore").read()
        # OpenAI: client = OpenAI(api_key="sk-...") or OpenAI(api_key='sk-...')
        for pat in [
            r'OpenAI\s*\(\s*api_key\s*=\s*["\']([^"\']+)["\']',
            r'client\s*=\s*OpenAI\s*\(\s*api_key\s*=\s*["\']([^"\']+)["\']',
            r'api_key\s*=\s*["\'](sk-[^"\']+)["\']',
        ]:
            m = re.search(pat, text)
            if m:
                val = m.group(1).strip()
                if val.startswith("sk-"):
                    out["openai"] = val
                    break
        # MidjourneyApi(prompt, app_id, guild_id, channel_id, version, cmd_id, auth) — 6 quoted strings after first arg
        block = re.search(
            r'MidjourneyApi\s*\(\s*(?:[^,]+,)\s*([^)]+)\)',
            text,
            re.DOTALL,
        )
        if block:
            inner = block.group(1)
            quoted = re.findall(r'["\']([^"\']+)["\']', inner)
            if len(quoted) >= 6:
                out["discord_app_id"] = quoted[0].strip()
                out["discord_guild"] = quoted[1].strip()
                out["discord_channel"] = quoted[2].strip()
                out["mj_version"] = quoted[3].strip()
                out["mj_id"] = quoted[4].strip()
                out["discord_auth"] = quoted[5].strip()
    except Exception as e:
        print(f"Note: could not read article_writ file: {e}")
    return out


def _extract_from_winsome(root: str) -> dict[str, str]:
    path = _find_winsome_path(root)
    out = {}
    if not path:
        return out
    try:
        text = open(path, "r", encoding="utf-8", errors="ignore").read()
        m = re.search(r'WORDPRESS_URL\s*=\s*["\']([^"\']+)["\']', text)
        if m:
            out["wp_url"] = m.group(1).strip()
        m = re.search(r'WORDPRESS_DOMAIN\s*=\s*["\']([^"\']+)["\']', text)
        if m:
            out["wp_domain"] = m.group(1).strip().rstrip("/")
        m = re.search(r'SPREADSHEET_ID\s*=\s*["\']([^"\']+)["\']', text)
        if m:
            out["spreadsheet_id"] = m.group(1).strip()
        m = re.search(r'SHEET_NAME\s*=\s*["\']([^"\']+)["\']', text)
        if m:
            out["sheet_name"] = m.group(1).strip()
        # First WP account: ("John", "eZHg ...") or ('user', 'pass')
        accounts = re.search(
            r'WP_ACCOUNTS\s*=\s*\[\s*(.*?)\s*\]',
            text,
            re.DOTALL,
        )
        if accounts:
            first = re.search(
                r'\(\s*["\']([^"\']*)["\']\s*,\s*["\']([^"\']*)["\']\s*\)',
                accounts.group(1),
            )
            if first:
                out["wp_user"] = first.group(1).strip()
                out["wp_pass"] = first.group(2).strip()
    except Exception as e:
        print(f"Note: could not read Articles_Publishing file: {e}")
    return out


def _get_sites_config(workspace: str | None, spreadsheet_id: str) -> list[dict]:
    winsome = _extract_from_winsome(workspace) if workspace else {}
    # Use extracted values; fall back to _LOCAL_WINSOME only for missing keys
    wp_url = winsome.get("wp_url") or _LOCAL_WINSOME.get("wp_url")
    wp_domain = winsome.get("wp_domain") or _LOCAL_WINSOME.get("wp_domain")
    sites = []
    if wp_url and wp_domain:
        domain = wp_domain.replace("https://", "").replace("http://", "").split("/")[0]
        sites.append({
            "domain": domain,
            "wp_url": wp_url,
            "wp_user": winsome.get("wp_user") or _LOCAL_WINSOME.get("wp_user", ""),
            "wp_pass": winsome.get("wp_pass") or _LOCAL_WINSOME.get("wp_pass", ""),
            "sheet_name": winsome.get("sheet_name") or _LOCAL_WINSOME.get("sheet_name", ""),
            "spreadsheet_id": winsome.get("spreadsheet_id") or spreadsheet_id or _LOCAL_WINSOME.get("spreadsheet_id", ""),
        })
    return sites


PROJECT_NAME = os.getenv("SEED_PROJECT_NAME", "Winsome Dev")
OWNER_EMAIL = os.getenv("SEED_OWNER_EMAIL", "admin@example.com")
OWNER_PASSWORD = os.getenv("SEED_OWNER_PASSWORD", "dev123456")
OWNER_NAME = os.getenv("SEED_OWNER_NAME", "Dev Owner")


async def seed():
    workspace = _workspace_root()
    from_article = _extract_from_article_writ(workspace) if workspace else {}
    from_winsome = _extract_from_winsome(workspace) if workspace else {}

    def _get(key: str, from_file: dict) -> str:
        return (from_file.get(key) or _LOCAL_KEYS.get(key) or "").strip()

    openai_key = _get("openai", from_article)
    discord_auth = _get("discord_auth", from_article)
    discord_app_id = _get("discord_app_id", from_article)
    discord_guild = _get("discord_guild", from_article)
    discord_channel = _get("discord_channel", from_article)
    mj_version = _get("mj_version", from_article)
    mj_id = _get("mj_id", from_article)

    spreadsheet_id = (from_winsome.get("spreadsheet_id") or _LOCAL_WINSOME.get("spreadsheet_id") or "").strip()

    if from_article:
        print("Loaded OpenAI + Discord/Midjourney keys from article_writ (1) (1).py")
    else:
        print("Warning: article_writ (1) (1).py not found in project root — no API keys will be seeded.")
    if from_winsome:
        print("Loaded WordPress + Sheets config from Articles_Publishing_Winsome (1).py")
    else:
        print("Warning: Articles_Publishing_Winsome (1).py not found in project root — no site will be seeded.")

    async with SessionLocal() as db:
        r = await db.execute(select(User).limit(1))
        existing_user = r.scalar_one_or_none()
        if not existing_user:
            owner = User(
                email=OWNER_EMAIL,
                password_hash=hash_password(OWNER_PASSWORD),
                full_name=OWNER_NAME,
                role=UserRole.owner,
            )
            db.add(owner)
            await db.commit()
            r_owner = await db.execute(select(User).where(User.email == OWNER_EMAIL))
            owner = r_owner.scalar_one()
            print(f"Created owner: {owner.email}")
            owner_id = owner.id
        else:
            owner_id = existing_user.id
            print(f"Using existing user: {existing_user.email}")

        r = await db.execute(select(Project).where(Project.name == PROJECT_NAME))
        project = r.scalar_one_or_none()
        if not project:
            project = Project(
                name=PROJECT_NAME,
                description="Seeded for dev – generation only",
                owner_id=owner_id,
            )
            db.add(project)
            await db.commit()
            r2 = await db.execute(select(Project).where(Project.name == PROJECT_NAME))
            project = r2.scalar_one()
            print(f"Created project: {project.name}")
        else:
            print(f"Project already exists: {project.name}")

        project_id = project.id

        creds_to_set = [
            ("openai", openai_key),
            ("discord_auth", discord_auth),
            ("discord_app_id", discord_app_id),
            ("discord_guild", discord_guild),
            ("discord_channel", discord_channel),
            ("mj_version", mj_version),
            ("mj_id", mj_id),
        ]
        for key_type, value in creds_to_set:
            if not value:
                continue
            r = await db.execute(
                select(ProjectCredential).where(
                    ProjectCredential.project_id == project_id,
                    ProjectCredential.key_type == key_type,
                )
            )
            cred = r.scalar_one_or_none()
            enc = encrypt(value)
            if cred:
                cred.encrypted_value = enc
            else:
                cred = ProjectCredential(
                    project_id=project_id,
                    key_type=key_type,
                    encrypted_value=enc,
                )
                db.add(cred)
        await db.commit()
        print("Credentials set (OpenAI + Discord/Midjourney)")

        sites_config = _get_sites_config(workspace, spreadsheet_id)
        for site_cfg in sites_config:
            r = await db.execute(
                select(Site).where(
                    Site.project_id == project_id,
                    Site.domain == site_cfg["domain"],
                )
            )
            if r.scalar_one_or_none():
                continue
            site = Site(
                project_id=project_id,
                domain=site_cfg["domain"],
                wp_url=site_cfg["wp_url"],
                wp_username=site_cfg.get("wp_user", "fill-in"),
                wp_password_enc=encrypt(site_cfg.get("wp_pass", "placeholder")),
                sheet_name=site_cfg.get("sheet_name", ""),
                spreadsheet_id=site_cfg.get("spreadsheet_id", spreadsheet_id),
            )
            db.add(site)
        await db.commit()
        print(f"Sites: {[s['domain'] for s in sites_config]}")

    print("Seed done. Log in with", OWNER_EMAIL, "/", OWNER_PASSWORD)


if __name__ == "__main__":
    asyncio.run(seed())
