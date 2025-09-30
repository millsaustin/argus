# Argus Project – Checkpoint
- Proxmox VE 9.0.x at 10.70.20.150 (`pve-lab.local`).
- Token auth works for node scope (`/nodes`).
- `/cluster/status` requires Sys.Audit at `/` (support ticket in progress).
- Phase 1 goal: Dockerized backend+frontend with live `/nodes` on UI. ✅
- Backend/Frontend running under docker; `/nodes` UI works.
- Helper scripts in `scripts/` let us push with a local PAT without leaking secrets.
- README rebuilt with detailed architecture, setup, and troubleshooting guidance.
- `.env.example` and `.gitignore` updated to reflect current naming/secret handling.
- Repo pushed to GitHub (`main` @ 504fc07).

## Tomorrow
- Validate Proxmox `/cluster/status` access once support ticket is resolved.
- Stand up CI (lint + smoke tests) or document plan if blocked.
