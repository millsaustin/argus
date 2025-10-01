import Joi from 'joi';

import { pvePost } from './proxmoxClient.js';
import { recordAudit } from './auditLog.js';
import { acquireLock, releaseLock, buildResourceKey } from './lockManager.js';

const actionSchema = Joi.object({
  node: Joi.string().trim().required(),
  vmid: Joi.number().integer().min(100).required()
});

const idempotencyCache = new Map();
export const destructiveActions = new Set(['stop', 'reboot']);

export function createActionHandler(action) {
  return async function handleAction(req, res) {
    const { error, value } = actionSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: error.details.map((detail) => detail.message).join(', ')
      });
    }

    const idempotencyKey = req.get('x-idempotency-key');
    if (!idempotencyKey) {
      return res.status(400).json({
        ok: false,
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Header "x-idempotency-key" is required'
      });
    }

    if (idempotencyCache.has(idempotencyKey)) {
      return res.status(409).json({
        ok: false,
        code: 'DUPLICATE_REQUEST',
        message: 'Duplicate idempotency key detected'
      });
    }

    const { node, vmid } = value;
    const lockKey = buildResourceKey(node, vmid);

    if (!acquireLock(lockKey)) {
      return res.status(423).json({
        ok: false,
        code: 'RESOURCE_LOCKED',
        message: 'Another action is already in progress for this VM'
      });
    }

    const auditBase = {
      user: req.session?.user?.username || 'unknown',
      role: req.session?.user?.role || 'unknown',
      action,
      node,
      vmid
    };

    const dualControlRequired = process.env.REQUIRE_DUAL_CONTROL === 'true' && destructiveActions.has(action);
    if (dualControlRequired) {
      releaseLock(lockKey);
      const auditEntry = {
        ...auditBase,
        result: 'pending_approval'
      };
      recordAudit(auditEntry);
      idempotencyCache.set(idempotencyKey, auditEntry);
      return res.json({
        ok: true,
        result: {
          status: 'PENDING_APPROVAL'
        }
      });
    }

    try {
      const response = await performVmAction(action, node, vmid);
      const auditEntry = {
        ...auditBase,
        result: 'success'
      };
      recordAudit(auditEntry);
      idempotencyCache.set(idempotencyKey, auditEntry);
      return res.json({ ok: true, result: response });
    } catch (err) {
      const safeMessage = err?.message || 'Proxmox action failed';
      const status = Number(err?.status) || 502;
      const auditEntry = {
        ...auditBase,
        result: 'fail'
      };
      recordAudit(auditEntry);
      idempotencyCache.set(idempotencyKey, auditEntry);
      return res.status(status).json({
        ok: false,
        code: 'PROXMOX_ACTION_FAILED',
        message: safeMessage
      });
    } finally {
      releaseLock(lockKey);
    }
  };
}

export async function performVmAction(action, node, vmid) {
  const proxmoxPath = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/status/${encodeURIComponent(action)}`;
  return pvePost(proxmoxPath);
}
