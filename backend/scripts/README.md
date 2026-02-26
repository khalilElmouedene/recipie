# Seed dev data

Creates one project **"Winsome Dev"** with sites and API credentials so you can test generation without re-entering keys.

Keys are loaded **from your existing scripts** when you run seed (no copy-paste):

- **article_writ (1) (1).py** → OpenAI key + Discord/Midjourney (application id, guild, channel, version, mj id, auth token)
- **Articles_Publishing_Winsome (1).py** → WordPress URL, domain, first WP account (user/pass), spreadsheet ID, sheet name

The project root (Va1) is mounted into the backend container as `/workspace`, so the seed script can read those two files. If a key is also in `.env`, `.env` wins.

## 1. Ensure `ENCRYPTION_KEY` is set

In `backend/.env` set `ENCRYPTION_KEY` (e.g. run `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and paste in .env). Other keys can come from the two Python files above.

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
