import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import Roles from './authRoles.js';
import { recordAudit } from './auditLog.js';

const roleOrder = [Roles.VIEWER, Roles.OPERATOR, Roles.ADMIN];
const DEFAULT_ALLOWED_POOLS = ['*'];

// In-memory user store; replace with persistent storage in production.
const users = [];
let userCounter = 0;

const PASSWORD_COMPLEXITY_REGEXES = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /[0-9]/,
  symbol: /[^A-Za-z0-9]/
};

function validatePasswordComplexity(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return false;
  }
  return (
    PASSWORD_COMPLEXITY_REGEXES.uppercase.test(password) &&
    PASSWORD_COMPLEXITY_REGEXES.lowercase.test(password) &&
    PASSWORD_COMPLEXITY_REGEXES.number.test(password) &&
    PASSWORD_COMPLEXITY_REGEXES.symbol.test(password)
  );
}

function generateComplexPassword(length = 16) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  const categories = [upper, lower, digits, symbols];
  const all = upper + lower + digits + symbols;

  if (length < categories.length) {
    throw new Error('Password length too short for complexity requirements');
  }

  const chars = [];
  for (const category of categories) {
    chars.push(category[crypto.randomInt(category.length)]);
  }

  for (let i = chars.length; i < length; i += 1) {
    chars.push(all[crypto.randomInt(all.length)]);
  }

  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function normalizePools(pools) {
  if (!Array.isArray(pools)) return [];
  const normalized = pools
    .map((pool) => String(pool || '').trim().toLowerCase())
    .filter((pool) => pool.length > 0 && pool !== 'all');
  return Array.from(new Set(normalized));
}

function getAllowedPools(user) {
  if (!user) return [];
  const raw = normalizePools(user.allowedPools);
  if (raw.length > 0) return raw;
  const role = String(user.role || '').toLowerCase();
  if (role === Roles.ADMIN) {
    return ['*'];
  }
  return normalizePools(DEFAULT_ALLOWED_POOLS);
}

function hasPoolAccess(user, pool) {
  const pools = getAllowedPools(user);
  if (pools.includes('*')) return true;
  if (!pool) return false;
  return pools.includes(String(pool).toLowerCase());
}

function findUserByUsername(username) {
  if (!username) return null;
  return users.find((user) => user.username === username);
}

function normalizeRole(role) {
  const lowered = (role || Roles.VIEWER).toLowerCase();
  return roleOrder.includes(lowered) ? lowered : Roles.VIEWER;
}

