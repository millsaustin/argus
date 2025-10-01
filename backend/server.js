import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import csurf from 'csurf';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';

import { pveGet } from './src/proxmoxClient.js';
import { authenticate, requireAuth, requireRole } from './src/auth.js';
import { createActionHandler, destructiveActions, performVmAction } from './src/actionHandlers.js';
import { generateProposal } from './services/llm.js';
import { createProposal, getProposal, saveApproval, markExecuted } from './src/proposalStore.js';
import { recordAudit, getRecentAuditEntries } from './src/auditLog.js';
import { generateAlerts } from './src/alerts.js';
import { ensureSchema, isDatabaseEnabled, withDb } from './src/db.js';
import { acquireLock as acquireResourceLock, releaseLock as releaseResourceLock, buildResourceKey } from './src/lockManager.js';

dotenv.config();
const app = express();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.set('trust proxy', 1); // trust reverse proxy headers (e.g., when TLS terminates at nginx)
}

const frontendOriginRaw = process.env.FRONTEND_ORIGIN;
if (!frontendOriginRaw) {
  console.warn('FRONTEND_ORIGIN not set; defaulting to http://localhost:3000');
}

const allowedOrigins = (frontendOriginRaw || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(morgan('combined'));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn('SESSION_SECRET not set; using insecure development secret');
}

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL is required for session persistence. Set it to a MongoDB connection string.');
}

const sessionStore = mongoUrl
  ? MongoStore.create({ mongoUrl, ttl: 86400 })
  : undefined;

// TLS should terminate at a reverse proxy (nginx/traefik). See reverse-proxy/nginx.conf for an example setup.
app.use(session({
  secret: sessionSecret || 'argus-insecure-dev-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict'
  }
}));

ensureSchema();

const csrfProtection = csurf({ cookie: false });
const csrfMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/api/csrf-token') {
    return csrfProtection(req, res, next);
  }

  if (csrfMethods.has(req.method)) {
    return csrfProtection(req, res, next);
  }

  return next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    code: 'TOO_MANY_ATTEMPTS',
    message: 'Too many login attempts, please try again later'
  }
});

const proposalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.username || req.ip,
  message: {
    ok: false,
    code: 'TOO_MANY_PROPOSALS',
    message: 'Too many proposal requests, please slow down'
  }
});

const proposalSchema = Joi.object({
  prompt: Joi.string().trim().max(500).required()
});

const metricsHistorySchema = Joi.object({
  node: Joi.string().trim().required(),
  vmid: Joi.number().integer().min(1).required(),
  hours: Joi.number().integer().min(1).max(168).default(24)
});

const allowedExecutionActions = new Set(['start', 'stop', 'reboot']);
const STEP_TIMEOUT_MS = Number(process.env.PROPOSAL_STEP_TIMEOUT_MS || 15000);

function logFailedLogin(req, reason) {
  const username = req.body?.username || 'unknown';
  const ip = req.ip;
  const timestamp = new Date().toISOString();
  console.warn(`[login-failed] user="${username}" ip=${ip} reason=${reason} timestamp=${timestamp}`);
  recordAudit({
    user: username,
    role: 'unknown',
    action: 'login_failed',
    ip,
    reason,
    result: 'fail',
    ts: Date.now()
  });
}

async function buildClusterSummary() {
  try {
    const nodes = await pveGet('/nodes');
    return {
      nodes: Array.isArray(nodes)
        ? nodes.map((node) => ({
            node: node.node,
            status: node.status,
            uptime: node.uptime
          }))
        : []
    };
  } catch (error) {
    return { nodes: [], error: error.message };
  }
}

function isProposalDestructive(proposal) {
  const steps = Array.isArray(proposal?.steps) ? proposal.steps : [];
  return steps.some((step) => {
    const action = String(step?.action || '').toLowerCase();
    return destructiveActions.has(action);
  });
}

function runWithTimeout(promiseFactory, timeoutMs) {
  return Promise.race([
    promiseFactory(),
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error('Step timed out'));
      }, timeoutMs);
    })
  ]);
}

async function executeWithRetry(action, node, vmid, timeoutMs) {
  let attempt = 0;
  let lastError = new Error('Unknown error');
  while (attempt < 2) {
    try {
      return await runWithTimeout(() => performVmAction(action, node, vmid), timeoutMs);
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= 2) {
        throw lastError;
      }
    }
  }
  throw lastError;
}

