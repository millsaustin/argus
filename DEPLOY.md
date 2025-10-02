# Argus Deployment Guide

This document walks through sandbox deployment, day-two operations, and
troubleshooting for the Argus stack.

---

## 1. Sandbox Deployment

1. **Install Docker Engine and Compose**
   - Linux: follow the official Docker Engine + `docker compose` plugin
     instructions.
   - macOS / Windows: install Docker Desktop (Compose is included).

2. **Prepare environment files**
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.local.example frontend/.env.local
   ```
   Edit both files and set real secrets:
   - `SESSION_SECRET`, `DB_PASSWORD`
   - Proxmox credentials (`PROXMOX_API_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`)
   - Optional integrations (OpenAI, SMTP/SendGrid, Slack)

3. **Launch the stack**
   ```bash
   docker compose up -d --build
   ```

4. **Access the UI**
   - Point your browser to <https://argus.local> (adjust `/etc/hosts` or DNS if
     needed).
   - Sign in using the bootstrap admin credentials printed in
     `docker compose logs backend`.

---

## 2. Common Operations

### Generate Self-Signed Certificates (sandbox)
```bash
mkdir -p deploy/certs
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout deploy/certs/privkey.pem \
  -out deploy/certs/fullchain.pem \
  -subj "/CN=argus.local"
```
Copy the resulting files into `deploy/certs/` and restart nginx
(`docker compose restart nginx`). Browsers will warn about untrusted certs—use
Let's Encrypt for real domains.

### Connect to the Proxmox API
Edit `backend/.env` and set:
```
PROXMOX_API_URL=https://<your-proxmox-host>:8006/api2/json
PROXMOX_TOKEN_ID=<user>@<realm>!<token-name>
PROXMOX_TOKEN_SECRET=<secret>
```
Restart the backend container so changes take effect:
```
docker compose restart backend
```

### Restore from Backup
Backups created by `deploy/backup.sh` land in `backup/`.

1. **Postgres**
   ```bash
   psql -U argus -d argus < backup/argus-YYYYMMDD-HHMMSS.sql
   ```
2. **Redis**
   ```bash
   tar -xzf backup/redis-YYYYMMDD-HHMMSS.tar.gz -C data/
   docker compose restart redis
   ```

### Scale Containers
Increase frontend replicas behind nginx:
```bash
docker compose up -d --scale frontend=2
```
Nginx will round-robin requests to the scaled containers.

---

## 3. Troubleshooting

| Issue | Resolution |
| --- | --- |
| Container fails to start | Inspect logs: `docker compose logs -f <service>` |
| SSL errors in browser | Regenerate certificates in `deploy/certs/` and restart nginx |
| Proxmox authentication errors | Verify token ID/secret and the cluster's TLS certificate (update `PROXMOX_API_URL`, `PROXMOX_TOKEN_SECRET`) |

---

Need more help? Check `README.md` for architecture details or open an issue with
logs and environment context.
