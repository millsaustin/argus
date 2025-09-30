
# Argus Project Plan

This document outlines the phased development approach for Argus, including milestones, steps, and outcomes. It complements the `argus_phase1_handoff.md` file to ensure continuity.

---

## Phase 0: Environment Setup & Access
**Goal:** Ensure development environment, Proxmox access, and service account integration are functional.

### Steps:
1. Deploy Proxmox lab (pve-lab) with networking and VM support.
2. Create Argus service account (`argus-sa@pve`) and API token with proper permissions.
3. Verify token works with `curl` to Proxmox API (e.g., `/nodes`, `/cluster/status`).
4. Ensure privilege separation disabled and user/token permissions aligned.

**Outcome:** Functional Proxmox API token access validated with `curl`.

---

## Phase 1: Frontend + Backend Scaffold
**Goal:** Stand up initial Argus dashboard UI and backend proxy.

### Steps:
1. Scaffold Next.js frontend (`argus-frontend`) with a basic dashboard page.
2. Scaffold Node.js/Express backend (`argus_scaffold`) with:
   - `server.js` (API proxy)
   - `docker-compose.yml` and `Dockerfile`
   - Example services (`llm.js`)
3. Connect frontend to backend proxy route.
4. Confirm frontend displays API error when backend not running (expected behavior).

**Outcome:** Frontend dashboard running and attempting backend connection.

---

## Phase 2: Backend API Proxy Integration
**Goal:** Connect backend proxy to Proxmox API with service account token.

### Steps:
1. Define `.env` variables for Proxmox API endpoint, token ID, and secret.
2. Update backend `server.js` with proxy route `/api/nodes` -> Proxmox `/nodes`.
3. Implement error handling for 401, 403, and 404 responses.
4. Validate frontend displays live data once backend proxy is running.

**Outcome:** Frontend shows live Proxmox node data from backend.

---

## Phase 3: Core Dashboard Features
**Goal:** Expand dashboard beyond basic node list.

### Steps:
1. Add routes for:
   - `/cluster/status`
   - `/nodes/{node}/qemu`
   - `/nodes/{node}/lxc`
2. Build UI components in frontend to render:
   - Node health/status
   - VM/LXC lists
   - Resource utilization (CPU, RAM, disk)
3. Add loading states and error messages for missing permissions.

**Outcome:** Argus dashboard provides functional view of cluster status and workloads.

---

## Phase 4: Role-Based Views & Operators
**Goal:** Restrict functionality based on role (operator vs admin).

### Steps:
1. Define custom roles in Proxmox (`ArgusOperator`, etc.).
2. Limit API queries available to operator-level tokens.
3. Update frontend to gray-out or hide restricted functions based on token scope.

**Outcome:** Argus dashboard enforces RBAC (Role-Based Access Control).

---

## Phase 5: Advanced Features
**Goal:** Introduce automation and integrations.

### Steps:
1. Add start/stop/reboot controls for VMs (via backend proxy).
2. Integrate LLM-powered assistant for troubleshooting (use `llm.js`).
3. Implement logs/alerts view (e.g., failed tasks, system warnings).
4. Add historical data persistence (PostgreSQL or TimescaleDB).

**Outcome:** Argus evolves from dashboard to operations assistant.

---

## Phase 6: Security & Hardening
**Goal:** Production-ready deployment.

### Steps:
1. Secure API tokens (vault storage).
2. Enforce HTTPS with trusted certificates.
3. Add authentication for Argus frontend (JWT or SSO).
4. Role-segregated deployments (staging vs prod).

**Outcome:** Argus meets security and operational requirements.

---

## Phase 7: Deployment & Scaling
**Goal:** Package Argus for wider deployment.

### Steps:
1. Dockerize frontend + backend services with reverse proxy.
2. Deploy via docker-compose or Kubernetes.
3. Create installation guide and CI/CD pipeline.

**Outcome:** Argus is a deployable and scalable product.

---

# Current Status
- ✅ Phase 0 complete (Proxmox service account + token tested).
- ✅ Phase 1 frontend scaffold deployed (expected 404 error due to no backend).
- 🔜 Next step: Start **Phase 2** — backend proxy setup and integration.

---
