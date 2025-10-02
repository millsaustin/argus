import express from 'express';
import { randomUUID } from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import csurf from 'csurf';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';

import { pveGet, getNodePool, getVmPoolMapForNode, getResourcePoolIndex } from './src/proxmoxClient.js';
import {
  authenticate,
  requireAuth,
  requireRole,
  createUser as createUserAccount,
  listUsers as listUserAccounts,
  adminUpdateUser,
  deactivateUser as deactivateUserAccount,
  changePassword as changeUserPassword
} from './src/auth.js';
import { createActionHandler, destructiveActions, performVmAction } from './src/actionHandlers.js';
import { generateProposal } from './services/llm.js';
import { scheduleMetricsRetention } from './services/retention.js';
import { notifyAssistantDecision } from './services/notify.js';
import { rehydrateFromLLM } from './services/sanitize.js';
import { createProposal, getProposal, saveApproval, markExecuted, listProposals } from './src/proposalStore.js';
import { recordAudit, getRecentAuditEntries, listAuditUsers, getAuditEntries } from './src/auditLog.js';
import { generateAlerts } from './src/alerts.js';
import { ensureSchema, isDatabaseEnabled, withDb } from './src/db.js';
import { acquireLock as acquireResourceLock, releaseLock as releaseResourceLock, buildResourceKey } from './src/lockManager.js';

dotenv.config();
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const truthyFlags = new Set(['1', 'true', 'yes', 'on']);
const isMockMode = truthyFlags.has(String(process.env.PROXMOX_MOCK_MODE || '').trim().toLowerCase());

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
  const msg = 'MONGO_URL is required for session persistence. Set it to a MongoDB connection string.';
  if (isMockMode) {
    console.warn(`${msg} Mock mode will default to the in-memory store.`);
  } else {
    console.error(msg);
  }
}

let sessionStore;
if (mongoUrl && !isMockMode) {
  try {
    sessionStore = MongoStore.create({ mongoUrl, ttl: 86400 });
    sessionStore.on('error', (error) => {
      console.error('Session store error:', error.message);
    });
  } catch (error) {
    console.error('Failed to initialize Mongo session store, falling back to memory store:', error.message);
  }
} else if (mongoUrl && isMockMode) {
  console.warn('Mock mode active: skipping Mongo-backed session store and using in-memory sessions.');
}

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

if (process.env.NODE_ENV === 'production') {
  if (isDatabaseEnabled()) {
    const retentionDays = process.env.METRICS_RETENTION_DAYS || 90;
    const auditRetentionDays = process.env.RETENTION_AUDIT_DAYS || 365;
    scheduleMetricsRetention(retentionDays, auditRetentionDays);
  } else {
    console.warn('Metrics retention job not scheduled: POSTGRES_URL is not configured.');
  }
}

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
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.username || rateLimit.ipKeyGenerator(req),
  message: {
    ok: false,
    code: 'TOO_MANY_PROPOSALS',
    message: 'Too many proposal requests this minute'
  }
});

const logsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session?.user?.username || rateLimit.ipKeyGenerator(req),
  message: {
    ok: false,
    code: 'LOGS_RATE_LIMIT',
    message: 'Too many log requests, please slow down.'
  }
});

const proposalSchema = Joi.object({
  prompt: Joi.string().trim().max(1000).required()
});

const metricsHistorySchema = Joi.object({
  node: Joi.string().trim().required(),
  vmid: Joi.number().integer().min(1).required(),
  hours: Joi.number().integer().min(1).max(168).default(24)
});

const logsFilterSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).optional(),
  offset: Joi.number().integer().min(0).optional(),
  user: Joi.string().trim().max(120).optional(),
  action: Joi.string().trim().max(120).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional()
});

const roleEnum = Joi.string().valid('viewer', 'operator', 'admin');

const userCreateSchema = Joi.object({
  username: Joi.string().trim().min(3).max(64).required(),
  password: Joi.string().min(8).max(128).required(),
  role: roleEnum.required(),
  allowedPools: Joi.array().items(Joi.string().trim().lowercase()).optional()
});

const userUpdateSchema = Joi.object({
  role: roleEnum.optional(),
  forcePasswordReset: Joi.boolean().optional(),
  allowedPools: Joi.array().items(Joi.string().trim().lowercase()).optional()
})
  .or('role', 'forcePasswordReset', 'allowedPools')
  .messages({
    'object.missing': 'Provide role, forcePasswordReset, or allowedPools'
  });

