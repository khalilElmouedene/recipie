FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "python -c 'import asyncio; from app.database import init_db; from app import db_models; asyncio.run(init_db())' && alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
