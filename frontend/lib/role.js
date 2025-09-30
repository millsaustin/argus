const currentRole = (process.env.NEXT_PUBLIC_ARGUS_ROLE || 'viewer').toLowerCase();

function canOperate() {
  return currentRole === 'operator' || currentRole === 'admin';
}

function isAdmin() {
  return currentRole === 'admin';
}

export { currentRole, canOperate, isAdmin };
