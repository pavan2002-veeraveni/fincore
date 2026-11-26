"""
Pydantic models for the risk-assessment request / response cycle.

DISCLAIMER: All risk scores produced by these schemas are SIMULATED and
intended for decision-support / educational purposes only. They do NOT
constitute proof of fraud.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    """Discrete risk-level buckets derived from the composite score."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class VelocityEventSample(BaseModel):
    """Minimized synthetic transaction sample for rolling velocity window computation."""

    amount: Decimal = Field(..., gt=0)
    timestamp: datetime
    status: str = Field(default="COMPLETED")


class RiskAssessmentRequest(BaseModel):
    """Payload submitted for a risk evaluation using exact Decimal amounts."""

    customer_id: str = Field(..., min_length=1, description="Pseudonymous customer identifier")
    transaction_amount: Decimal = Field(..., gt=0, description="Amount in major currency units")
    currency: str = Field(default="INR", min_length=3, max_length=3, description="ISO 4217 currency code")
    transaction_type: str = Field(..., min_length=1, description="e.g. TRANSFER, PAYMENT, WITHDRAWAL")

    beneficiary_is_new: bool = Field(default=False, description="First-time beneficiary flag")
    recent_beneficiary_changes: int = Field(default=0, ge=0, description="Recent beneficiary additions/edits")
    recent_transaction_count: int = Field(default=0, ge=0, description="Transactions in recent window")
    recent_total_amount: Decimal = Field(default=Decimal("0"), ge=0, description="Total amount in recent window")
    recent_failure_count: int = Field(default=0, ge=0, description="Failed transactions in recent window")
    customer_account_age_days: int = Field(default=365, ge=0, description="Days since account creation")
    recent_events: Optional[List[VelocityEventSample]] = Field(
        default=None,
        description="Optional event window samples for server-side rolling velocity calculation",
    )
    velocity_window_minutes: int = Field(default=60, ge=1, le=1440)


class RuleHit(BaseModel):
    """A single rule that was triggered during evaluation."""

    rule_id: str = Field(..., description="Stable identifier, e.g. RULE_001")
    rule_name: str = Field(..., description="Human-readable rule name")
    severity: str = Field(..., description="LOW / MEDIUM / HIGH / CRITICAL")
    explanation: str = Field(..., description="Why this rule fired")


class RiskAssessmentResponse(BaseModel):
    """Result of evaluating a transaction against the risk rule engine.

    **SIMULATED** — decision support only, NOT proof of fraud.
    """

    assessment_id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Unique assessment ID")
    score: int = Field(..., ge=0, le=100, description="Composite risk score 0-100")
    risk_level: RiskLevel = Field(..., description="Derived risk level")
    rule_hits: List[RuleHit] = Field(default_factory=list, description="Rules that fired")
    explanations: List[str] = Field(default_factory=list, description="Human-readable explanations")
    ruleset_version: str = Field(..., description="Version of the ruleset used")
    evaluated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp of evaluation (UTC)",
    )


class FeeRequest(BaseModel):
    """Request body for fee calculation."""

    amount: Decimal = Field(..., gt=0)
    rate: Decimal = Field(..., ge=0)
    min_fee: Decimal = Field(default=Decimal("0"), ge=0)
    max_fee: Decimal = Field(default=Decimal("999999999"), ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)


class FeeResponse(BaseModel):
    """Computed fee."""

    fee: Decimal
    currency: str


class InterestRequest(BaseModel):
    """Request body for interest calculation."""

    principal: Decimal = Field(..., gt=0)
    annual_rate: Decimal = Field(..., ge=0)
    days: int = Field(..., gt=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)


class InterestResponse(BaseModel):
    """Computed interest."""

    interest: Decimal
    currency: str


class ProRataRequest(BaseModel):
    """Request body for remainder-safe proportional allocation."""

    total_minor: int = Field(..., ge=0)
    weights: List[int] = Field(..., min_length=1)


class ProRataResponse(BaseModel):
    """Exact minor-unit allocations summing to total_minor."""

    allocations: List[int]
    total_minor: int


class StatementEntryInput(BaseModel):
    amount: Decimal
    currency: str = Field(default="INR", min_length=3, max_length=3)


class StatementSummaryRequest(BaseModel):
    entries: List[StatementEntryInput]


class StatementSummaryResponse(BaseModel):
    total_credits: Decimal
    total_debits: Decimal
    net: Decimal
    entry_count: int
    currency: str


class ReconciliationRecordInput(BaseModel):
    reference: str = Field(..., min_length=1)
    amount: Decimal
    currency: str = Field(default="INR", min_length=3, max_length=3)


class ReconciliationCalcRequest(BaseModel):
    internal_items: List[ReconciliationRecordInput]
    provider_items: List[ReconciliationRecordInput]
    default_currency: str = Field(default="INR", min_length=3, max_length=3)


class ReconciliationCalcItemResult(BaseModel):
    reference: str
    classification: str
    variance: Decimal


class ReconciliationCalcResponse(BaseModel):
    currency: str
    matched_count: int
    exception_count: int
    total_internal: Decimal
    total_provider: Decimal
    net_variance: Decimal
    items: List[ReconciliationCalcItemResult]
