# Argus Project – Checkpoint
- Proxmox VE 9.0.x at 10.70.20.150 (`pve-lab.local`).
- Token auth works for node scope (`/nodes`).
- `/cluster/status` requires Sys.Audit at `/` (support ticket in progress).
- Phase 1 goal: Dockerized backend+frontend with live `/nodes` on UI. ✅
- Backend/Frontend running under docker; `/nodes` UI works.
- Helper scripts in `scripts/` let us push with a local PAT without leaking secrets.
- README rebuilt with detailed architecture, setup, and troubleshooting guidance.
- `.env.example` and `.gitignore` updated to reflect current naming/secret handling.
- Repo pushed to GitHub (`main` @ fe51f08).
- Security review flagged priority hardening items: implement real auth/RBAC, re-enable Proxmox TLS validation, and tighten CORS/CSRF posture before adding more operator/admin features.

## Tomorrow
- Start wiring real authentication + RBAC enforcement (Phase 4 security focus).
- Restore TLS verification in Proxmox clients; add explicit escape hatch for lab-only testing.
- Restrict backend CORS to trusted frontend origin and plan CSRF protection.
- Validate Proxmox `/cluster/status` access once support ticket is resolved.
