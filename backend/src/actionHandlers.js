import Joi from 'joi';

import { pvePost, getVmPool } from './proxmoxClient.js';
import { recordAudit } from './auditLog.js';
import { acquireLock, releaseLock, buildResourceKey } from './lockManager.js';
import { notifyVmAction } from '../services/notify.js';
import { hasPoolAccess } from './auth.js';

const actionSchema = Joi.object({
  node: Joi.string().trim().required(),
  vmid: Joi.number().integer().min(100).required()
});

const idempotencyCache = new Map();
export const destructiveActions = new Set(['stop', 'reboot']);

async function safeNotifyVm(payload) {
  try {
    await notifyVmAction(payload);
  } catch (error) {
    console.error('VM action notification failed:', error);
    recordAudit({
      user: 'system',
      role: 'system',
      action: 'notify_vm_action',
      result: 'fail',
      message: error.message,
      metadata: payload
    });
  }
}

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

    const sessionUser = req.session?.user;
    let pool = null;
    let poolAllowed = true;
    let poolReason = 'Pool access denied for VM action';
    try {
      pool = await getVmPool(node, vmid);
    } catch (poolError) {
      poolAllowed = false;
      poolReason = `Unable to resolve pool for VM ${vmid}: ${poolError.message}`;
      recordAudit({
        user: sessionUser?.username || 'unknown',
        role: sessionUser?.role || 'unknown',
        action: `proxmox_${action}`,
        node,
        vmid,
        pool: 'unknown',
        result: 'deny',
        reason: poolReason
      });
    }

    if (poolAllowed) {
      const context = {
        action: `proxmox_${action}`,
        node,
        vmid,
        pool: pool || 'unknown',
        reason: 'Pool access denied for VM action'
      };
      if (req.assertPoolAccess) {
        poolAllowed = req.assertPoolAccess(pool, context);
        if (!poolAllowed) {
          poolReason = context.reason;
        }
      } else if (req.hasPoolAccess) {
        poolAllowed = req.hasPoolAccess(pool);
        if (!poolAllowed) {
          poolReason = context.reason;
          recordAudit({
            user: sessionUser?.username || 'unknown',
            role: sessionUser?.role || 'unknown',
            action: context.action,
            node,
            vmid,
            pool: context.pool,
            result: 'deny',
            reason: context.reason
          });
        }
      } else if (!hasPoolAccess(sessionUser, pool)) {
        poolAllowed = false;
        poolReason = context.reason;
        recordAudit({
          user: sessionUser?.username || 'unknown',
          role: sessionUser?.role || 'unknown',
          action: context.action,
          node,
          vmid,
          pool: context.pool,
          result: 'deny',
          reason: context.reason
        });
      }
    }

    if (!poolAllowed) {
      return res.status(403).json({
        ok: false,
        code: 'POOL_FORBIDDEN',
        message: poolReason
      });
    }

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
        result: 'pending_approval',
        request: { action, node, vmid }
      };
      recordAudit(auditEntry);
      await safeNotifyVm({
        action,
        node,
        vmid,
        status: 'pending_approval',
        requestedBy: auditBase.user,
        role: auditBase.role,
        details: 'Dual control required'
      });
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
        result: 'success',
        request: { action, node, vmid },
        response
      };
      recordAudit(auditEntry);
      await safeNotifyVm({
        action,
        node,
        vmid,
        status: 'success',
        requestedBy: auditBase.user,
        role: auditBase.role
      });
      idempotencyCache.set(idempotencyKey, auditEntry);
      return res.json({ ok: true, result: response });
    } catch (err) {
      const safeMessage = err?.message || 'Proxmox action failed';
      const status = Number(err?.status) || 502;
      const auditEntry = {
        ...auditBase,
        result: 'fail',
        request: { action, node, vmid },
        response: err?.payload || null,
        message: safeMessage
      };
      recordAudit(auditEntry);
      await safeNotifyVm({
        action,
        node,
        vmid,
        status: 'fail',
        requestedBy: auditBase.user,
        role: auditBase.role,
        details: safeMessage
      });
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
