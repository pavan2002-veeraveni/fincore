"""
Application settings loaded from environment variables with sensible defaults.

All secrets (tokens, keys) fall back to development-only values so the service
can be started locally without any .env file.
"""

from __future__ import annotations

from decimal import Decimal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the Risk Analytics Service."""

    SERVICE_NAME: str = "fincore-risk-analytics"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Internal service token (reads either RISK_SERVICE_TOKEN or SERVICE_TOKEN)
    SERVICE_TOKEN: str = "CHANGE_ME_internal_service_token"
    RISK_SERVICE_TOKEN: str | None = None

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # Configurable, auditable rule engine thresholds
    RULESET_VERSION: str = "1.1.0"
    VELOCITY_MAX_TX_COUNT: int = 10
    HIGH_AMOUNT_THRESHOLD: Decimal = Decimal("50000")
    NEW_BENEFICIARY_AMOUNT_THRESHOLD: Decimal = Decimal("10000")
    REPEATED_FAILURE_THRESHOLD: int = 3
    YOUNG_ACCOUNT_MAX_DAYS: int = 7
    YOUNG_ACCOUNT_AMOUNT_THRESHOLD: Decimal = Decimal("25000")
    AMOUNT_DEVIATION_MULTIPLIER: Decimal = Decimal("3")
    RAPID_BENEFICIARY_CHANGE_THRESHOLD: int = 3

    @property
    def effective_service_token(self) -> str:
        return self.RISK_SERVICE_TOKEN or self.SERVICE_TOKEN

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
