# Assessment 09 — Containerized Financial Stack

## 1. Objective & Scope
Containerize Web, Express API, Outbox Worker, FastAPI Risk Service, PostgreSQL, Redis, and Nginx Reverse Proxy with multi-stage non-root builds, internal private network segmentation, persistent named volumes, health checks, and dev hot-reload overrides.

## 2. Implemented Components & Code Paths
- Docker Compose Stacks: `docker-compose.yml`, `docker-compose.dev.yml`
- Dockerfiles: `infra/docker/api.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/risk.Dockerfile`
- Nginx Reverse Proxy & Rate Limiting Config: `infra/nginx/nginx.conf`
- Dev & Ops Scripts: `infra/scripts/dev-setup.sh`, `backup.sh`, `restore.sh`
- Health Endpoints: `apps/api/src/modules/health/health.routes.ts` (`/live`, `/ready`), `services/risk/app/main.py` (`/health/live`, `/health/ready`)

## 3. Design Decisions
- `postgres`, `redis`, `worker`, and `risk` reside exclusively on `fincore-internal` (`internal: true`); PostgreSQL/Redis ports are never exposed in base `docker-compose.yml` (`docker-compose.dev.yml` exposes them only for local dev).
- Node and Python images drop privileges (`USER fincore`) and include `tini` + container healthchecks.
- `api.Dockerfile` separates `dev` (tsx/workspace tooling) and `runner` (non-root Node runtime copying `apps/api/node_modules`, built `packages/contracts`, `apps/api/dist`, and `docs/openapi.yaml`); `web.Dockerfile` injects build-time `ARG NEXT_PUBLIC_API_URL` before `next build`, and `nginx.conf` proxies strictly to `web_upstream` and `api_upstream` inside `fincore-public` (keeping `risk` private).
- `docker-compose.yml` passes `.env`, configurable `COOKIE_SECURE` (allowing local HTTP Docker Compose testing), resource memory limits, and `worker` healthcheck.

## 4. Test Commands & Actual Results
- YAML & LF validation (`PyYAML`): `docker-compose.yml` and `docker-compose.dev.yml` parsed cleanly (`YAML_OK`) with Unix LF line endings (`CRLF=False`).
- Native build verification succeeded without errors: `pnpm --filter @fincore/api run build` (`dist/server.js` + `dist/worker.js`) and `pnpm --filter @fincore/web run build` (`18/18` standalone routes).
- Live OS processes booted cleanly and passed `/api/v1/health/ready` (`database: ok`, `riskService: ok`) and `/health/ready` (`ready`).

## 5. Evidence References
- `docker-compose.yml`, `docker-compose.dev.yml`
- `infra/docker/*.Dockerfile`, `infra/nginx/nginx.conf`

## 6. Known Limitations & Remaining Work
- Docker Desktop / Docker Engine and Redis server are not installed on the local Windows build host, so `docker build`, `docker compose up`, and live Redis container checks must run in GitHub Actions CI (`ci.yml` `docker-build-check`) or a Docker-enabled host.
