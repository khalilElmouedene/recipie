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

### Option 2: Run Locally

**Backend:**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your credentials
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Deployment

### Backend (Railway / Render)
1. Push the `backend/` directory
2. Set all environment variables from `.env.example`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Frontend (Vercel)
1. Push the `frontend/` directory
2. Set `NEXT_PUBLIC_API_URL` to your backend URL
3. Framework: Next.js (auto-detected)

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
