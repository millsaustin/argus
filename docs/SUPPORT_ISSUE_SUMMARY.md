# Support Issue Summary (obfuscated)
- Symptom: API token works for `/nodes` but `/cluster/status` returns "Permission check failed (/ , Sys.Audit)".
- Env: Proxmox VE 9.0.x; user `<svc>@pve`, token `<token>`; priv-sep disabled.
- Roles tried at `/`: Administrator, PVEAuditor, custom role with Sys.Audit.
- Ask: recommended binding to enable cluster endpoints for API tokens.
