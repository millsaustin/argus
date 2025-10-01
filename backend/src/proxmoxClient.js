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
const isProduction = process.env.NODE_ENV === 'production';
const allowInsecureEnv = String(process.env.PROXMOX_INSECURE_TLS).toLowerCase() === 'true';
const allowInsecure = !isProduction && allowInsecureEnv;

const axiosConfig = {
  baseURL,
  headers: {
    Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`
  },
  httpsAgent: new https.Agent({ rejectUnauthorized: !allowInsecure })
};

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
      if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        proxmoxError.message = 'TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.';
      }
      throw proxmoxError;
    }

    if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      const tlsError = new Error('TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.');
      tlsError.status = 502;
      throw tlsError;
    }

    throw error;
  }
}

export async function pvePost(path, body = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  try {
    const response = await client.post(normalizedPath, body);
    return response.data?.data;
  } catch (error) {
    if (error.response) {
      const proxmoxError = new Error('Proxmox request failed');
      proxmoxError.status = error.response.status;
      proxmoxError.payload = error.response.data;
      if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        proxmoxError.message = 'TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.';
      }
      throw proxmoxError;
    }

    if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      const tlsError = new Error('TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.');
      tlsError.status = 502;
      throw tlsError;
    }

    throw error;
  }
}
