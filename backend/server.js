import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import session from 'express-session';

import { pveGet } from './src/proxmoxClient.js';
import { authenticate, requireAuth, requireRole } from './src/auth.js';

dotenv.config();
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('combined'));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn('SESSION_SECRET not set; using insecure development secret');
}

app.use(session({
  secret: sessionSecret || 'argus-insecure-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

// Health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'Username and password are required'
    });
  }

  try {
    const user = await authenticate(username, password);
    if (!user) {
      return res.status(401).json({
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password'
      });
    }

    req.session.user = user;
    return res.json({
      ok: true,
      user
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      ok: false,
      code: 'INTERNAL',
      message: 'Login failed'
    });
  }
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error('Logout error:', error);
      return res.status(500).json({
        ok: false,
        code: 'INTERNAL',
        message: 'Logout failed'
      });
    }

    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  return res.json({
    ok: true,
    user: req.session.user
  });
});

app.get('/api/protected', requireRole('operator'), (_req, res) => {
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