const passwordChangeSchema = Joi.object({
  username: Joi.string().trim().min(3).max(120).required(),
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().required()
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

function ensurePoolAccess(req, res, { pool, node, vmid, action, reason }) {
  const context = {
    action,
    node,
    vmid,
    pool: pool || 'unknown',
    reason
  };

  let allowed = true;
  if (req.assertPoolAccess) {
    allowed = req.assertPoolAccess(pool, context);
  } else if (req.hasPoolAccess) {
    allowed = req.hasPoolAccess(pool);
    if (!allowed) {
      recordAudit({
        user: req.session?.user?.username || 'unknown',
        role: req.session?.user?.role || 'unknown',
        action: action || 'pool_access_denied',
        node,
        vmid,
        pool: context.pool,
        result: 'deny',
        reason: reason || (pool ? `Pool ${pool} not permitted` : 'Resource pool unavailable')
      });
    }
  }

  if (!allowed) {
    const message = reason || (pool ? `Pool ${pool} not permitted` : 'Resource pool unavailable');
    res.status(403).json({
      ok: false,
      code: 'POOL_FORBIDDEN',
      message
    });
    return false;
  }

  return true;
}

async function safeNotifyAssistant(payload) {
  try {
    await notifyAssistantDecision(payload);
  } catch (error) {
    console.error('Assistant notification failed:', error);
    recordAudit({
      user: 'system',
      role: 'system',
      action: 'notify_assistant',
      result: 'fail',
      message: error.message,
      metadata: payload
    });
  }
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

function summarizeProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return 'No summary available';
  if (proposal.summary) return proposal.summary;
  if (proposal.description) return proposal.description;

  if (Array.isArray(proposal.steps) && proposal.steps.length > 0) {
    const step = proposal.steps[0];
    const action = step?.action ? String(step.action).toUpperCase() : 'STEP';
    const node = step?.node ? ` on ${step.node}` : '';
    const vmid = step?.vmid ? ` (VM ${step.vmid})` : '';
    return `${action}${node}${vmid}`.trim();
  }

  try {
    return JSON.stringify(proposal).slice(0, 140);
  } catch (_error) {
    return 'Proposal summary unavailable';
  }
}

function summarizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step, index) => ({
    index,
    action: step?.action,
    node: step?.node,
    vmid: step?.vmid
  }));
}

function dayKey(ts) {
  const date = new Date(Number(ts || Date.now()));
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

const PROPOSAL_ADMIN_FIELDS = new Set(['results']);

function buildProposalDetails(record, includeSensitive) {
  const details = {
    proposal: record.proposal,
    approvals: Array.from(record.approvals || []),
    destructive: record.destructive,
    sanitizedPrompt: record.prompt,
    sanitizedPreview: record.promptPreview,
    redactionsApplied: record.redactionsApplied,
    tokensUsed: record.tokensUsed
  };

  if (includeSensitive) {
    details.results = record.results;
  }

  return sanitizeStructuredValue(details, includeSensitive);
}

function sanitizeStructuredValue(value, includeSensitive) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredValue(item, includeSensitive));
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!includeSensitive && PROPOSAL_ADMIN_FIELDS.has(key)) {
        continue;
      }
      const sanitized = sanitizeStructuredValue(inner, includeSensitive);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  return value;
}

function redactString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');
}

