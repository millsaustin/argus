# Argus Security-First Master Checklist

This document merges the original security posture narrative with the actionable checklist. Treat the top sections as context/reference material, and the later sections as day-to-day execution items.

---

## Executive Summary
- **Goal:** Deliver a safe, auditable, AI-assisted control plane for Proxmox operators.
- **Exposure:** Internal-only (LAN/VPN). No WAN ingress. Outbound HTTPS allowed only to the configured LLM provider (or none if running a local model).
- **Guardrails:** Two-phase confirmation before executing actions; optional snapshot prompts for risky operations; immutable audit trail.
- **Least Privilege:** Dedicated service accounts and scoped tokens. Viewer / Operator / Admin RBAC with dual-control for destructive actions.
- **Compliance Hooks:** Structured logging, approvals, retention policies, and periodic secret rotation.

---

## Architecture & Trust Boundaries
### Components (private network/VPN)
- **Frontend (Next.js)** – Browser UI; talks only to Argus API.
- **API (Express)** – Control plane; integrates with Proxmox, Prometheus, Elasticsearch, and optional LLM.
- **Adapters** – SDK clients for Proxmox/Prometheus/Elasticsearch.
- **Executor** – Runs approved action steps with idempotency/locking.
- **Observability stack** – Prometheus/Grafana + ELK for metrics/logs/audit.
- **Secret store** – Vault/Doppler/etc. for API keys and tokens.

### Trust Boundaries
- **User → Frontend** (authenticated, role-based).
- **Frontend → API** (TLS, session/JWT, CSRF protections).
- **API → Internal systems** (service accounts, scoped permissions).
- **API → LLM** (HTTPS egress only; redacted prompts; optional local model eliminates egress).

### Threat Modeling
- Maintain a DFD highlighting entry points, authN/Z, storage, and egress paths.
- Run STRIDE on each entry point; capture abuse cases (token theft, role escalation, prompt injection, unsafe action execution).
- Document security invariants:
  - All state-changing operations require confirm-before-execute.
  - Tokens are least-privileged and scoped to Pool/VM paths where possible.
  - Only allow-listed outbound domains (LLM or none).
  - No secrets in logs; enforce redaction middleware.

---

## Network Topology & Access Model
- Suggested segmentation: `mgmt-net` (Proxmox), `app-net` (Argus API/frontend), `mon-net` (Prom/ELK), `user-net` (VPN/workstations).
- **Ingress:** Deny WAN access. Users reach Argus via VPN; reverse proxy terminates TLS.
- **Egress:** Allow only `api.openai.com:443` (if using hosted LLM); otherwise deny all.
- **Remote access:** VPN/Tailscale/WireGuard mandatory; never port-forward to the internet.
- **Sample firewall policy:**
  ```
  # Ingress
  WAN → Argus API/Frontend:         DENY
  user-net → Argus API/Frontend:    ALLOW 443/TCP
  app-net → Proxmox API:            ALLOW 8006/TCP (from Argus API only)
  app-net → Prometheus:             ALLOW 9090/TCP (from Argus API only)
  app-net → Elasticsearch:          ALLOW 9200/TCP (from Argus API only)

  # Egress
  Argus API → api.openai.com:443:   ALLOW (or DENY if local LLM)
  Argus API → ANY other:            DENY
  ```

---

## Identity, AuthN/Z, Sessions
- Prefer **OIDC/SAML SSO** (Keycloak/Entra/Okta) with MFA enforced for operators/admins.
- Dev bootstrap can use local session auth but must be replaced with SSO in test/prod.
- Sessions: short-lived (15–30m) with rotation on privilege changes; cookies `httpOnly`, `Secure`, `SameSite=Strict` in production.
- Roles:
  - **Viewer:** dashboards/logs read-only.
  - **Operator:** request/execute own actions (with confirmations).
  - **Admin:** approve/override actions; manage settings.
- Apply **dual control** for destructive tasks (operator requests, admin approves).
- Maintain break-glass admin credentials offline; audit their use.

