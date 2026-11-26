# ──────────────────────────────────────────────────────────
# FinCore Risk Service (FastAPI) — Docker build
# ──────────────────────────────────────────────────────────

FROM python:3.13-slim AS base

# Prevent Python from writing pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system fincore && useradd --system --gid fincore fincore

WORKDIR /app

# Install Python dependencies
COPY services/risk/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY services/risk/app ./app
COPY services/risk/pyproject.toml ./

# Change ownership
RUN chown -R fincore:fincore /app

USER fincore

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/live')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