function serializeProposalRecord(record, includeSensitive) {
  const approvals = Array.from(record.approvals || []);
  return {
    id: record.id,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    status: record.status,
    destructive: record.destructive,
    approvals,
    approvalsCount: approvals.length,
    summary: summarizeProposal(record.proposal),
    details: buildProposalDetails(record, includeSensitive)
  };
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

app.post('/api/change-password', loginLimiter, async (req, res) => {
  const { error, value } = passwordChangeSchema.validate(req.body || {}, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  try {
    await changeUserPassword(value.username, value.oldPassword, value.newPassword);
    return res.json({ ok: true });
  } catch (err) {
    let status = 500;
    let code = 'INTERNAL';
    let message = 'Failed to change password';

    if (err.code === 'USER_NOT_FOUND') {
      status = 404;
      code = 'USER_NOT_FOUND';
      message = 'User not found';
    } else if (err.code === 'INVALID_OLD_PASSWORD') {
      status = 401;
      code = 'INVALID_OLD_PASSWORD';
      message = 'Current password is incorrect';
    } else if (err.code === 'PASSWORD_COMPLEXITY') {
      status = 400;
      code = 'WEAK_PASSWORD';
      message = 'New password does not meet complexity requirements';
    } else if (err.code === 'PASSWORD_REUSE') {
      status = 400;
      code = 'PASSWORD_REUSE';
      message = 'New password must be different from the current password';
    }

    recordAudit({
      user: value.username,
      role: 'unknown',
      action: 'change_password',
      result: 'fail',
      message: err.message
    });

    return res.status(status).json({
      ok: false,
      code,
      message
    });
  }
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

    if (user.mustChangePassword) {
      logFailedLogin(req, 'password_change_required');
      return res.status(403).json({
        ok: false,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required before login',
        mustChangePassword: true,
        username: user.username
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

app.post('/api/users', requireRole('admin'), async (req, res) => {
  const { error, value } = userCreateSchema.validate(req.body || {}, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  try {
    const user = await createUserAccount(value.username, value.password, value.role, {
      allowedPools: value.allowedPools,
      mustChangePassword: true
    });
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'user_create',
      targetUser: user.username,
      result: 'success',
      request: { username: user.username, role: user.role, allowedPools: user.allowedPools }
    });
    return res.status(201).json({ ok: true, user });
  } catch (err) {
    const messageLower = String(err?.message || '').toLowerCase();
    const existsConflict = messageLower.includes('exists');
    const weakPassword = err?.code === 'PASSWORD_COMPLEXITY';
    const status = existsConflict ? 409 : weakPassword ? 400 : 500;
    const code = existsConflict ? 'USER_EXISTS' : weakPassword ? 'WEAK_PASSWORD' : 'INTERNAL';
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'user_create',
      targetUser: value.username,
      result: 'fail',
      message: err.message
    });
    return res.status(status).json({
      ok: false,
      code,
      message: existsConflict
        ? 'Username already exists'
        : weakPassword
          ? 'Password does not meet complexity requirements'
          : 'Failed to create user'
    });
  }
});

app.get('/api/users', requireRole('admin'), (req, res) => {
  const users = listUserAccounts();
  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'user_list',
    result: 'success',
    count: users.length
  });
  res.json({ ok: true, users });
});

app.put('/api/users/:id', requireRole('admin'), async (req, res) => {
  const { error, value } = userUpdateSchema.validate(req.body || {}, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  try {
    const updated = await adminUpdateUser(req.params.id, value);
    if (!updated) {
      recordAudit({
        user: req.session?.user?.username || 'unknown',
        role: req.session?.user?.role || 'unknown',
        action: 'user_update',
        targetUser: req.params.id,
        result: 'fail',
        message: 'User not found'
      });
      return res.status(404).json({
        ok: false,
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    const response = {
      ok: true,
      user: updated.user
    };
    if (value.forcePasswordReset && updated.temporaryPassword) {
      response.temporaryPassword = updated.temporaryPassword;
    }

    const updateDetails = {};
    if (value.role) updateDetails.role = updated.user.role;
    if (value.forcePasswordReset !== undefined) {
      updateDetails.forcePasswordReset = Boolean(value.forcePasswordReset);
    }
    if (value.allowedPools) {
      updateDetails.allowedPools = updated.user.allowedPools;
    }

    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'user_update',
      targetUser: updated.user.username,
      result: 'success',
      request: updateDetails
    });

    return res.json(response);
  } catch (err) {
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'user_update',
      targetUser: req.params.id,
      result: 'fail',
      message: err.message
    });
    return res.status(500).json({
      ok: false,
      code: 'INTERNAL',
      message: 'Failed to update user'
    });
  }
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  const user = deactivateUserAccount(req.params.id);
  if (!user) {
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'user_deactivate',
      targetUser: req.params.id,
      result: 'fail',
      message: 'User not found'
    });
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      message: 'User not found'
    });
  }

  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'user_deactivate',
    targetUser: user.username,
    result: 'success'
  });

  return res.json({ ok: true, user });
});

