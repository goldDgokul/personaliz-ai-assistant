# personaliz-broker

FastAPI + WebSocket broker for the single laptop agent architecture.

## Local run

```bash
cd broker
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Required environment variables

- `USER_TOKEN` (browser/client auth via `X-USER-TOKEN`)
- `AGENT_TOKEN` (laptop agent auth via `X-AGENT-TOKEN`)
- `CORS_ALLOWED_ORIGINS` (comma-separated, e.g. `https://personaliz-ui.vercel.app,http://localhost:5173`)

## Render deploy (service: `personaliz-broker`)

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
