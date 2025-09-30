# Argus – Phase 1
Minimal, working skeleton for the Argus project: backend (Express), frontend (Next.js), Nginx.
Proxmox API token is used to fetch `/nodes` and show the JSON in the UI.

## Quick Start
1. Copy `.env.example` to `.env` and set your token secret.
2. `docker compose up --build -d`
3. `curl -k http://<vm-ip>/api/health`
4. Visit `http://<vm-ip>` in your browser.

## Secret Handling
- Copy `.env.example` to `.env` and fill in the real Proxmox host and token values.
- Keep `.env` out of version control (already covered by `.gitignore`).
- Tighten permissions locally with `chmod 600 .env` so only your user can read it.
- Rotate the Proxmox API token periodically and replace the secret in `.env`.
- When deploying, inject secrets via Docker/Kubernetes secrets or host-level env vars rather than bundling them into images.

## Where to edit
- Backend routes: `backend/server.js`
- Frontend page: `frontend/app/page.js`
- Reverse proxy: `reverse-proxy/nginx.conf`
- Docs: `docs/`
