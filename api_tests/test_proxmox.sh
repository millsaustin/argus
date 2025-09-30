#!/usr/bin/env bash
set -euo pipefail
: "${PROXMOX_HOST:?Set PROXMOX_HOST}"
: "${PROXMOX_TOKEN_ID:?Set PROXMOX_TOKEN_ID}"
: "${PROXMOX_TOKEN_SECRET:?Set PROXMOX_TOKEN_SECRET}"

H="Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}"

echo "# /nodes"
curl -sk -H "$H" "${PROXMOX_HOST}/api2/json/nodes" | jq

echo "# /cluster/status"
curl -sk -H "$H" "${PROXMOX_HOST}/api2/json/cluster/status" | jq
