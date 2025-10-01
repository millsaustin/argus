import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import Roles from './authRoles.js';

const roleOrder = [Roles.VIEWER, Roles.OPERATOR, Roles.ADMIN];

// In-memory user store; replace with persistent storage in production.
const users = [];

function normalizeRole(role) {
  const lowered = (role || Roles.VIEWER).toLowerCase();
  return roleOrder.includes(lowered) ? lowered : Roles.VIEWER;
}

function sanitizeUser(user) {
  if (!user) return null;
  return { username: user.username, role: user.role };
}

function bootstrapAdminIfEmpty() {
  if (users.length > 0) return;

  const temporaryPassword = crypto.randomBytes(12).toString('hex');
  const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
  const adminUser = {
    username: 'admin',
    passwordHash,
    role: Roles.ADMIN
  };
  users.push(adminUser);
  console.warn('Admin bootstrap created, force password change required. Temporary password:', temporaryPassword);
}

bootstrapAdminIfEmpty();

export async function createUser(username, password, role = Roles.VIEWER) {
  if (!username || !password) {
    throw new Error('username and password are required');
  }

  const existing = users.find((user) => user.username === username);
  if (existing) {
    throw new Error('username already exists');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedRole = normalizeRole(role);
  const user = { username, passwordHash, role: normalizedRole };
  users.push(user);
  return sanitizeUser(user);
}

export async function authenticate(username, password) {
  if (!username || !password) return null;

  const user = users.find((candidate) => candidate.username === username);
  if (!user) return null;

  const matches = await bcrypt.compare(password, user.passwordHash);
  return matches ? sanitizeUser(user) : null;
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

    return next();
  };
}

export { users };