app.get('/api/logs/recent', logsLimiter, requireRole('viewer'), (req, res) => {
  const { error, value } = logsFilterSchema.validate(req.query || {});
  if (error) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: error.details.map((detail) => detail.message).join(', ')
    });
  }

  const { limit, offset, user: userFilter, action: actionFilter, from, to } = value;
  if (from && to && new Date(from) > new Date(to)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_RANGE',
      message: '`from` must be before `to`'
    });
  }

  const role = String(req.session?.user?.role || '').toLowerCase();
  const includeSensitive = role === 'admin';
  const filters = {
    user: userFilter,
    action: actionFilter,
    from,
    to
  };

  const entries = getRecentAuditEntries({
    limit,
    offset,
    includeDetails: true,
    includeSensitive,
    filters
  });

  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'logs_access',
    route: '/api/logs/recent',
    result: 'success',
    request: { ...filters, limit, offset }
  });

  res.json({ ok: true, entries });
});

app.get('/api/logs/users', logsLimiter, requireRole('viewer'), (req, res) => {
  const users = listAuditUsers();
  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'logs_users',
    route: '/api/logs/users',
    result: 'success'
  });
  res.json({ ok: true, users });
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

  const proposalId = randomUUID();

  try {
    const {
      proposal,
      sanitizedPrompt,
      sanitizedPromptPreview,
      redactionsApplied,
      usage
    } = await generateProposal(value.prompt, context, { proposalId });

    const proposalWithId = { ...proposal, id: proposalId };
    const destructive = isProposalDestructive(proposalWithId);
    const record = createProposal({
      proposal: proposalWithId,
      createdBy: user?.username || 'unknown',
      destructive
    });

    const tokensUsed = usage?.total_tokens ? Number(usage.total_tokens) : 0;
    record.prompt = sanitizedPrompt;
    record.promptPreview = sanitizedPromptPreview;
    record.redactionsApplied = redactionsApplied;
    record.tokensUsed = tokensUsed;

    recordAudit({
      user: user?.username || 'unknown',
      role: user?.role || 'unknown',
      action: 'assistant_propose',
      proposalId: record.id,
      result: 'pending',
      prompt: sanitizedPrompt,
      sanitizedPreview: sanitizedPromptPreview,
      redactionsApplied,
      tokensUsed,
      proposal: record.proposal
    });

    return res.json({ ok: true, proposalId: record.id, proposal: record.proposal });
  } catch (err) {
    recordAudit({
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action: 'assistant_propose',
      result: 'fail',
      message: err.message,
      proposalId,
      prompt: err?.sanitizedPrompt || '[sanitized_unavailable]',
      sanitizedPreview: err?.sanitizedPromptPreview || '[sanitized_unavailable]',
      redactionsApplied: err?.redactionsApplied ?? null
    });
    return res.status(502).json({
      ok: false,
      code: 'PROPOSAL_GENERATION_FAILED',
      message: err.message
    });
  }
});


app.get('/api/assistant/proposals', requireRole('operator'), (req, res) => {
  const role = String(req.session?.user?.role || 'viewer').toLowerCase();
  const username = req.session?.user?.username || 'unknown';
  const includeSensitive = role === 'admin';
  const allProposals = listProposals();
  const filtered = allProposals.filter((record) => (includeSensitive ? true : record.createdBy === username));
  const proposals = filtered.map((record) => serializeProposalRecord(record, includeSensitive));

  recordAudit({
    user: username,
    role,
    action: 'assistant_proposals_list',
    result: 'success',
    request: { includeSensitive }
  });

  return res.json({ ok: true, proposals });
});

