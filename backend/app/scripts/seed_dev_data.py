"""
Seed the database with one project, sites, and credentials.
Keys are taken from article_writ (1) (1).py and Articles_Publishing_Winsome (1).py.
If files not found, uses hardcoded local fallback (local project only).

Run: docker compose exec backend python -m app.scripts.seed_dev_data
"""
from __future__ import annotations
import asyncio
import os
import re

# Load .env only for ENCRYPTION_KEY / DATABASE_URL (required to run)
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")
if os.path.isfile(env_path):
    from dotenv import load_dotenv
    load_dotenv(env_path)

# LOCAL FALLBACK: keys from article_writ (1) (1).py & Articles_Publishing_Winsome (1).py
# Used when file extraction fails. Project is local-only.
_LOCAL_KEYS = {
    "openai": "sk-proj-7stnlpiDcC2ikLMzBBYdSzsPaSlyl65ExXOotRI-R66A4n58nrJKNVBk78mwm_CbznVMUYFpi-T3BlbkFJg8Yeud1x-4APcsVylOS7mVkr57fIU7-bgNMK9ZOsBEiZoSrFUKZiWqCsjdP_SSkd2O90",
    "discord_app_id": "936929561302675458",
    "discord_guild": "1409256842495922158",
    "discord_channel": "1409256843506614346",
    "mj_version": "12378764154715546233",
    "mj_id": "938956540159881230",
    "discord_auth": "ODA4MzU0MzI4MDM2MjQ1NTA1.GKTXhZ.2Tq-c2-C90v58LBfChxTNRB0GpBtwa4kQgcOTM",
}
_LOCAL_WINSOME = {
    "wp_url": "https://www.winsomerecipes.com/xmlrpc.php",
    "wp_domain": "https://www.winsomerecipes.com",
    "wp_user": "John",
    "wp_pass": "eZHg 9mv0 YeS2 ebMw PB0U vqME",
    "spreadsheet_id": "1BswVAS_pUuB1pkF6_iNHuQ5yOZbBRSQInFN_YEFflLE",
    "sheet_name": "wordpress",
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
    parent = os.path.dirname(os.path.dirname(backend_dir))
    if os.path.isdir(parent):
        return parent
    return None


def _extract_from_article_writ(root: str) -> dict[str, str]:
    path = os.path.join(root, "article_writ (1) (1).py")
    out = {}
    if not os.path.isfile(path):
        return out
    try:
        text = open(path, "r", encoding="utf-8", errors="ignore").read()
        for pat in [
            r'OpenAI\s*\(\s*api_key\s*=\s*["\']([^"\']+)["\']',
            r'api_key\s*=\s*["\'](sk-[^"\']+)["\']',
            r'api_key\s*=\s*["\']([a-zA-Z0-9_-]{20,})["\']',
        ]:
            m = re.search(pat, text)
            if m and m.group(1).startswith("sk-"):
                out["openai"] = m.group(1).strip()
                break
        block = re.search(r'MidjourneyApi\s*\((.*?)\)\s*(?:\n\s*for\s+|\n\s*mj\.)', text, re.DOTALL)
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
        print(f"Note: could not read article_writ (1) (1).py: {e}")
    return out


def _extract_from_winsome(root: str) -> dict[str, str]:
    path = os.path.join(root, "Articles_Publishing_Winsome (1).py")
    out = {}
    if not os.path.isfile(path):
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
        accounts = re.search(
            r'WP_ACCOUNTS\s*=\s*\[\s*(.*?)\s*\]',
            text,
            re.DOTALL,
        )
        if accounts:
            first = re.search(r'\(\s*["\']([^"\']*)["\']\s*,\s*"([^"]*)"', accounts.group(1))
            if first:
                out["wp_user"] = first.group(1).strip()
                out["wp_pass"] = first.group(2).strip()
    except Exception as e:
        print(f"Note: could not read Articles_Publishing_Winsome (1).py: {e}")
    return out


def _get_sites_config(workspace: str | None, spreadsheet_id: str) -> list[dict]:
    winsome = (_extract_from_winsome(workspace) if workspace else {}) or _LOCAL_WINSOME
    sites = []
    wp_url = winsome.get("wp_url") or _LOCAL_WINSOME["wp_url"]
    wp_domain = winsome.get("wp_domain") or _LOCAL_WINSOME["wp_domain"]
    if wp_url and wp_domain:
        domain = wp_domain.replace("https://", "").replace("http://", "").split("/")[0]
        sites.append({
            "domain": domain,
            "wp_url": wp_url,
            "wp_user": winsome.get("wp_user") or _LOCAL_WINSOME["wp_user"],
            "wp_pass": winsome.get("wp_pass") or _LOCAL_WINSOME["wp_pass"],
            "sheet_name": winsome.get("sheet_name") or _LOCAL_WINSOME["sheet_name"],
            "spreadsheet_id": winsome.get("spreadsheet_id") or spreadsheet_id,
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

    def _get(key: str, from_file: dict, default: str = "") -> str:
        return from_file.get(key) or _LOCAL_KEYS.get(key, default)

    openai_key = _get("openai", from_article) or _LOCAL_KEYS["openai"]
    discord_auth = _get("discord_auth", from_article) or _LOCAL_KEYS["discord_auth"]
    discord_app_id = _get("discord_app_id", from_article) or _LOCAL_KEYS["discord_app_id"]
    discord_guild = _get("discord_guild", from_article) or _LOCAL_KEYS["discord_guild"]
    discord_channel = _get("discord_channel", from_article) or _LOCAL_KEYS["discord_channel"]
    mj_version = _get("mj_version", from_article) or _LOCAL_KEYS["mj_version"]
    mj_id = _get("mj_id", from_article) or _LOCAL_KEYS["mj_id"]

    spreadsheet_id = from_winsome.get("spreadsheet_id") or _LOCAL_WINSOME["spreadsheet_id"]

    if from_article:
        print("Loaded API keys from article_writ (1) (1).py")
    else:
        print("Using local fallback keys (no .env)")
    if from_winsome:
        print("Loaded site from Articles_Publishing_Winsome (1).py")
    else:
        print("Using local fallback Winsome config")

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
