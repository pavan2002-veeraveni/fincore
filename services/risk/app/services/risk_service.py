"""
Risk assessment orchestrator.

Coordinates the rule engine and assembles the final
``RiskAssessmentResponse``.

DISCLAIMER: All assessments are SIMULATED — decision support only,
NOT proof of fraud.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.core.config import settings
from app.domain.rules import evaluate_rules
from app.schemas.risk import (
    RiskAssessmentRequest,
    RiskAssessmentResponse,
)

_DISCLAIMER = (
    "SIMULATED risk assessment — decision support only, not proof of fraud."
)


def assess_risk(request: RiskAssessmentRequest) -> RiskAssessmentResponse:
    """Run the full risk-assessment pipeline for a single transaction.

    1. Evaluate all rules against the request.
    2. Compute the composite score and risk level.
    3. Build human-readable explanations.
    4. Return a ``RiskAssessmentResponse`` with a disclaimer.

    Args:
        request: Validated request payload.

    Returns:
        A complete ``RiskAssessmentResponse``.
    """
    hits, score, level = evaluate_rules(request)

    explanations: list[str] = [h.explanation for h in hits]
    explanations.append(_DISCLAIMER)

    return RiskAssessmentResponse(
        assessment_id=uuid.uuid4(),
        score=score,
        risk_level=level,
        rule_hits=hits,
        explanations=explanations,
        ruleset_version=settings.RULESET_VERSION,
        evaluated_at=datetime.now(timezone.utc),
    )
