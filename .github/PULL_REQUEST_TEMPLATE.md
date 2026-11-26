## Summary
<!-- Describe the change and link the corresponding issue or assessment (01-15). -->

## Scope & Type of Change
- [ ] Feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Hotfix (`hotfix`) — attach regression test & rollback steps
- [ ] Schema migration / Infrastructure / Documentation

## Mandatory Fintech & Security Checklist
- [ ] No real funds, real banking credentials, or regulatory compliance claims introduced.
- [ ] Monetary values strictly use integer minor units (`BIGINT` paise) or Python `Decimal`; zero binary float arithmetic.
- [ ] All multi-row financial writes run inside PostgreSQL transactions with deterministic row locking (`ORDER BY id FOR UPDATE`) and balanced journal postings.
- [ ] State machine transitions validated server-side and recorded in `audit_events`.
- [ ] Retryable write endpoints require/enforce `Idempotency-Key` + request hash conflict (`409`).
- [ ] Sensitive routes enforce RBAC, resource ownership (IDOR prevention), and Step-Up reauthentication.
- [ ] No secrets, tokens, or stack traces exposed in logs, source control, or API error envelopes.

## Verification Run
- [ ] `pnpm typecheck` passed
- [ ] `pnpm --filter @fincore/api run test` passed against PostgreSQL
- [ ] `pytest` passed for `backend/risk`
- [ ] Documentation & Evidence Matrix updated if contracts changed
