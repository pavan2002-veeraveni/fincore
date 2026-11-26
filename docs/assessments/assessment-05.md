# Assessment 05 — Python Financial Calculations

## 1. Objective & Scope
Build auditable financial calculations in Python using `Decimal` arithmetic exclusively (zero binary floating point), supporting currency-specific rounding policies, clamped fees, interest, pro-rata remainder allocation, statement summaries, and rolling velocity metrics.

## 2. Implemented Components & Code Paths
- Calculations Module: `services/risk/app/domain/calculations.py` (`minor_to_decimal`, `decimal_to_minor`, `round_money`, `calculate_fee`, `calculate_interest`, `allocate_pro_rata`, `calculate_statement_summary`, `calculate_reconciliation_batch`, `compute_velocity_window`)
- API Endpoints: `POST /api/v1/calculate/fee`, `/calculate/interest`, `/calculate/pro-rata`, `/calculate/statement-summary`, `/calculate/reconciliation` in `services/risk/app/api/risk_router.py`
- Boundary Tests & Benchmark: `services/risk/app/tests/test_calculations.py`, `test_risk_rules.py`

## 3. Design Decisions
- `INR` uses `ROUND_HALF_EVEN` (banker's rounding) to avoid systematic rounding drift; non-INR currencies default to `ROUND_HALF_UP`.
- `allocate_pro_rata` implements Hamilton/Largest-Remainder integer allocation so `sum(allocated) === total_minor` with zero penny loss.
- Express API uses `minorToDecimalString` (`packages/contracts/src/money.ts`) using `BigInt` integer division/modulo rather than `float` before calling FastAPI.

## 4. Test Commands & Actual Results
- `cd services/risk && python -m pytest -v --cov=app --cov-report=term-missing`:
  - **23/23 Python tests passed**.
  - Overall Python coverage: **99%**.
  - Benchmark (`test_benchmark_10000_decimal_fee_and_rule_evaluations`: 5,000 fee calculations + 5,000 rule evaluations = 10,000 evaluations) passed well under threshold.

## 5. Evidence References
- `services/risk/app/domain/calculations.py`
- `services/risk/app/tests/test_calculations.py`

## 6. Known Limitations & Remaining Work
- Single base currency (`INR`) conversion FX tables are intentionally omitted (`ASSUMPTIONS.md` A2); all multi-currency helpers operate deterministically in explicit target currency decimal places.
