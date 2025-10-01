import { randomUUID } from 'crypto';

const proposals = new Map();

export function createProposal({ proposal, createdBy, destructive }) {
  const id = proposal.id || randomUUID();
  const record = {
    id,
    proposal: { ...proposal, id },
    createdAt: Date.now(),
    status: 'PENDING',
    createdBy,
    approvals: new Set(),
    destructive: Boolean(destructive),
    results: []
  };
  proposals.set(id, record);
  return record;
}

export function getProposal(id) {
  return proposals.get(id) || null;
}

export function saveApproval(id, username) {
  const record = proposals.get(id);
  if (!record) return null;
  const approvals = new Set(record.approvals);
  approvals.add(username);
  record.approvals = approvals;
  proposals.set(id, record);
  return record;
}

export function markExecuted(id, status, results = []) {
  const record = proposals.get(id);
  if (!record) return null;
  record.status = status;
  record.results = results;
  proposals.set(id, record);
  return record;
}

export function listProposals() {
  return Array.from(proposals.values());
}
