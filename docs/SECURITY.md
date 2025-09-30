# Argus Security Posture & Deployment Checklist
**Scope:** Argus is a private, LAN/VPN-only “AI copilot” for Proxmox. It orchestrates read operations (metrics/logs/state) and executes write operations (e.g., VM power, migrate) **only after a two-phase confirmation**. The only default outbound connection is to an LLM provider (e.g., OpenAI) over HTTPS, unless you run a local model.

---

## 1) Executive Summary (for Leadership)
- **Goal:** Give operators a safe, auditable, AI-assisted way to deploy, monitor, and maintain Proxmox environments.
- **Exposure:** Internal-only web app and API (no public ingress). Outbound HTTPS to LLM provider **only** (or none if local LLM).
- **Guardrails:** All change operations use a confirm-before-execute “Action Proposal” with step-by-step detail, optional pre-action snapshot prompt for risky tasks, and full audit trail.
- **Least Privilege:** Dedicated service accounts and scoped API tokens. RBAC with Viewer / Operator / Admin roles.
- **Compliance-friendly:** Centralized logging, immutable audit events, explicit approvals, retention policies, and secrets rotation.

---

## 2) High-Level Architecture & Trust Boundaries
**Components (all on private network/VPN):**
- **Argus Frontend (Next.js)** → Browser UI (LAN/VPN). Talks only to Argus API.
- **Argus API (Express)** → The control plane. Talks to Proxmox API, Prometheus, Elasticsearch, and LLM provider.
- **Adapters** → Proxmox REST client, Prometheus client, Elasticsearch client.
- **Executor** → Runs approved action steps (idempotent, locked, auditable).
- **Observability** → Prometheus/Grafana for Argus metrics; ELK for Argus logs/audit.
- **Secret Store** (Vault or equivalent) → API keys, Proxmox tokens.

**Trust boundaries:**
- **User → Frontend** (authenticated, role-based).
- **Frontend → API** (TLS, session/JWT, CSRF protected).
- **API → Internal systems** (Proxmox/Prometheus/Elasticsearch via service accounts).
- **API → LLM** (outbound HTTPS only, redacted prompts; optional local LLM means no external egress).

---

## 3) Network Topology & Access Model
- **Recommended segmentation (VLANs/SGs):**
  - `mgmt-net` → Proxmox UI/API + hypervisors.
  - `app-net` → Argus API/Frontend containers/VM.
  - `mon-net` → Prometheus/ELK.
  - `user-net` → Admin workstations/VPN clients.
- **Ingress (default):** No internet-facing ports. Frontend/API listen on `app-net` only.
- **Egress:** Allow **HTTPS 443** from Argus API → LLM provider domain(s) (or block if using local LLM). Block other outbound by default.
- **Remote access:** Require VPN (WireGuard/Tailscale) to reach Argus; do **not** port-forward to WAN.

**Sample firewall policy (simplified):**
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

## 4) Identity, AuthN/Z, and RBAC
- **SSO (preferred):** OIDC/SAML via Keycloak/Entra ID/Okta. Enforce **MFA**.
- **Fallback:** Local Argus users with strong passwords + WebAuthn/FIDO2 for admins.
- **Session security:** Short-lived JWT (15–30m) with refresh rotation; revoke on role change.
- **RBAC Roles:**
  - **Viewer:** Read-only dashboards/logs/metrics. No actions.
  - **Operator:** Can request actions; must confirm own actions.
  - **Admin:** Can request and confirm actions; can override safeguards; manage settings.
- **Dual-control (optional, recommended for prod):** Certain destructive plans require **two distinct approvers** (Operator + Admin).

---

## 5) Proxmox Access & Least Privilege
- **Dedicated service account:** Create `argus-sa` in Proxmox.
- **Custom role “ArgusOperator”:** Grant **only** the privileges needed for your initial scope. Assign at **Pool/VM path** rather than Datacenter root where possible.
  - Typical read scope: inventory & status read (Audit-level).
  - Typical write scope: VM power operations, migrations, snapshot create/delete **only if required**.
- **API token:** Create **token for argus-sa** with expiry/rotation; restrict source IP to Argus API host if feasible.
- **Start read-only**, then incrementally add rights as features roll out.

> Proxmox privilege names vary by version; validate in a lab before prod.

---

## 6) Secrets Management & Key Handling
- **Development:** `.env` (strict perms `600`; git-ignored). Use dotenv.
- **Production:** Use a **secret manager** (Vault, Doppler, AWS/GCP Secrets) to inject:
  - `OPENAI_API_KEY` (if used)
  - `PROXMOX_API_TOKEN`
  - `ELASTIC_AUTH` (if any)
  - `PROMETHEUS_TOKEN` (if any)
