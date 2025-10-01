const locks = new Map();

export function acquireLock(key) {
  if (locks.has(key)) return false;
  locks.set(key, true);
  return true;
}

export function releaseLock(key) {
  locks.delete(key);
}

export function withLock(key, fn) {
  if (!acquireLock(key)) {
    throw new Error('LOCKED');
  }
  try {
    return fn();
  } finally {
    releaseLock(key);
  }
}

export function buildResourceKey(node, vmid) {
  return `${node}:${vmid}`;
}

export function isLocked(key) {
  return locks.has(key);
}