---

## Proxmox Access & Least Privilege
- Create service account `argus-sa` with a custom `ArgusOperator` role scoped to pools/VMs (avoid Datacenter root).
- Start read-only; add power/migrate/snapshot permissions incrementally.
- Use API tokens with expiry/rotation; restrict source IP to Argus host if supported.
- Validate Proxmox privilege sets in a lab before deploying to production.

---

## Secrets & Key Management
- Dev: `.env` (chmod 600, git-ignored). Use `.env.example` as template only.
- Prod: Secrets manager injects `PROXMOX_API_TOKEN`, `OPENAI_API_KEY`, `SESSION_SECRET`, any DB creds, etc.
- Rotate secrets ≤ 90 days; automate rotation via CI/CD pipelines.
- Limit secret access to Argus services; never write secrets to logs or analytics.
- Encrypt secrets at rest and in transit; redact tokens/emails/keys before logging.

---

## Reverse Proxy & TLS
- Terminate TLS at nginx/Traefik/Caddy in every environment; Express trusts the proxy when `NODE_ENV=production` (see `backend/server.js`).
- Require TLS 1.2+ with modern ciphers; enable HSTS, `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, and a strict CSP.
- Sample nginx TLS block:
  ```nginx
  server {
      listen 443 ssl;
      server_name argus.internal;

      ssl_certificate     /etc/ssl/private/argus.crt;
      ssl_certificate_key /etc/ssl/private/argus.key;

      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
      add_header X-Content-Type-Options nosniff;
      add_header X-Frame-Options DENY;
      add_header Referrer-Policy no-referrer;

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

---

## API & Backend Controls
- Validate all inputs (celebrate/joi/zod). Enforce enums, bounds, and reject unknown fields.
- Validate LLM proposals with Ajv against `schemas/proposal.schema.json`.
- Executor: idempotency keys, per-VM/node locks, bounded retries, timeouts, emergency-stop endpoint.
- Standardize error envelopes; avoid leaking stack traces or secrets.
- Rate limit authentication and action endpoints; consider IP allow-listing for sensitive routes.
- Enforce CSRF tokens on POST/PUT/DELETE; restrict CORS to the frontend origin.
- Feature-flag destructive capabilities; default deny until validated.

---

## Frontend Controls
- Gate every page on authentication; redirect unauthenticated users to `/login`.
- Make UI role-aware (hide/disable restricted controls; show explanatory tooltips).
- Enforce a strict CSP (`default-src 'self'; connect-src 'self' https://api.openai.com; img-src 'self' data:` etc.).
- Never eval or render untrusted HTML; sanitize LLM output rigorously.
- Include CSRF tokens/headers on all mutations; fail closed when missing.

---

## LLM & Proposal Safety
- Send minimal context to the LLM; redact tokens, emails, and other identifiers.
- Reject any response that fails schema validation or lacks required guardrail steps.
- Log proposals and approvals with correlation IDs; retain artifacts for audit.
- Offer local/offline model option to eliminate external egress when required.

---

## Data, Privacy & Retention
- Minimize data shared with third parties; summarize metrics/logs before sending to LLMs.
- Maintain append-only audit logs (who/what/when/why/result) with ≥ 1 year retention.
- Inventory any PII; document purpose, retention, and purge processes.

---

## Observability & Alerting
- Emit structured JSON logs with correlation IDs to ELK.
- Capture metrics: API latency, error rates, executor queue length, action duration, proposal rejection count.
- Alerts: auth failure spikes, proposal invalidations, executor errors, role changes, node outages, audit tamper indicators.

---

## Supply Chain & Build Integrity
- Pin npm dependencies; enable Dependabot.
- Run SCA scans (`npm audit` minimum) plus container scans (Trivy/Grype/Snyk).
- Generate SBOM (CycloneDX) per build; archive with artifacts.
- Sign container images with Cosign and verify during deployment.
- Build in clean runners; avoid `curl | sh` installers.

---

## Containers & Runtime Hardening
- Run containers as non-root; read-only filesystems where possible; drop Linux capabilities; set `no-new-privileges`.
- Apply seccomp/AppArmor profiles and resource limits; keep healthchecks defined.
- Set `NODE_ENV=production`, disable `x-powered-by`, use safe tmp directories.
- Reverse proxy: limit request body size, enable rate limits, keep access logs.

---

## Proxmox-Specific Minimums
- Service account + custom role scoped to pools/VMs.
- Begin read-only; enable write privileges only when required features demand them.
- Restrict API token source IP; rotate quarterly.
- Enforce TLS verification for Proxmox API calls; production ignores `PROXMOX_INSECURE_TLS` and requires proper CA import.
- For high-risk ops, prompt for snapshot/rollback plan and capture dry-run outputs.

---

## CI/CD & Change Management
- Protect main branches; require PR reviews.
- CI gates: tests, linters, SCA, container scans, SBOM generation, policy checks.
- Inject secrets via CI; never bake them into images or repos.
- Change tickets should include dry-run proposal output and rollback steps.
- Use feature flags to roll out destructive capabilities safely.

---

## Backup, DR & Incident Response
- Back up Argus config, RBAC metadata, and audit logs separately; test restores quarterly.
- Incident Response playbook: detect → contain (disable roles, rotate tokens, block LLM egress) → eradicate → recover → post-mortem with timeline and remediation.
- Run tabletop exercises at least twice per year.

---

## Testing & Assurance
- Unit tests for validators, RBAC guards, proposal parsing.
- Integration tests for Proxmox proxy (recorded fixtures/sandboxes).
- Security tests: CSRF suite, CORS enforcement, authZ matrix (viewer/operator/admin).
- Perform a pen test pre-production and remediate high/critical findings.

---

## Go-Live (Production) Checklist
- [ ] OIDC SSO enabled; MFA enforced; break-glass documented and sealed.
- [ ] TLS enabled with valid chain; HSTS and security headers active.
- [ ] CORS locked to frontend origin; CSRF enforced on mutations.
- [ ] Proxmox token scoped to pool/VM; least-privilege test validated.
- [ ] Outbound allow-list enforced; other egress blocked.
- [ ] Secrets stored in vault; rotation policy active.
- [ ] Logs/metrics/audit flowing to ELK/Prometheus with active alerts.
- [ ] SBOM generated; images signed; security scans clean or risk-accepted.
- [ ] Backups verified; IR playbook accessible.
- [ ] Dry-run proposals attached to change record for release.

---

## Day-2 Operations
- Rotate tokens/keys on schedule; verify zero-downtime rotation process.
- Review audit logs weekly; triage anomaly alerts promptly.
- Maintain patch cadence for Node, base images, dependencies; have emergency CVE pipeline.
- Perform RBAC reviews monthly; remove stale users/tokens.
- Conduct quarterly restore drills and snapshot/migrate rollback exercises.

---

## Risk Register (Snapshot)
| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Public exposure by misconfiguration | Low | High | No WAN ingress; IaC checks; network policies |
| LLM prompt leakage | Med | Med | Redaction pipeline; allow-list fields; local LLM option |
| Over-privileged Proxmox token | Med | High | Custom role; pool-scoped ACL; periodic review |
| Rogue action execution | Low | High | Two-phase confirm; RBAC; dual-control; locks; audit |
| Secrets leak in logs | Low | High | Structured logging; secret redaction; log scrubbing |
| Dependency vulnerability | Med | Med | CI scans; Dependabot; pinned versions; rapid patching |

---

## Concrete Implementation Tasks (Security-First)
- [ ] Keep Argus private (LAN/VPN only). No WAN ingress.
- [ ] Reverse proxy + TLS in front of Argus; set required headers.
- [ ] OIDC SSO or local + WebAuthn fallback with short-lived sessions.
- [ ] Proxmox `argus-sa` service account with least privilege.
- [ ] Secrets manager in production; rotate keys regularly.
- [ ] Outbound allow-list to `api.openai.com:443` (optional); deny others.
- [ ] Enforce proposal validation on every LLM response; reject invalid payloads.
- [ ] Maintain two-phase confirms with snapshot prompts for risky ops.
- [ ] Implement executor locks, idempotency keys, timeouts, emergency stop.
- [ ] Stream structured logs to ELK with correlation IDs; retain ≥ 1 year.
- [ ] Enforce CI/CD security gates (scans, SBOM, signed images, protected branches).
- [ ] Schedule backups and IR drills (quarterly restores; token rotation exercises).

---

## Reference Configs & Snippets
**Development `.env` (do not commit):**
```
OPENAI_API_KEY=sk-...
PROXMOX_API_URL=https://pve01:8006/api2/json
PROXMOX_API_TOKEN=argus-sa!token-id=...
ELASTIC_URL=http://elasticsearch:9200
PROMETHEUS_URL=http://prometheus:9090
SESSION_SECRET=change_me
```

**Ajv proposal validation sketch:**
```js
import Ajv from 'ajv';
import schema from './schemas/proposal.schema.json' assert { type: 'json' };

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateProposal = ajv.compile(schema);

app.post('/actions/proposals', async (req, res) => {
  const proposal = await llmService.generateProposal(req.body.input, req.body.context);
  if (!validateProposal(proposal)) {
    return res.status(400).json({
      error: 'Invalid proposal',
      details: validateProposal.errors
    });
  }

  res.status(201).json({ proposal });
});
```

**Outbound redaction helper:**
```js
function redact(input) {
  return input
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
}
```

---

## Operational Narrative (How It Works)
1. Operator signs in (SSO) and submits an action (“Restart VM 103”).
2. Argus API calls the LLM/local model with redacted, minimal context.
3. LLM returns Proposal JSON; UI validates against schema and displays step-by-step plan (with optional snapshot prompt).
4. Operator confirms; admin approves if dual control required.
5. Executor runs each step via Proxmox API with locks, timeouts, and rollback paths.
6. Execution updates stream to the UI; audit log captures proposal → approval → execution artifacts.
7. Metrics/logs route to Prometheus/ELK; alerts fire on anomalies.

---

## Quick Reference (Phase 1 Notes)
- Keep `.env` out of git; rely on `.env.example` for templates.
- Use dedicated service account/token with minimum permissions (`PVEAuditor` or custom args).
- Keep Argus on private networks; never expose Proxmox or Argus directly to the internet.
- Terminate TLS at the reverse proxy and forward standard `X-Forwarded-*` headers.

---

## “Security-First” Codex Prompt Footer
```
Security-first requirements (MANDATORY):

- Enforce RBAC: Viewer (read-only), Operator (request), Admin (approve/override). Gate new endpoints with requireRole().
- Validate input: use celebrate/joi (or zod) with strict schemas; reject unknown fields; bound numeric ranges.
- CSRF & CORS: all POST/PUT/DELETE must require CSRF token; CORS restricted to FRONTEND_ORIGIN; include preflight handling.
- Secrets: read from env/secret manager; never log; redact tokens/emails/keys in responses and logs.
- Logging: structured JSON with correlation IDs; no PII/secrets; map errors to standard envelopes without stack traces.
- LLM interactions: output must validate against proposal.schema.json (Ajv); reject on mismatch; redact prompts; never include raw secrets.
- Executor safety: idempotency keys, per-VM/node locks, timeouts, bounded retries, emergency stop; dual-control on destructive ops.
- TLS: assume TLS termination at reverse proxy; cookies httpOnly+Secure (prod), SameSite=Strict; disable x-powered-by.
- Feature flags: wrap destructive features behind flags; default off in dev/test until validated.
- Tests: add unit/integration tests for validators, RBAC, CSRF/CORS checks; include a minimal e2e path for the new feature.
- Documentation: update SECURITY_CHECKLIST with any new endpoints, roles, and required secrets.
```
