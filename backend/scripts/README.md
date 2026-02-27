# Seed dev data

Creates one project **"Winsome Dev"** with sites and API credentials so you can test generation.

**All keys are read from two files in the project root** (no copy-paste into .env):

| File | Keys extracted |
|------|-----------------|
| **article_writ (1) (1).py** | OpenAI `api_key`, Discord/Midjourney: `application_id`, `guild_id`, `channel_id`, `version`, `cmd_id`, `authorization` |
| **Articles_Publishing_Winsome (1).py** | `WORDPRESS_URL`, `WORDPRESS_DOMAIN`, `SPREADSHEET_ID`, `SHEET_NAME`, first entry in `WP_ACCOUNTS` (user + password) |

Place both files in the project root (same folder as `backend/`). With Docker, the repo is mounted at `/workspace`, so the seed reads them from there.

## 1. Ensure `ENCRYPTION_KEY` is set

Credentials are stored encrypted. Set `ENCRYPTION_KEY` (e.g. in `backend/.env` or in the shell):

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## 2. Run the seed

**With Docker (recommended):**

```bash
docker compose exec backend python -m app.scripts.seed_dev_data
```

**Local (from repo root):**

```bash
cd backend
python -m app.scripts.seed_dev_data
```

## 3. Log in and test

- Email: `dev@local.test` (or `SEED_OWNER_EMAIL` from .env)
- Password: `dev123456` (or `SEED_OWNER_PASSWORD`)

You’ll have one project with 4 sites and credentials filled. Add a recipe and run **Generate** to test.
