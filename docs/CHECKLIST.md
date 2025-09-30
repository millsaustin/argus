# Argus Phase 1 – Build Checklist
- [x] Proxmox host `pve-lab.local` up at 10.70.20.150
- [x] API token validated with curl (nodes endpoint works)
- [x] Backend container builds and starts
- [x] Frontend container builds and starts
- [ ] Nginx reverse proxy online
- [ ] Frontend shows data from /api/proxmox/nodes
- [ ] Cluster status reachable (once Sys.Audit at `/` is honored)

---

# Argus Developer Security Checklist

This is the actionable to-do list for engineers implementing Argus. It condenses the full SECURITY.md posture into practical coding/deployment steps.

## Core Principles
- Argus runs **LAN/VPN only**. No WAN ingress. Only outbound HTTPS to LLM provider (or none if local).
- All **AI proposals must validate** against `proposal.schema.json` before execution.
- **Two-phase confirm**: proposal → user confirm → execution.
- **Least privilege** everywhere: Proxmox API tokens, roles, secrets.

## Developer To-Dos

### Security Review Notes (Sep 30)
- **Phase 4 blocker:** implement real user auth + RBAC before adding more operator/admin UI; current env-based role is temporary.
- **TLS verification:** restore certificate checking in all Proxmox clients; only allow insecure mode for explicit lab overrides.
- **Origin hygiene:** tighten CORS to the trusted frontend and add CSRF protection once auth is wired.
- Revisit remaining SECURITY.md items (dual control, proposal validation, secret manager, CI scans) after the auth/TLS/CORS fixes land.

### Backend (Express API)
- [ ] Implement routes: `/cluster`, `/metrics`, `/logs`, `/actions/proposals`, `/actions/{id}/confirm`.
- [ ] Integrate **Ajv** to validate proposals against `proposal.schema.json`.
- [ ] Add **idempotency keys** to actions; enforce per-VM/node **locks**.
- [ ] Enforce **timeouts + retries** for executor steps.
- [ ] Add **emergency stop** endpoint (stop at step boundary).
- [ ] Log all requests/responses in structured JSON with correlation IDs.

### LLM Service
- [ ] Create `services/llm.js` with pluggable backends:
  - OpenAI API (use `OPENAI_API_KEY` from `.env`/Vault).
  - Optional local Ollama model.
- [ ] Implement **redaction pipeline** before sending data to LLM.
- [ ] Ensure only **minimal context** (summaries, metrics, log snippets) leaves the system.
- [ ] Require all responses to be **valid proposal JSON**.

### Proxmox Integration
- [ ] Create **Proxmox service account** (`argus-sa`).
- [ ] Define **custom ArgusOperator role** with minimal privileges (power, migrate, snapshot).
- [ ] Scope privileges to **Pool/VM paths**, not Datacenter-wide.
- [ ] Store **Proxmox API token** in Vault or `.env` (dev only).

### Frontend (Next.js)
- [ ] Create `ProposalReviewModal` to show step-by-step plan with confirm/cancel.
- [ ] Add optional **snapshot prompt** if `risk_level` = medium/high.
- [ ] Integrate WebSocket for live executor output.
- [ ] Role-based UI (Viewer, Operator, Admin).

### Security Controls
- [ ] Require **auth** (OIDC SSO preferred; fallback local + WebAuthn).
- [ ] Use **short-lived JWTs** (15–30m) with refresh.
- [ ] Enforce RBAC (Viewer = read-only, Operator = request, Admin = approve/manage).
- [ ] Require **dual control** (two approvers) for destructive ops.
- [ ] Add **CSRF tokens** and restrict CORS to frontend origin.

### Secrets & Config
- [ ] Load secrets from Vault/secret manager in prod; `.env` only in dev.
- [ ] Rotate keys every 90 days.
- [ ] Never log secrets. Redact before logging.

### Infrastructure
- [ ] Place Argus on `app-net` VLAN; allow outbound only to `api.openai.com:443`.
- [ ] Block all other egress.
- [ ] Use reverse proxy (Nginx/Traefik) with TLS + security headers.
- [ ] Add Prometheus exporter for Argus metrics.

### CI/CD & Supply Chain
- [ ] Pin npm deps; enable Dependabot.
- [ ] Run SCA scans (`npm audit`) + container scans (Trivy/Grype).
- [ ] Generate SBOM (CycloneDX).
- [ ] Sign container images with Cosign.

### Audit & Logging
- [ ] Immutable audit log: proposals, approvals, execution, results.
- [ ] Retain ≥ 1 year; forward to ELK.
- [ ] Alert on abnormal usage patterns (auth failures, burst of actions).

### Backup & IR
- [ ] Backup Argus config + audit logs separately.
- [ ] Quarterly restore tests (incl. Proxmox token re-bind).
- [ ] Document incident response (disable roles, rotate tokens, restore config).

## Quickstart Dev Environment
1. Clone repo and add `SECURITY.md` + this `checklist.md`.
2. Place `proposal.schema.json` in `/schemas`.
3. Add `.env` with:
   ```
   OPENAI_API_KEY=sk-...
   PROXMOX_API_URL=https://pve01:8006/api2/json
   PROXMOX_API_TOKEN=argus-sa!token-id=...
   SESSION_SECRET=change_me
   ```
4. Run `docker-compose up` for API + frontend + reverse proxy (scaffold later).
