# Scoring sidecar image (FastAPI + XGBoost/SHAP). Build context is the REPO
# ROOT (the committed model artifact lives in models/registry):
#   docker build -f services/scoring/Dockerfile .
FROM python:3.12-slim

# xgboost needs the OpenMP runtime (libgomp) at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

WORKDIR /app
COPY services/scoring/pyproject.toml services/scoring/uv.lock ./
RUN uv sync --frozen --no-dev

COPY services/scoring/src ./src
COPY models/registry /models/registry

ENV SCORING_ENV=production \
    SCORING_MODEL_DIR=/models/registry \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONPATH=/app/src
EXPOSE 8000
CMD [".venv/bin/uvicorn", "scoring.main:app", "--host", "0.0.0.0", "--port", "8000"]