- **Rotation:** 90-day max (or shorter). Roll keys with zero-downtime deploy.
- **Access control:** Only Argus API service has read rights; no secrets in logs.
- **At rest/in transit:** Encrypt secret stores; enforce TLS everywhere.

---

## 7) Reverse Proxy & TLS Hardening
- Terminate TLS with modern ciphers (TLS 1.2+). Enable HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and a CSP with an allow list.
- If air-gapped, still use TLS with internal CA to prevent session hijack.
- Rate-limit login endpoints; enable access logs to ELK.

---

## 8) Frontend Security
- Enforce CSP, strict CORS (only the Argus domain), and CSRF tokens.
- Use HTTP-only, Secure cookies; rotate session secrets.
- Sanitize any LLM-rendered markdown; never eval output.
- Guard all routes behind auth + RBAC checks.

---

## 9) Backend/API Security
- Validate all inputs (Ajv for proposal schema, celebrate/joi for others).
- Return standardized error envelopes; avoid leaking stack traces.
- Enforce per-route RBAC; log all requests (structured JSON, correlation IDs).
- Implement rate limiting + IP allow list if feasible.
- Ensure executor runs with host/network restrictions (no arbitrary shell).

---

## 10) Execution Guardrails (Confirm-Before-Execute)
- **Two-phase commit:** (1) Proposal with steps → (2) User confirmation → (3) Execute.
- **Detailed plans:** Each step shows tool, endpoint, params, expected result.
- **Risk-based snapshot prompt:** If `risk_level` ∈ {medium, high}, ask “Take snapshot first?” (opt-in).
- **Dry-run mode:** Render proposal & prechecks without executing (attach to change tickets).
- **Timeouts & retries:** Per-step `timeout_seconds`, `max_retries` defaults.
- **Rollbacks:** E.g., forced powercycle if graceful stop fails.
- **Emergency stop:** Operator can cancel an in-flight run; executor stops at step boundary.
- **Dual-control (optional):** Two approvers for destructive ops.

---

## 11) Supply Chain & Build Security
- **Dependencies:** Pin versions; enable Dependabot.
- **Scanning:** SCA (npm audit), **container scans** (Trivy/Grype) in CI.
- **SBOM:** Generate CycloneDX per build; store with artifacts.
- **Signing:** Sign images with Cosign; verify in deploy.
- **Reproducibility:** Build in clean containers; avoid curl-pipe-bash.

---

## 12) Observability, Logging & Audit
- **Metrics (Prometheus):** Uptime, request latency, error rates, executor queue length, action durations, proposal rejection counts.
- **Logs (ELK):** Structured JSON logs from Argus API/executor with correlation IDs.
- **Audit log:** Append-only record of: requester, proposal, approvals, execution results, timestamps.
- **Retention & privacy:** Retain audit logs ≥ 1 year (or per policy). Pseudonymize where possible. Apply ILM policies in Elasticsearch.
- **Alerts:** Auth failures, repeated proposal rejections, executor failures, abnormal action rates.

---

## 13) Backup & Disaster Recovery
- **Config backups:** Argus app config, RBAC, and proposals history.
- **Secret backup:** Encrypted secret store snapshots; documented recovery.
- **Data separation:** Keep audit logs separate from app DB for integrity.
- **RPO/RTO targets:** e.g., RPO 24h, RTO 4h (adjust per environment).
- **Test restores:** Quarterly; include Proxmox token re-bind tests.

---

## 14) OS/Container Hardening
- **Host OS:** Minimal packages, auto security updates, fail2ban/SSH hardening, time sync.
- **Containers:** Non-root user, read-only FS, `no-new-privileges`, drop Linux capabilities, seccomp/AppArmor profiles, resource limits, healthchecks.
- **Node.js:** Disable `x-powered-by`, set `NODE_ENV=production`, safe temp dirs, avoid shelling out.
- **Reverse proxy:** Limit request body size; rate limit; access logs enabled.

---

## 15) Change Management & Environments
- **Environments:** dev → test → prod; separate API keys/tokens per env.
- **Release gates:** PR reviews, CI tests, vulnerability scans must pass.
- **Change tickets:** Attach **dry-run** proposal output for approval.
- **Feature flags:** Gate destructive features until validated in test.

---

## 16) Incident Response (IR) Playbook (Minimum Viable)
1. **Detect:** Alert triggers (auth anomalies, burst of actions).
2. **Contain:** Disable Argus roles, rotate API tokens, block egress to LLM if needed.
3. **Eradicate:** Patch Argus/deps; audit config drift; remove compromised access.
4. **Recover:** Restore known-good config; re-enable in stages.
5. **Post-mortem:** Timeline, root cause, guardrail improvements, token rotations tracked.

