# Assessment 11 — Secure Financial CI/CD

## 1. Objective & Scope
Automate reproducible dependency installation, typechecking, unit/integration tests against ephemeral PostgreSQL & Redis services, Python `pytest`, container builds, dependency audits, secret scans, container vulnerability scans, and gated staging/production promotion workflows.

## 2. Implemented Components & Code Paths
- Continuous Integration Workflow: `.github/workflows/ci.yml`
  - `lint-typecheck-build` (`pnpm install --frozen-lockfile`, `@fincore/contracts`, API lint/typecheck/build, Web typecheck/Vitest/lint/build)
  - `api-integration-tests` (PostgreSQL 16 + Redis 7 service containers -> `001`–`005` migrations -> `pnpm --filter @fincore/api run test:coverage`)
  - `python-risk-tests` (Python 3.13 -> `pytest -v --cov=app --cov-report=term-missing`)
  - `docker-build-check` (validates Compose YAML & builds `api` `runner`, `web` `runner`, `risk` `runner` Dockerfiles)
- Security Scanning Workflow: `.github/workflows/security.yml` (`pnpm audit --audit-level=high`, Gitleaks secret scan, Trivy image scan `CRITICAL,HIGH`, Python `pip-audit`)
- Deployment Promotion Workflow: `.github/workflows/deploy-staging.yml` (`staging` -> `production-like` environment manual approval gate + SHA-pinned image deployment & rollback guidance)

## 3. Design Decisions
- Separates fast static/build verification from stateful PostgreSQL/Redis integration testing and weekly/PR security scans.
- Uses pinned action versions and strict failure thresholds (`exit-code: '1'` on `CRITICAL,HIGH` Trivy findings; `--audit-level=high` on `pnpm audit`).

## 4. Test Commands & Actual Results
- Workflow YAML files validated cleanly (`PyYAML`, LF line endings) and local equivalents of CI steps passed:
  - `pnpm --filter @fincore/contracts run build` (passed)
  - `pnpm --filter @fincore/api run typecheck && lint && build && test:coverage` (**38/38 passed, 62.29% coverage**)
  - `pnpm --filter @fincore/web run typecheck && lint && test && build` (**6/6 component tests passed**, 18 routes built) + Playwright E2E (**2/2 passed**)
  - `cd services/risk && python -m pytest -v --cov=app` (**23/23 passed**, **99% coverage**)

## 5. Evidence References
- `.github/workflows/ci.yml`, `security.yml`, `deploy-staging.yml`

## 6. Known Limitations & Remaining Work
- Workflows are YAML-validated and complete, but have not yet executed inside a remote GitHub Actions runner; `gitleaks` and `trivy` scans were not run locally (requiring remote CI runner / Docker).
