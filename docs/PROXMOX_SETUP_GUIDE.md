# Proxmox Setup Guide (Argus Lab) — pve-lab.local / 10.70.20.150

## Network & Host
- Hostname: pve-lab.local
- Management IP: 10.70.20.150/24
- vmbr0 bridged to your NIC (e.g., enp0s31f6), gateway per your LAN.

## Resource Pool
- Create pool: ARGUS-LAB

## Service Account + Token
- Create user: `argus-sa` in realm **pve** (Proxmox VE auth).
- Create API token: `argus-token` (Privilege Separation **disabled**).
- Assign roles:
  - `/` → `PVEAuditor` (or `PVEAdmin` if needed).
  - `/pool/ARGUS-LAB` → `ArgusOperator` (VM.* as needed).

## Validate with curl (from Argus VM)
```bash
curl -sk -H 'Authorization: PVEAPIToken=<svc>@pve!<token>=<secret>'       https://10.70.20.150:8006/api2/json/nodes | jq
```

If `/cluster/status` fails:
- Ensure the `/` assignment is on the **token object** (`user@pve!token`), not only the user.
- Try `PVEAuditor` at `/` explicitly.
- Confirm DNS/SSL are not the issue (use IP, `-k` for test).