async function executeProposalSteps(proposal) {
  const steps = Array.isArray(proposal?.steps) ? proposal.steps : [];
  const results = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const action = String(step?.action || '').toLowerCase();
    const node = step?.node;
    const vmid = step?.vmid;

    if (!allowedExecutionActions.has(action)) {
      throw new Error(`Unsupported action "${action}"`);
    }

    if (!node || typeof node !== 'string' || typeof vmid !== 'number') {
      throw new Error(`Invalid step definition at index ${index}`);
    }

    const lockKey = buildResourceKey(node, vmid);
    if (!acquireResourceLock(lockKey)) {
      throw new Error(`Resource ${node}/${vmid} is locked by another operation`);
    }

    const timeoutMs = Number(step?.timeoutMs) || STEP_TIMEOUT_MS;

    try {
      const output = await executeWithRetry(action, node, vmid, timeoutMs);
      results.push({ index, action, node, vmid, status: 'success', output });
    } catch (error) {
      results.push({ index, action, node, vmid, status: 'fail', error: error.message });
      throw new Error(`Step ${index} failed: ${error.message}`);
    } finally {
      releaseResourceLock(lockKey);
    }
  }

  return results;
}

async function storeVmMetrics(node, items) {
  if (process.env.NODE_ENV === 'development') return;
  if (!isDatabaseEnabled()) return;
  if (!Array.isArray(items) || items.length === 0) return;

  const text = 'INSERT INTO vm_metrics (ts, node, vmid, cpu_pct, mem_pct, disk_pct) VALUES (NOW(), $1, $2, $3, $4, $5)';

  try {
    await withDb(async (client) => {
      await client.query('BEGIN');
      try {
        for (const item of items) {
          const vmid = typeof item.vmid === 'number' ? item.vmid : Number(item.vmid);
          if (!Number.isFinite(vmid)) continue;

          const cpuPct = typeof item.cpu === 'number' ? item.cpu * 100 : null;
          const hasMem = typeof item.mem === 'number' && typeof item.maxmem === 'number' && item.maxmem > 0;
          const memPct = hasMem ? (item.mem / item.maxmem) * 100 : null;
          const hasDisk = typeof item.disk === 'number' && typeof item.maxdisk === 'number' && item.maxdisk > 0;
          const diskPct = hasDisk ? (item.disk / item.maxdisk) * 100 : null;

          await client.query(text, [node, vmid, cpuPct, memPct, diskPct]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    console.warn('Failed to store VM metrics:', error.message);
    recordAudit({
      user: 'system',
      role: 'system',
      action: 'vm_metrics_store_failed',
      node,
      result: 'fail',
      message: error.message
    });
  }
}

// Health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/api/csrf-token', (req, res) => {
  return res.json({ ok: true, csrfToken: req.csrfToken() });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    logFailedLogin(req, 'missing_credentials');
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'Username and password are required'
    });
  }

  try {
    const user = await authenticate(username, password);
    if (!user) {
      logFailedLogin(req, 'invalid_credentials');
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
    logFailedLogin(req, 'internal_error');
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

app.get('/api/logs/recent', requireRole('viewer'), (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const offset = parseInt(req.query.offset, 10) || 0;
  const entries = getRecentAuditEntries({ limit, offset });
  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'logs_access',
    route: '/api/logs/recent',
    result: 'success'
  });
  res.json({ ok: true, entries });
});

app.get('/api/alerts', requireRole('viewer'), (req, res) => {
  const alerts = generateAlerts();
  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'alerts_access',
    route: '/api/alerts',
    result: 'success'
  });
  res.json({ ok: true, alerts });
});

app.get('/api/metrics/history', requireRole('viewer'), async (req, res) => {
  const { error, value } = metricsHistorySchema.validate(req.query || {});
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  if (!isDatabaseEnabled()) {
    return res.status(503).json({
      ok: false,
      code: 'METRICS_DISABLED',
      message: 'Metrics storage is not configured.'
    });
  }

  try {
    const rows = await withDb(async (client) => {
      const query = `
        SELECT ts, cpu_pct, mem_pct, disk_pct
        FROM vm_metrics
        WHERE node = $1 AND vmid = $2 AND ts >= NOW() - ($3::int) * INTERVAL '1 hour'
        ORDER BY ts ASC
      `;
      const result = await client.query(query, [value.node, value.vmid, value.hours]);
      return result.rows || [];
    });

    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'metrics_history_access',
      route: '/api/metrics/history',
      node: value.node,
      vmid: value.vmid,
      result: 'success'
    });

    return res.json({ ok: true, metrics: rows });
  } catch (err) {
    console.error('Failed to load metrics history:', err.message);
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'metrics_history_access',
      route: '/api/metrics/history',
      node: value.node,
      vmid: value.vmid,
      result: 'fail',
      message: err.message
    });
    return res.status(500).json({
      ok: false,
      code: 'METRICS_QUERY_FAILED',
      message: 'Unable to load metrics history'
    });
  }
});