---

## 17) Risk Register (Snapshot)
| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Public exposure by misconfig | Low | High | No WAN ingress; IaC checks; network policies |
| LLM prompt leakage | Med | Med | Redaction pipeline; allow-list fields; local LLM option |
| Over-privileged Proxmox token | Med | High | Custom role; Pool/VM-scoped ACL; periodic review |
| Rogue action execution | Low | High | Two-phase confirm; RBAC; dual-control; locks; audit |
| Secrets leak in logs | Low | High | Structured logging; secret redaction; log scrubbing |
| Dependency vulnerability | Med | Med | CI scans; Dependabot; pinned versions; rapid patching |

---

## 18) Concrete Implementation Tasks (Security-first)
- [ ] **Keep Argus private** (LAN/VPN only). No public ingress.
- [ ] **Reverse proxy + TLS** in front of Argus; set headers (§7).
- [ ] **OIDC SSO** (or local + WebAuthn) + short-lived sessions.
- [ ] **Proxmox `argus-sa`** service account; custom least-privilege role scoped to Pool/VM paths.
- [ ] **Secrets manager** in prod; `.env` only in dev; rotate keys regularly.
- [ ] **Outbound allowlist**: api.openai.com:443 (optional); deny all other egress.
- [ ] **Proposal validation** on every AI response; reject on mismatch.
- [ ] **Two-phase confirm** with detailed plan + optional snapshot for risky ops.
- [ ] **Executor locks + idempotency + timeouts**; emergency stop.
- [ ] **Logging & audit** to ELK with correlation IDs; 1-year retention.
- [ ] **CI/CD security**: scans, SBOM, signed images, protected branches.
- [ ] **Backups & IR drills**: quarterly restore tests; token rotation exercises.

---

## 19) Example Config Snippets

**.env (development only; DO NOT commit):**
```
OPENAI_API_KEY=sk-...
PROXMOX_API_URL=https://pve01:8006/api2/json
PROXMOX_API_TOKEN=argus-sa!token-id=xxxxxxxxxx
ELASTIC_URL=http://elasticsearch:9200
PROMETHEUS_URL=http://prometheus:9090
SESSION_SECRET=change_me
```

**Nginx reverse proxy (excerpt):**
```
server {
  listen 443 ssl http2;
  server_name argus.local;
  ssl_certificate     /etc/ssl/argus.crt;
  ssl_certificate_key /etc/ssl/argus.key;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff;
  add_header X-Frame-Options DENY;
  add_header Referrer-Policy no-referrer;
  add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.openai.com; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'";

  location / {
    proxy_pass http://argus-api:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

**Schema validation (Node/Express, Ajv sketch):**
```js
import Ajv from "ajv";
import schema from "./schemas/proposal.schema.json" assert { type: "json" };

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateProposal = ajv.compile(schema);

app.post("/actions/proposals", async (req, res) => {
  const proposal = await llmService.generateProposal(req.body.naturalLanguage, req.body.context);
  if (!validateProposal(proposal)) {
    return res.status(400).json({ error: "Invalid proposal", details: validateProposal.errors });
  }
  // Save proposal to audit log, return to UI
  res.status(201).json({ proposal });
});
```

**Outbound redaction (concept):**
```js
function redact(input) {
  return input
    .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED_KEY]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
}
```

---

## 20) How Everything Works (Narrative)
1. Admin signs into **Argus UI** (SSO) and requests “Restart VM 103.”
2. **Argus API** calls **LLM** (or local model) with redacted, minimal context.
3. LLM returns a **Proposal JSON** (validated). UI shows **step-by-step plan** with optional snapshot.
4. Admin confirms.
5. **Executor** runs each step against **Proxmox API**, with locks/timeouts and rollback paths.
6. Results stream live to UI. **Audit log** captures proposal → approval → execution artifacts.
7. Metrics/logs of Argus itself go to **Prometheus/ELK**, with alerts on anomalies.

---

## Quick Reference (Phase 1 Notes)
- Keep `.env` out of git. Use `.env.example` for templates.
- Use a dedicated service account + token. Minimum permissions:
  - `/` → PVEAuditor (Sys.Audit) or PVEAdmin if you need write ops.
  - `/pool/ARGUS-LAB` → custom ArgusOperator (VM.* as needed).
- Prefer private network; do not expose Proxmox to the internet.
- Terminate TLS at a reverse proxy for the UI in later phases.
