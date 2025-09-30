# Argus Tasks (Phase 1)
1. Validate Proxmox API token with curl ✅
2. Stand up backend (Express) + frontend (Next.js) via Docker ✅
3. Implement API client: /nodes, /cluster/status, /nodes/:node/qemu ✅
4. Wire Nginx reverse proxy and /api path ✅
5. Display nodes JSON on the dashboard ✅
6. Add basic guardrails placeholder endpoints ✅
7. Write phase-1 deployment notes ✅

Next: Phase 2 (LLM + ELK)

---

# Proxmox Copilot — Tasks Backlog

## Phase 1: Backend Setup (Node.js / Express)
- [ ] Initialize a Node.js project with Express.  
- [ ] Create base routes:  
  - `/cluster` → fetch cluster/node state (stub for now).  
  - `/metrics` → fetch Prometheus metrics (stub for now).  
  - `/logs` → query Elasticsearch logs (stub for now).  
  - `/actions/proposals` → accept a natural language request, return a JSON proposal (stub).  
  - `/actions/{id}/confirm` → confirm + execute the proposal (stub).  
- [ ] Add WebSocket support for live streaming updates (e.g., during action execution).  
- [ ] Implement logging middleware to record all requests + responses (for audit trail).  

## Phase 2: Frontend Setup (React / Next.js)
- [ ] Initialize a Next.js project with TailwindCSS.  
- [ ] Create pages:  
  - `/dashboard` → main cluster health view.  
  - `/chat` → conversational AI view.  
  - `/logs-metrics` → raw log and metric explorer.  
- [ ] Add layout with sidebar navigation (Dashboard / Chat / Logs & Metrics).  
- [ ] Connect frontend to backend API endpoints (fetch stubs).  

## Phase 3: Dashboard UI
- [ ] Create **ClusterCard** component to show per-node CPU, RAM, Disk usage.  
- [ ] Create **VmListTable** for listing VMs (status, uptime, resources).  
- [ ] Add **AlertBanner** for critical warnings (failed backups, migration issues).  
- [ ] Auto-refresh dashboard data every 10s via API/WebSocket.  

## Phase 4: Chat UI
- [ ] Create **ChatBox** component with input field + Markdown-rendered responses.  
- [ ] Connect chat to backend `/actions/proposals` endpoint.  
- [ ] Support embedded visual panels (charts, tables, logs) inside chat responses.  

## Phase 5: Proposal Review (Guardrails)
- [ ] Create **ProposalReviewModal** component:  
  - Step-by-step plan (each action as a row).  
  - Risk level indicator (low/medium/high).  
  - Safeguard toggle: “Take snapshot before execution?” (only shown for risky actions).  
  - Confirm/Cancel buttons.  
- [ ] Connect modal confirmation → `/actions/{id}/confirm`.  
- [ ] Add live status updates for each step via WebSocket.  

## Phase 6: Logs & Metrics Explorer
- [ ] Build **search bar** for Elasticsearch queries.  
- [ ] Build **query input** for Prometheus metrics.  
- [ ] Render results in tables/charts.  

## Phase 7: AI Integration (Codex / GPT-5)
- [ ] Implement middleware function to forward natural language → AI model → structured proposal JSON.  
- [ ] Fine-tune schema for proposals:  
  - `summary` → plain description.  
  - `plan` → ordered step list (tool, endpoint, params, description).  
  - `safeguards` → snapshot option.  
  - `risk_level` → low/medium/high.  
- [ ] Add audit logging for every AI proposal + user confirmation.  

## Phase 8: Polish & Guardrails
- [ ] Enforce audit logs on all actions (who, what, when, why).  
- [ ] Add RBAC (role-based access control) for action confirmation.  
- [ ] Implement dry-run mode (proposal generated without execution).  
- [ ] Add global error handler for backend API.  
