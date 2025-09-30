import axios from 'axios';
import https from 'https';

const REQUIRED_ENV_VARS = ['PROXMOX_HOST', 'PROXMOX_TOKEN_ID', 'PROXMOX_TOKEN_SECRET'];

export function ensureProxmoxEnv(env = process.env) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Proxmox environment variables: ${missing.join(', ')}`
    );
  }
  const host = env.PROXMOX_HOST.replace(/\/$/, '');
  return {
    host,
    tokenId: env.PROXMOX_TOKEN_ID,
    tokenSecret: env.PROXMOX_TOKEN_SECRET
  };
}

export function createProxmoxClient({ host, tokenId, tokenSecret }) {
  const sanitizedHost = host.replace(/\/$/, '');
  return axios.create({
    baseURL: `${sanitizedHost}/api2/json`,
    headers: {
      Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
}

export default function proxmoxClientFromEnv(env = process.env) {
  const config = ensureProxmoxEnv(env);
  return createProxmoxClient(config);
}
