# RecipeBot - Automation Platform

Web-based platform for automated recipe content generation and WordPress publishing across 4 sites.

## Architecture

- **Frontend**: Next.js 15 + Tailwind CSS (dark mode dashboard)
- **Backend**: FastAPI + Python (REST API + WebSocket)
- **External Services**: OpenAI, Midjourney/Discord, Google Sheets, WordPress

## Quick Start

### Option 1: Docker Compose (recommended)

```bash
# 1. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys

# 2. Make sure serviceaccounts.json and Client_Secret.json are in the root directory

# 3. Start everything
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Default login: `admin` / `admin`

### Option 2: Run without Docker

You need **PostgreSQL** running locally (or a remote URL). Default backend expects: `postgres:postgres@localhost:5432`, database `recipebot`.

**1. Create the database** (if using local PostgreSQL):
```bash
# PostgreSQL CLI or pgAdmin: create database recipebot;
psql -U postgres -c "CREATE DATABASE recipebot;"
```

**2. Backend** (terminal 1):
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
No `.env` required; defaults use `localhost:5432`. To override, set env vars or create `backend/.env`.

**3. Frontend** (terminal 2):
```bash
cd frontend
npm install
npm run dev
```
Frontend uses `http://localhost:8000` by default. Set `NEXT_PUBLIC_API_URL` only if the API is elsewhere.

- App: http://localhost:3000  
- API: http://localhost:8000

## Deployment

For website-scoped Pinterest OAuth and automatic publishing, see
[Pinterest publishing setup](PINTEREST_PUBLISHING.md).

### Backend (Railway / Render)
1. Push the `backend/` directory
2. Set all environment variables from `.env.example`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Frontend (Vercel)
1. Push the `frontend/` directory
2. Set `NEXT_PUBLIC_API_URL` to your backend URL
3. Framework: Next.js (auto-detected)

## Facebook history cleanup

Facebook post history can be cleared with **Delete all history** in the posts toolbar.
It removes local history, delivery records, generation logs and local generated files
only for posts published to every Page. Published Facebook posts and WordPress
articles stay online; drafts, scheduled posts and failed deliveries remain available.
The backend also checks on startup and every 24 hours, automatically deleting history
whose last Page publication was at least 24 hours ago. Keep the backend running for
automatic cleanup; no separate service or database migration is required.

## Facebook project configuration

Use the **Duplicate project** icon beside the delete button on a Facebook project
card, enter a name in the popup, then confirm to create a new workspace with the same website, encrypted API credentials,
connected Pages, prompts and generation settings. The copy starts with an empty
Spy Sheet and no posts, delivery queues or history.

Under **Facebook project → Settings → API Keys**, choose whether to use Midjourney
for article images. **Yes** shows the Midjourney/Discord credential fields.
**No** uses the screenshot extracted from the source video for article images and
bypasses Midjourney even when Discord credentials are saved. Save the setting
before starting or retrying generation. Existing projects keep their current
Midjourney behavior until this setting is changed.

For an existing installation, run `alembic upgrade head` from `backend/` before
restarting the backend. Docker startup applies this migration automatically.

## Cloudflare article images

The **Cloudflare Articles** page (`/cloudflare`) is reserved for `khalil@gmail.com`.
It reuses the existing all-sites article and WordPress workflow with Cloudflare
Workers AI / FLUX images. Configure the Account ID and Workers AI token on the page.
Run `alembic upgrade head` before restarting an existing installation.
See [Cloudflare setup and usage](CLOUDFLARE_ARTICLES.md) for the configuration
steps, daily free allowance, retries and deployment requirements.

## Environment Variables

| Variable | Description |
|---|---|
| `JWT_SECRET_KEY` | Secret for JWT token signing |
| `ADMIN_USERNAME` | Dashboard login username |
| `ADMIN_PASSWORD` | Dashboard login password |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini |
| `DISCORD_AUTHORIZATION` | Discord token for Midjourney |
| `V1_SPREADSHEET_ID` | Google Sheets ID for V1 project |
| `V2_SPREADSHEET_ID` | Google Sheets ID for V2 project |

## Pages

- **Dashboard** `/` - Overview with stats and quick actions
- **Article Generator** `/generator` - Generate recipe content with AI
- **Publisher** `/publisher` - Publish content to WordPress
- **Job History** `/jobs` - View all past and running jobs
- **Job Detail** `/jobs/[id]` - Real-time logs and progress
- **Settings** `/settings` - Manage API keys and configurations
