import bcrypt from 'bcryptjs';

import Roles from './authRoles.js';

const roleOrder = [Roles.VIEWER, Roles.OPERATOR, Roles.ADMIN];

// In-memory user store; replace with persistent storage in production.
const users = [];

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'changeme',
  role: Roles.ADMIN
};

function ensureDefaultAdmin() {
  const hasUsers = users.length > 0;
  const alreadyExists = users.some((user) => user.username === DEFAULT_ADMIN.username);

  if (!hasUsers && !alreadyExists) {
    const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN.password, 12);
    users.push({
      username: DEFAULT_ADMIN.username,
      passwordHash,
      role: normalizeRole(DEFAULT_ADMIN.role)
    });
    console.warn('Default admin credentials created (admin / changeme). Update immediately.');
  }
}

ensureDefaultAdmin();

function normalizeRole(role) {
  const lowered = (role || Roles.VIEWER).toLowerCase();
  return roleOrder.includes(lowered) ? lowered : Roles.VIEWER;
}

function sanitizeUser(user) {
  if (!user) return null;
  return { username: user.username, role: user.role };
}

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