function nextUserId() {
  userCounter += 1;
  return `user-${userCounter}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    allowedPools: getAllowedPools(user)
  };
}

function generateTemporaryPassword() {
  return generateComplexPassword(16);
}

function resolveAllowedPools(role, pools) {
  const normalized = normalizePools(pools);
  if (normalized.length > 0) {
    return normalized;
  }
  const lowered = String(role || '').toLowerCase();
  if (lowered === Roles.ADMIN) {
    return ['*'];
  }
  return normalizePools(DEFAULT_ALLOWED_POOLS);
}

function addUserRecord({ username, passwordHash, role, mustChangePassword = true, active = true, allowedPools }) {
  const record = {
    id: nextUserId(),
    username,
    passwordHash,
    role: normalizeRole(role),
    mustChangePassword,
    active,
    allowedPools: resolveAllowedPools(role, allowedPools),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  users.push(record);
  return record;
}

function bootstrapAdminIfEmpty() {
  if (users.length > 0) return;

  const temporaryPassword = generateComplexPassword(16);
  const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
  addUserRecord({
    username: 'admin',
    passwordHash,
    role: Roles.ADMIN,
    mustChangePassword: true,
    allowedPools: ['*']
  });

  console.warn('Bootstrap admin created. Change password immediately.');
  console.warn(`Username: admin`);
  console.warn(`Temporary password: ${temporaryPassword}`);

  recordAudit({
    user: 'system',
    role: 'system',
    action: 'bootstrap_admin_created',
    username: 'admin',
    result: 'success'
  });
}

bootstrapAdminIfEmpty();

export async function createUser(username, password, role = Roles.VIEWER, options = {}) {
  if (!username || !password) {
    throw new Error('username and password are required');
  }

  if (!validatePasswordComplexity(password)) {
    const error = new Error('Password does not meet complexity requirements');
    error.code = 'PASSWORD_COMPLEXITY';
    throw error;
  }

  const existing = users.find((user) => user.username === username);
  if (existing && existing.active !== false) {
    throw new Error('username already exists');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  if (existing && existing.active === false) {
    // Reactivate soft-deleted account with new credentials.
    existing.passwordHash = passwordHash;
    existing.role = normalizeRole(role);
    existing.mustChangePassword = options.mustChangePassword ?? true;
    existing.active = true;
    existing.allowedPools = resolveAllowedPools(role, options.allowedPools ?? existing.allowedPools);
    existing.updatedAt = Date.now();
    return sanitizeUser(existing);
  }

  const mustChangePassword = options.mustChangePassword ?? true;
  const record = addUserRecord({
    username,
    passwordHash,
    role,
    mustChangePassword,
    active: true,
    allowedPools: options.allowedPools
  });
  return sanitizeUser(record);
}

export function listUsers({ includeInactive = true } = {}) {
  return users
    .filter((user) => includeInactive || user.active !== false)
    .map((user) => sanitizeUser(user));
}

export function findUserById(id) {
  return users.find((user) => user.id === id);
}

export async function adminUpdateUser(id, { role, forcePasswordReset, allowedPools }) {
  const user = findUserById(id);
  if (!user) return null;

  if (role) {
    user.role = normalizeRole(role);
  }

  if (allowedPools !== undefined) {
    user.allowedPools = resolveAllowedPools(role || user.role, allowedPools);
  }

  let temporaryPassword;
  if (forcePasswordReset !== undefined) {
    if (forcePasswordReset) {
      temporaryPassword = generateTemporaryPassword();
      user.passwordHash = await bcrypt.hash(temporaryPassword, 12);
      user.mustChangePassword = true;
    } else {
      user.mustChangePassword = false;
    }
  }

  user.updatedAt = Date.now();
  return { user: sanitizeUser(user), temporaryPassword };
}

export function deactivateUser(id) {
  const user = findUserById(id);
  if (!user) return null;
  user.active = false;
  user.updatedAt = Date.now();
  return sanitizeUser(user);
}

export async function authenticate(username, password) {
  if (!username || !password) return null;

  const user = users.find((candidate) => candidate.username === username && candidate.active !== false);
  if (!user) return null;

  const matches = await bcrypt.compare(password, user.passwordHash);
  return matches ? sanitizeUser(user) : null;
}

export async function changePassword(username, oldPassword, newPassword) {
  const user = findUserByUsername(username);
  if (!user || user.active === false) {
    const error = new Error('User not found');
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const matches = await bcrypt.compare(oldPassword || '', user.passwordHash);
  if (!matches) {
    const error = new Error('Incorrect current password');
    error.code = 'INVALID_OLD_PASSWORD';
    throw error;
  }

  if (!validatePasswordComplexity(newPassword || '')) {
    const error = new Error('Password does not meet complexity requirements');
    error.code = 'PASSWORD_COMPLEXITY';
    throw error;
  }

  const isSame = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSame) {
    const error = new Error('New password must be different from current password');
    error.code = 'PASSWORD_REUSE';
    throw error;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  user.updatedAt = Date.now();

  recordAudit({
    user: user.username,
    role: user.role,
    action: 'change_password',
    result: 'success'
  });

  return sanitizeUser(user);
}

export function requireAuth(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Login required'
    });
  }

  return next();
}

export function requireRole(minRole) {
  return (req, res, next) => {
    const sessionUser = req.session?.user;
    if (!sessionUser) {
      return res.status(401).json({
        ok: false,
        code: 'UNAUTHENTICATED',
        message: 'Login required'
      });
    }

    const userRole = normalizeRole(sessionUser.role);
    const userIndex = roleOrder.indexOf(userRole);
    const minIndex = roleOrder.indexOf(normalizeRole(minRole));

    if (userIndex === -1 || minIndex === -1 || userIndex < minIndex) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Insufficient role'
      });
    }

    const allowedPools = getAllowedPools(sessionUser);
    req.allowedPools = allowedPools;
    req.hasPoolAccess = (pool) => hasPoolAccess(sessionUser, pool);
    req.assertPoolAccess = (pool, context = {}) => {
      if (hasPoolAccess(sessionUser, pool)) {
        return true;
      }
      const reason = context.reason || (pool ? `Pool ${pool} not permitted` : 'Resource pool unavailable');
      recordAudit({
        user: sessionUser?.username || 'unknown',
        role: sessionUser?.role || 'unknown',
        action: context.action || 'pool_access_denied',
        node: context.node,
        vmid: context.vmid,
        pool: pool || 'unknown',
        result: 'deny',
        reason
      });
      return false;
    };

    return next();
  };
}

export { users };
export { sanitizeUser };
export { getAllowedPools, hasPoolAccess };