app.get('/api/llm/usage', requireRole('admin'), (req, res) => {
  const entries = getAuditEntries();
  const proposalsPerDay = {};
  const redactionsPerDay = {};
  const tokensPerDay = {};
  let totalTokensUsed = 0;
  const approvals = {
    approved: 0,
    denied: 0,
    pending: 0,
    failed: 0
  };

  for (const entry of entries) {
    const action = entry.action;
    if (!action) continue;
    const day = dayKey(entry.ts);

    if (action === 'assistant_propose') {
      proposalsPerDay[day] = (proposalsPerDay[day] || 0) + 1;
      const tokens = Number(entry.tokensUsed ?? entry.usage?.total_tokens ?? 0);
      if (!Number.isNaN(tokens) && tokens > 0) {
        totalTokensUsed += tokens;
        tokensPerDay[day] = (tokensPerDay[day] || 0) + tokens;
      }
    }

    if (action === 'llm_sanitize') {
      const redactions = Number(entry.redactionsApplied ?? entry.redactions ?? 0);
      if (!Number.isNaN(redactions) && redactions > 0) {
        redactionsPerDay[day] = (redactionsPerDay[day] || 0) + redactions;
      }
    }

    if (action === 'assistant_confirm') {
      if (entry.result === 'success') {
        approvals.approved += 1;
      } else if (entry.result === 'denied') {
        approvals.denied += 1;
      } else if (entry.result === 'pending_second_approval') {
        approvals.pending += 1;
      } else if (entry.result === 'fail') {
        approvals.failed += 1;
      }
    }
  }

  const totalProposals = Object.values(proposalsPerDay).reduce((acc, value) => acc + value, 0);
  const totalRedactions = Object.values(redactionsPerDay).reduce((acc, value) => acc + value, 0);

  recordAudit({
    user: req.session?.user?.username || 'unknown',
    role: req.session?.user?.role || 'unknown',
    action: 'llm_usage_view',
    result: 'success'
  });

  return res.json({
    ok: true,
    metrics: {
      proposals: {
        perDay: proposalsPerDay,
        total: totalProposals
      },
      redactions: {
        perDay: redactionsPerDay,
        total: totalRedactions
      },
      tokens: {
        perDay: tokensPerDay,
        total: totalTokensUsed
      },
      approvals
    }
  });
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
app.get('/api/proxmox/nodes', requireRole('viewer'), async (req, res) => {
  try {
    const nodes = await pveGet('/nodes');
    let data = Array.isArray(nodes) ? nodes : [];
    if (!req.allowedPools?.includes('*')) {
      const { nodePools } = await getResourcePoolIndex();
      data = data.filter((node) => {
        const pool = nodePools.get(String(node.node)) || node.pool || null;
        return req.hasPoolAccess ? req.hasPoolAccess(pool) : true;
      });
    }
    res.json({ ok: true, data });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
});

// Proxy: cluster status
app.get('/api/proxmox/cluster/status', requireRole('viewer'), async (req, res) => {
  try {
    const statusPayload = await pveGet('/cluster/status');
    let data = Array.isArray(statusPayload) ? statusPayload : [];
    if (!req.allowedPools?.includes('*')) {
      const { nodePools } = await getResourcePoolIndex();
      data = data.filter((entry) => {
        if (entry?.type !== 'node') return true;
        const poolKey = entry.id || entry.node || entry.name;
        const pool = poolKey ? nodePools.get(String(poolKey)) : null;
        return req.hasPoolAccess ? req.hasPoolAccess(pool) : true;
      });
    }
    res.json({ ok: true, data });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
});

// Proxy: list VMs per node
app.get('/api/proxmox/nodes/:node/qemu', requireRole('viewer'), async (req, res) => {
  const { node } = req.params;
  try {
    const nodePool = await getNodePool(node);
    if (!ensurePoolAccess(req, res, {
      pool: nodePool,
      node,
      action: 'proxmox_qemu_list',
      reason: 'Node pool not permitted'
    })) {
      return;
    }

    const raw = await pveGet(`/nodes/${encodeURIComponent(node)}/qemu`);
    const items = Array.isArray(raw) ? raw : [];
    let filtered = items;
    if (!req.allowedPools?.includes('*')) {
      const vmPools = await getVmPoolMapForNode(node);
      filtered = items.filter((item) => {
        const candidatePool = vmPools.get(Number(item.vmid)) || item.pool || nodePool || null;
        return req.hasPoolAccess ? req.hasPoolAccess(candidatePool) : true;
      });
    }

    await storeVmMetrics(node, filtered);
    res.json({ ok: true, data: filtered });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
});

// Proxy: list LXCs per node
app.get('/api/proxmox/nodes/:node/lxc', requireRole('viewer'), async (req, res) => {
  const { node } = req.params;
  try {
    const nodePool = await getNodePool(node);
    if (!ensurePoolAccess(req, res, {
      pool: nodePool,
      node,
      action: 'proxmox_lxc_list',
      reason: 'Node pool not permitted'
    })) {
      return;
    }

    const raw = await pveGet(`/nodes/${encodeURIComponent(node)}/lxc`);
    const items = Array.isArray(raw) ? raw : [];
    let filtered = items;
    if (!req.allowedPools?.includes('*')) {
      const vmPools = await getVmPoolMapForNode(node);
      filtered = items.filter((item) => {
        const candidatePool = vmPools.get(Number(item.vmid)) || item.pool || nodePool || null;
        return req.hasPoolAccess ? req.hasPoolAccess(candidatePool) : true;
      });
    }

    res.json({ ok: true, data: filtered });
  } catch (error) {
    const { status, body } = buildErrorResponse(error);
    res.status(status).json(body);
  }
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

  const decisionRaw = req.body?.decision;
  const normalizedDecision = typeof decisionRaw === 'string' ? decisionRaw.toLowerCase() : 'approve';
  const decision = normalizedDecision === 'deny' ? 'deny' : 'approve';
  const auditRequest = { decision, proposalId: id };

  const dualControlEnabled = process.env.REQUIRE_DUAL_CONTROL === 'true' && record.destructive;

  if (decision === 'deny') {
    markExecuted(id, 'DENIED', record.results || []);
    recordAudit({
      user: username,
      role,
      action: 'assistant_confirm',
      proposalId: id,
      sanitizedPreview: record.promptPreview,
      redactionsApplied: record.redactionsApplied,
      result: 'denied',
      request: auditRequest,
      response: { status: 'DENIED' }
    });
    await safeNotifyAssistant({
      proposalId: id,
      status: 'denied',
      actor: username,
      role,
      decision: 'deny',
      destructive: record.destructive
    });
    return res.json({
      ok: true,
      result: {
        status: 'DENIED'
      }
    });
  }

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
        sanitizedPreview: record.promptPreview,
        redactionsApplied: record.redactionsApplied,
        result: 'pending_second_approval',
        request: auditRequest,
        response: { status: 'PENDING_SECOND_APPROVAL' }
      });
      await safeNotifyAssistant({
        proposalId: id,
        status: 'pending_second_approval',
        actor: username,
        role,
        decision: 'approve',
        destructive: record.destructive
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
    const serializedProposal = JSON.stringify(record.proposal || {});
    let hydratedPayload;
    try {
      hydratedPayload = rehydrateFromLLM(serializedProposal, id);
    } catch (rehydrateError) {
      recordAudit({
        user: username,
        role,
        action: 'assistant_confirm',
        proposalId: id,
        sanitizedPreview: record.promptPreview,
        redactionsApplied: record.redactionsApplied,
        result: 'fail',
        message: rehydrateError.message
      });
      await safeNotifyAssistant({
        proposalId: id,
        status: 'failed',
        actor: username,
        role,
        decision,
        destructive: record.destructive,
        error: rehydrateError.message
      });
      return res.status(500).json({
        ok: false,
        code: 'REHYDRATION_FAILED',
        message: 'Failed to prepare proposal for execution.'
      });
    }
    let proposalForExecution;
    try {
      proposalForExecution = JSON.parse(hydratedPayload);
    } catch (_parseError) {
      proposalForExecution = record.proposal;
    }

    const stepsSummary = summarizeSteps(record.proposal?.steps);

    executionResults = await executeProposalSteps(proposalForExecution);
    markExecuted(id, 'COMPLETED', executionResults);
    recordAudit({
      user: username,
      role,
      action: 'assistant_confirm',
      proposalId: id,
      sanitizedPreview: record.promptPreview,
      redactionsApplied: record.redactionsApplied,
      executedBy: username,
      stepsRun: stepsSummary,
      result: 'success',
      request: auditRequest,
      response: { status: 'COMPLETED', results: executionResults }
    });
    await safeNotifyAssistant({
      proposalId: id,
      status: 'completed',
      actor: username,
      role,
      decision: 'approve',
      destructive: record.destructive
    });
    return res.json({ ok: true, results: executionResults });
  } catch (error) {
    if (error.message && error.message.includes('Unresolved placeholders')) {
      await safeNotifyAssistant({
        proposalId: id,
        status: 'failed',
        actor: username,
        role,
        decision: decision,
        destructive: record.destructive,
        error: error.message
      });
    }
    const stepsSummary = summarizeSteps(record.proposal?.steps);

    markExecuted(id, 'FAILED', executionResults);
    recordAudit({
      user: username,
      role,
      action: 'assistant_confirm',
      proposalId: id,
      sanitizedPreview: record.promptPreview,
      redactionsApplied: record.redactionsApplied,
      executedBy: username,
      stepsRun: stepsSummary,
      result: 'fail',
      message: error.message,
      request: auditRequest,
      response: { status: 'FAILED', results: executionResults }
    });
    await safeNotifyAssistant({
      proposalId: id,
      status: 'failed',
      actor: username,
      role,
      decision: 'approve',
      destructive: record.destructive,
      error: error.message
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
