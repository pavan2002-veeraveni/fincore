"""
FastAPI router for risk analytics endpoints.

All endpoints require the ``X-Service-Token`` header for authentication.

DISCLAIMER: Scores and assessments are SIMULATED — decision support only,
NOT proof of fraud.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.security import verify_service_token
from app.domain.calculations import (
    allocate_pro_rata,
    calculate_fee,
    calculate_interest,
    calculate_reconciliation_batch,
    calculate_statement_summary,
)
from app.domain.rules import ALL_RULES
from app.schemas.risk import (
    FeeRequest,
    FeeResponse,
    InterestRequest,
    InterestResponse,
    ProRataRequest,
    ProRataResponse,
    ReconciliationCalcRequest,
    ReconciliationCalcResponse,
    RiskAssessmentRequest,
    RiskAssessmentResponse,
    StatementSummaryRequest,
    StatementSummaryResponse,
)
from app.services.risk_service import assess_risk

router = APIRouter(
    prefix="/api/v1",
    tags=["risk"],
    dependencies=[Depends(verify_service_token)],
)


# ---------------------------------------------------------------------------
# Risk assessment
# ---------------------------------------------------------------------------

@router.post("/assess", response_model=RiskAssessmentResponse)
async def assess_transaction(
    request: RiskAssessmentRequest,
) -> RiskAssessmentResponse:
    """Evaluate a transaction and return a SIMULATED risk assessment.

    **Decision support only — NOT proof of fraud.**
    """
    return assess_risk(request)


# ---------------------------------------------------------------------------
# Rule catalogue
# ---------------------------------------------------------------------------

@router.get("/rules")
async def list_rules() -> list[dict]:
    """Return the list of active rules (operational metadata).

    The ``func`` callable is stripped from the response.
    """
    return [
        {
            "rule_id": r["rule_id"],
            "rule_name": r["rule_name"],
            "description": r["description"],
            "severity": r["severity"],
        }
        for r in ALL_RULES
    ]


# ---------------------------------------------------------------------------
# Financial calculation endpoints
# ---------------------------------------------------------------------------

@router.post("/calculate/fee", response_model=FeeResponse)
async def compute_fee(body: FeeRequest) -> FeeResponse:
    """Calculate a clamped fee for a given amount and rate."""
    fee = calculate_fee(
        amount=body.amount,
        rate=body.rate,
        min_fee=body.min_fee,
        max_fee=body.max_fee,
        currency=body.currency,
    )
    return FeeResponse(fee=fee, currency=body.currency)


@router.post("/calculate/interest", response_model=InterestResponse)
async def compute_interest(body: InterestRequest) -> InterestResponse:
    """Calculate simple interest over a number of days."""
    interest = calculate_interest(
        principal=body.principal,
        annual_rate=body.annual_rate,
        days=body.days,
        currency=body.currency,
    )
    return InterestResponse(interest=interest, currency=body.currency)


@router.post("/calculate/pro-rata", response_model=ProRataResponse)
async def compute_pro_rata(body: ProRataRequest) -> ProRataResponse:
    """Allocate integer minor units proportionally with zero penny loss."""
    allocations = allocate_pro_rata(total_minor=body.total_minor, weights=body.weights)
    return ProRataResponse(allocations=allocations, total_minor=body.total_minor)


@router.post("/calculate/statement-summary", response_model=StatementSummaryResponse)
async def compute_statement_summary(body: StatementSummaryRequest) -> StatementSummaryResponse:
    """Summarize statement credit/debit totals using Decimal exclusively."""
    summary = calculate_statement_summary([e.model_dump() for e in body.entries])
    return StatementSummaryResponse(**summary)


@router.post("/calculate/reconciliation", response_model=ReconciliationCalcResponse)
async def compute_reconciliation(body: ReconciliationCalcRequest) -> ReconciliationCalcResponse:
    """Classify settlement matches/exceptions and exact Decimal variances."""
    result = calculate_reconciliation_batch(
        internal_items=[i.model_dump() for i in body.internal_items],
        provider_items=[p.model_dump() for p in body.provider_items],
        default_currency=body.default_currency,
    )
    return ReconciliationCalcResponse(**result)
