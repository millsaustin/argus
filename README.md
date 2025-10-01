# Argus

Argus is a lightweight control plane that surfaces operational data from a Proxmox
cluster. The repository contains an Express backend, a Next.js frontend, and an
Nginx reverse proxy composed together with Docker. A Proxmox API token powers all
cluster calls; the initial implementation fetches `/nodes` and presents the data in
the web UI.

---

## Table of Contents
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Local Development](#local-development)
- [Project Structure](#project-structure)
- [API and Frontend Notes](#api-and-frontend-notes)
- [Testing and Linting](#testing-and-linting)
- [Secret Handling](#secret-handling)
- [Pushing with a GitHub Token](#pushing-with-a-github-token)
- [Troubleshooting](#troubleshooting)

---

## Architecture
- **frontend/** – Next.js application that renders cluster information and UI
  feedback.
- **backend/** – Express server responsible for authenticating against Proxmox
  and proxying data to the frontend. Uses service classes in `backend/services`.
- **reverse-proxy/** – Nginx configuration that routes `/api` traffic to the
  backend and serves the frontend.
- **docker-compose.yml** – Spins up the frontend, backend, and reverse proxy as a
  cohesive stack.
- **docs/** – Working documents covering support, security, checklists, and the
  project plan.
- **api_tests/** – Shell-based probes that exercise the Proxmox API outside the
  Docker stack (useful for smoke testing credentials).

## Prerequisites
- Docker Engine 24+ and Docker Compose plugin
- Node.js 18+ and npm (only required for running apps outside Docker)
- Access to a Proxmox cluster with an API token (role with `Sys.Audit` is
  sufficient for read-only `/nodes` calls)
- TLS trust configuration for your Proxmox host if you do not want to allow
  self-signed certificates

## Configuration
All runtime configuration resides in environment variables. Copy `.env.example`
to `.env` and update the values for your environment.

| Variable | Description |
| --- | --- |
| `NODE_ENV` | Deployment environment (defaults to `development`). |
| `PORT` | Backend port exposed inside the container (default `3001`). |
| `PROXMOX_HOST` | Fully-qualified Proxmox API URL, including scheme and port. |
| `PROXMOX_TOKEN_ID` | Token identifier in `<user>@<realm>!<token-name>` format. |
| `PROXMOX_TOKEN_SECRET` | Secret associated with the token ID. |
| `NEXT_PUBLIC_API_URL` | Base URL the frontend uses when calling the backend. |
| `SESSION_SECRET` | Secret key for signing session cookies. Set per environment. |
| `MONGO_URL` | Connection string for MongoDB-backed session storage. |
| `POSTGRES_URL` | Postgres connection string for VM metrics history. |
| `FRONTEND_ORIGIN` | Allowed frontend origin(s) for CORS (`http://localhost:3000` in dev). |
| `REQUIRE_DUAL_CONTROL` | When `true`, stop/reboot actions require admin approval before execution. |
| `OPENAI_API_KEY` | API token for OpenAI proposals (required for `/api/assistant/propose`). |
| `OPENAI_MODEL` | Optional override for the OpenAI model (default `gpt-4o-mini`). |
| `PROPOSAL_STEP_TIMEOUT_MS` | Milliseconds before a proposal step times out (default `15000`). |

> ⚠️ `.env` is already ignored by git. Never commit real secrets.

## Quick Start (Docker Compose)
This launches the entire stack (frontend, backend, reverse proxy) with one
command.

```bash
cp .env.example .env
# Edit .env with your Proxmox credentials (leave MONGO_URL pointing at the bundled mongo service)
docker compose up --build -d
```

Smoke-test the deployment:

```bash
curl -k http://<argus-host>/api/health
# then browse to http://<argus-host>/login
# sign in with the bootstrap admin password printed in `docker compose logs backend`
# after login you will land on http://<argus-host>/dashboard
```

Use `docker compose logs -f <service>` to tail specific containers, and
`docker compose down` to stop the stack.

## Reverse Proxy & TLS
Terminate TLS at a reverse proxy (nginx/Traefik/Caddy) in every environment and
proxy requests to the backend over the internal network. The repo ships with
`reverse-proxy/nginx.conf` as a starting point; adapt it to listen on `443` and
serve your certificate, for example:

```nginx
server {
    listen 443 ssl;
    server_name argus.internal;

    ssl_certificate     /etc/ssl/private/argus.crt;
    ssl_certificate_key /etc/ssl/private/argus.key;

    location /api/ {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://argus_backend/;
    }

    location / {
        proxy_pass http://argus_frontend/;
    }
}
```

Ensure the proxy adds the standard `X-Forwarded-*` headers so Express can honor
them when `NODE_ENV=production` (see `backend/server.js`).

## Local Development
Run services individually when you want hot reload or tighter iteration loops.

### Backend (Express)
```bash
cd backend
npm install
npm run dev  # uses nodemon for live reload
```

The backend reads the same `.env` file from the repository root. Ensure the file
is available or export the variables in your shell session.

### Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev -- --port 3000
```

Set `NEXT_PUBLIC_API_URL=http://localhost:3001` while running the backend
locally. By default Next.js runs on port 3000; adjust the Nginx config or the
frontend port if you need something different.

### Reverse Proxy (optional during dev)
For pure local development you can skip Nginx and talk directly to the backend.
When you need parity with production routing, run:

```bash
docker compose up reverse-proxy --build
```

## Project Structure
```
api_tests/              # Bash smoke tests against the Proxmox API
backend/                # Express app, services, and JSON schemas
docs/                   # Project documentation and operational notes
frontend/               # Next.js app
reverse-proxy/nginx.conf# Nginx routing rules
scripts/                # Local helper scripts (git push helper, askpass)
```

## API and Frontend Notes
- `backend/services/proxmox.js` is the primary integration point with the
  Proxmox REST API. Add new endpoints there.
- `backend/services/llm.js` is a placeholder for future model integrations.
- `backend/src/proxmoxClient.js` encapsulates axios configuration, including the
  bearer token.
- The frontend consumes `/api/proxmox/nodes` via `frontend/lib/api.js` and
  renders cards/tables under `frontend/components/`.
- Health and readiness logic lives in `backend/scripts/healthcheck.sh`, used by
  Docker for container health monitoring.

## Testing and Linting
- Backend linting: `cd backend && npm run lint`
- API smoke test: `api_tests/test_proxmox.sh` (requires `curl` and valid token)
- Docker healthchecks: `docker inspect --format '{{json .State.Health}}' <container>`

CI is not configured yet; add GitHub Actions or similar to automate linting and
smoke tests when ready.

## Secret Handling
- `.env` is ignored via `.gitignore`; never commit production secrets.
- Limit token privileges to read-only operations (e.g., `Sys.Audit`).
- Rotate the Proxmox token periodically and update `.env`.
- In production, inject configuration through Docker secrets, Kubernetes
  secrets, or your orchestration platform rather than copying `.env` verbatim.
- Restrict filesystem permissions locally: `chmod 600 .env`.

## Pushing with a GitHub Token
The repository includes helper scripts for pushing without exposing tokens on
the command line:

1. Save your PAT in `.github_token` (ignored by git).
2. Run `scripts/push_with_token.sh` to push `main` using an `askpass` helper.
3. Delete or rotate the token when you no longer need it.

See `scripts/git_token_askpass.sh` and `scripts/push_with_token.sh` for details.

## Troubleshooting
- **403 from Proxmox** – Verify the token has access to the target node and that
  the realm/user/token name are correct.
- **SELF_SIGNED_CERT_IN_CHAIN** – Either install the Proxmox CA to your host or
  configure axios to trust the certificate (see `backend/src/proxmoxClient.js`).
- **Docker port conflicts** – Adjust `ports` in `docker-compose.yml` if ports
  80/3000/3001/3443 are in use.
- **Cannot push to GitHub** – Ensure the token scope includes `repo` access or
  use SSH authentication instead of HTTPS.
