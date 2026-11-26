"""
FinCore Risk Analytics Service — FastAPI application.

DISCLAIMER: This service provides SIMULATED risk scoring for educational
and decision-support purposes only. It is NOT proof of fraud and must
never be used as the sole basis for blocking, rejecting, or flagging
real financial transactions.
"""

import json
import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.risk_router import router as risk_router
from app.core.config import settings


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level": record.levelname.lower(),
            "service": settings.SERVICE_NAME,
            "message": record.getMessage(),
        })


logger = logging.getLogger("fincore.risk")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))

app = FastAPI(
    title="FinCore Risk Analytics Service",
    description=(
        "SIMULATED risk scoring — decision support only, NOT proof of fraud. "
        "This service evaluates transactions against a configurable rule engine "
        "and returns risk assessments for educational / demonstration purposes."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "requestId=%s method=%s path=%s status=%s durationMs=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


app.include_router(risk_router)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    """Convert domain ValueError validation failures into safe 400 responses."""
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health/live", tags=["health"])
async def liveness() -> dict:
    """Liveness probe — the process is running."""
    return {"status": "alive", "service": settings.SERVICE_NAME}


@app.get("/health/ready", tags=["health"])
async def readiness() -> dict:
    """Readiness probe — the service can accept traffic."""
    return {
        "status": "ready",
        "service": settings.SERVICE_NAME,
        "ruleset_version": settings.RULESET_VERSION,
    }
