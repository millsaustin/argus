import axios from 'axios';
import https from 'https';

const REQUIRED_ENV = ['PROXMOX_API_URL', 'PROXMOX_TOKEN_ID', 'PROXMOX_TOKEN_SECRET'];

function ensureEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required Proxmox environment variables: ${missing.join(', ')}`);
  }
}

ensureEnv();

const baseURL = process.env.PROXMOX_API_URL.replace(/\/$/, '');
const tokenId = process.env.PROXMOX_TOKEN_ID;
const tokenSecret = process.env.PROXMOX_TOKEN_SECRET;
const allowInsecure = String(process.env.PROXMOX_INSECURE_TLS).toLowerCase() === 'true';

const axiosConfig = {
  baseURL,
  headers: {
    Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`
  }
};

if (allowInsecure) {
  axiosConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

const client = axios.create(axiosConfig);

export async function pveGet(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  try {
    const response = await client.get(normalizedPath);
    return response.data?.data;
  } catch (error) {
    if (error.response) {
      const proxmoxError = new Error('Proxmox request failed');
      proxmoxError.status = error.response.status;
      proxmoxError.payload = error.response.data;
      throw proxmoxError;
    }

    throw error;
  }
}
