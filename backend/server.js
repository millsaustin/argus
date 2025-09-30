import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';

import { pveGet } from './src/proxmoxClient.js';
import Roles from './src/authRoles.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

const roleOrder = [Roles.VIEWER, Roles.OPERATOR, Roles.ADMIN];

app.use((req, _res, next) => {
  const roleFromEnv = (process.env.ARGUS_ROLE || Roles.VIEWER).toLowerCase();
  req.userRole = roleOrder.includes(roleFromEnv) ? roleFromEnv : Roles.VIEWER;
  next();
});

function requireRole(minRole) {
  return (req, res, next) => {
    const userIndex = roleOrder.indexOf(req.userRole);
    const minIndex = roleOrder.indexOf(minRole);

    if (userIndex === -1 || minIndex === -1 || userIndex < minIndex) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Insufficient role'
      });
    }

    return next();
  };
}

// Health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/protected', requireRole(Roles.OPERATOR), (_req, res) => {
  res.json({ ok: true, msg: 'You are operator or admin' });
});

function buildErrorResponse(error) {
  const status = Number(error?.status) || 500;
  let code = 'INTERNAL';
  let hint;

  if (status === 401) {
    code = 'UNAUTHORIZED';
  } else if (status === 403) {
    code = 'FORBIDDEN';
    hint = "Token likely lacks Sys.Audit at '/' or the specific path.";
  } else if (status === 404) {
    code = 'NOT_FOUND';
  }

  const payload = error?.payload || {};
  const message = payload.errors
    ? Array.isArray(payload.errors)
      ? payload.errors.join('; ')
      : payload.errors
    : payload.message || error?.message || 'Proxmox request failed';

  const body = {
    ok: false,
    status,
    code,
    message
  };

  if (hint) {
    body.hint = hint;
  }

  return { status, body };
}

async function proxyAndRespond(res, path) {
  try {
    const data = await pveGet(path);
    res.json({ ok: true, data });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
}

// Proxy: nodes
app.get('/api/proxmox/nodes', async (_req, res) => {
  await proxyAndRespond(res, '/nodes');
});

// Proxy: cluster status
app.get('/api/proxmox/cluster/status', async (_req, res) => {
  await proxyAndRespond(res, '/cluster/status');
});

// Proxy: list VMs per node
app.get('/api/proxmox/nodes/:node/qemu', async (req, res) => {
  const { node } = req.params;
  await proxyAndRespond(res, `/nodes/${encodeURIComponent(node)}/qemu`);
});

// Proxy: list LXCs per node
app.get('/api/proxmox/nodes/:node/lxc', async (req, res) => {
  const { node } = req.params;
  await proxyAndRespond(res, `/nodes/${encodeURIComponent(node)}/lxc`);
});

app.get('/api/guardrails/plan', (req, res) => {
  const { action } = req.query;

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Query parameter "action" is required' });
  }

  const normalized = action.toLowerCase();
  const highRiskKeywords = ['delete', 'shutdown', 'migrate'];
  const isHighRisk = highRiskKeywords.some((keyword) => normalized.includes(keyword));

  const scaffold = {
    action,
    risk_level: isHighRisk ? 'high' : 'low',
    steps: [],
    require_snapshot: isHighRisk
  };

  res.json(scaffold);
});

app.get('/api/version', async (_req, res) => {
  await proxyAndRespond(res, '/version');
});

const listenPort = Number(process.env.PORT || 3001);
app.listen(listenPort, () => console.log(`Argus backend listening on :${listenPort}`));