app.post('/api/assistant/propose', requireRole('operator'), proposalLimiter, async (req, res) => {
  const { error, value } = proposalSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  const user = req.session?.user;
  let context;
  try {
    context = await buildClusterSummary();
  } catch (err) {
    context = { nodes: [], error: err.message };
  }

  try {
    const proposal = await generateProposal(value.prompt, context);
    const destructive = isProposalDestructive(proposal);
    const record = createProposal({
      proposal,
      createdBy: user?.username || 'unknown',
      destructive
    });

    recordAudit({
      user: user?.username || 'unknown',
      role: user?.role || 'unknown',
      action: 'assistant_propose',
      proposalId: record.id,
      result: 'pending'
    });

    return res.json({ ok: true, proposalId: record.id, proposal: record.proposal });
  } catch (err) {
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'assistant_propose',
      result: 'fail',
      message: err.message
    });
    return res.status(502).json({
      ok: false,
      code: 'PROPOSAL_GENERATION_FAILED',
      message: err.message
    });
  }
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
app.get('/api/proxmox/nodes', requireAuth, async (_req, res) => {
  await proxyAndRespond(res, '/nodes');
});

// Proxy: cluster status
app.get('/api/proxmox/cluster/status', requireAuth, async (_req, res) => {
  await proxyAndRespond(res, '/cluster/status');
});

// Proxy: list VMs per node
app.get('/api/proxmox/nodes/:node/qemu', requireAuth, async (req, res) => {
  const { node } = req.params;
  try {
    const data = await pveGet(`/nodes/${encodeURIComponent(node)}/qemu`);
    await storeVmMetrics(node, Array.isArray(data) ? data : []);
    res.json({ ok: true, data });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
});

// Proxy: list LXCs per node
app.get('/api/proxmox/nodes/:node/lxc', requireAuth, async (req, res) => {
  const { node } = req.params;
  await proxyAndRespond(res, `/nodes/${encodeURIComponent(node)}/lxc`);
});

app.post('/api/proxmox/actions/start', requireRole('operator'), createActionHandler('start'));
app.post('/api/proxmox/actions/stop', requireRole('operator'), createActionHandler('stop'));
app.post('/api/proxmox/actions/reboot', requireRole('operator'), createActionHandler('reboot'));

app.post('/api/assistant/confirm/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const record = getProposal(id);

  if (!record) {
    return res.status(404).json({
      ok: false,
      code: 'PROPOSAL_NOT_FOUND',
      message: 'Proposal not found'
    });
  }

  if (!record.approvals) {
    record.approvals = new Set();
  }

  if (record.status === 'COMPLETED') {
    return res.status(409).json({
      ok: false,
      code: 'ALREADY_EXECUTED',
      message: 'Proposal already executed'
    });
  }

  const user = req.session?.user;
  const username = user?.username || 'unknown';
  const role = user?.role || 'unknown';

  const dualControlEnabled = process.env.REQUIRE_DUAL_CONTROL === 'true' && record.destructive;

  if (dualControlEnabled) {
    if (record.approvals.has(username)) {
      return res.status(409).json({
        ok: false,
        code: 'ALREADY_APPROVED',
        message: 'This user has already approved the proposal'
      });
    }

    if (record.approvals.size === 0) {
      saveApproval(id, username);
      recordAudit({
        user: username,
        role,
        action: 'assistant_confirm',
        proposalId: id,
        result: 'pending_second_approval'
      });
      return res.json({
        ok: true,
        result: {
          status: 'PENDING_SECOND_APPROVAL'
        }
      });
    }
  }

  saveApproval(id, username);

  let executionResults = [];
  try {
    executionResults = await executeProposalSteps(record.proposal);
    markExecuted(id, 'COMPLETED', executionResults);
    recordAudit({
      user: username,
      role,
      action: 'assistant_confirm',
      proposalId: id,
      result: 'success'
    });
    return res.json({ ok: true, results: executionResults });
  } catch (error) {
    markExecuted(id, 'FAILED', executionResults);
    recordAudit({
      user: username,
      role,
      action: 'assistant_confirm',
      proposalId: id,
      result: 'fail',
      message: error.message
    });
    return res.status(500).json({
      ok: false,
      code: 'EXECUTION_FAILED',
      message: error.message
    });
  }
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

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      ok: false,
      code: 'CSRF_ERROR',
      message: 'Invalid CSRF token'
    });
  }

  return next(err);
});

const listenPort = Number(process.env.PORT || 3001);
app.listen(listenPort, () => console.log(`Argus backend listening on :${listenPort}`));
