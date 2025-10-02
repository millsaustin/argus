import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';

import { recordAudit } from '../src/auditLog.js';
import { listUsers } from '../src/auth.js';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM = process.env.SENDGRID_FROM || process.env.NOTIFY_FROM || 'no-reply@argus.local';
const SMTP_URL = process.env.SMTP_URL;
const SMTP_FROM = process.env.SMTP_FROM || process.env.NOTIFY_FROM || SENDGRID_FROM;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

let sendgridEnabled = false;
if (SENDGRID_API_KEY) {
  try {
    sgMail.setApiKey(SENDGRID_API_KEY);
    sendgridEnabled = true;
  } catch (error) {
    console.error('Failed to initialise SendGrid client:', error.message);
  }
}

let smtpTransport = null;
if (SMTP_URL) {
  try {
    smtpTransport = nodemailer.createTransport(SMTP_URL);
  } catch (error) {
    console.error('Failed to initialise SMTP transport:', error.message);
    smtpTransport = null;
  }
}

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      output[key] = sanitizeValue(inner);
    }
    return output;
  }

  return value;
}

function formatDetail(value) {
  const sanitized = sanitizeValue(value);
  if (typeof sanitized === 'string') {
    return sanitized;
  }
  try {
    return JSON.stringify(sanitized);
  } catch (_err) {
    return String(sanitized);
  }
}

function resolveRecipientsByRole(roles = []) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return [];
  }
  try {
    const normalizedRoles = roles.map((role) => String(role || '').toLowerCase());
    const users = listUsers({ includeInactive: false });
    return users
      .filter((user) => normalizedRoles.includes(String(user.role || '').toLowerCase()))
      .map((user) => user.username);
  } catch (_err) {
    return [];
  }
}

function auditNotification({ type, provider, status, target, subject, channel, message, metadata, error }) {
  const payload = {
    user: 'system',
    role: 'system',
    action: type,
    provider,
    status,
    result: status,
    metadata: sanitizeValue(metadata)
  };

  if (target) payload.target = sanitizeValue(target);
  if (subject) payload.subject = sanitizeValue(subject);
  if (channel) payload.channel = sanitizeValue(channel);
  if (message) payload.message = sanitizeValue(message);
  if (error) payload.error = sanitizeValue(error);

  recordAudit(payload);
}

function logConsoleEmail(target, subject, bodyText) {
  console.log(`[notify] Email (console) to ${target.join(', ') || 'unknown'}: ${subject}`);
  console.log(bodyText);
}

function logConsoleSlack(channel, text) {
  console.log(`[notify] Slack (console) to ${channel}: ${text}`);
}

export async function sendEmail(to, subject, body, metadata = {}) {
  const recipients = Array.isArray(to) ? to : [to];
  const target = recipients.filter(Boolean);
  const resolvedTarget = target.length > 0 ? target : ['admins@argus.local'];
  const sanitizedSubject = formatDetail(subject ?? 'Argus notification');
  const bodyText = formatDetail(body ?? '');
  const sanitizedMetadata = sanitizeValue(metadata);

  const attemptSend = async (provider, sendFn) => {
    try {
      await sendFn();
      auditNotification({ type: 'notify_email', provider, status: 'sent', target: resolvedTarget, subject: sanitizedSubject, metadata: sanitizedMetadata });
      return { ok: true, provider };
    } catch (error) {
      auditNotification({ type: 'notify_email', provider, status: 'failed', target: resolvedTarget, subject: sanitizedSubject, metadata: sanitizedMetadata, error: error.message });
      console.error(`[notify] Email via ${provider} failed:`, error.message);
      throw error;
    }
  };

  if (sendgridEnabled) {
    try {
      return await attemptSend('sendgrid', () =>
        sgMail.send({
          to: resolvedTarget,
          from: SENDGRID_FROM,
          subject: sanitizedSubject,
          text: bodyText
        })
      );
    } catch (error) {
      // fall back to other providers
    }
  }

  if (smtpTransport) {
    try {
      return await attemptSend('smtp', () =>
        smtpTransport.sendMail({
          to: resolvedTarget,
          from: SMTP_FROM,
          subject: sanitizedSubject,
          text: bodyText
        })
      );
    } catch (error) {
      // fall back to console
    }
  }

  logConsoleEmail(resolvedTarget, sanitizedSubject, bodyText);
  auditNotification({ type: 'notify_email', provider: 'console', status: 'sent', target: resolvedTarget, subject: sanitizedSubject, metadata: sanitizedMetadata });
  return { ok: true, provider: 'console' };
}

export async function sendSlack(channel, text, metadata = {}) {
  const sanitizedChannel = channel || '#alerts';
  const sanitizedText = formatDetail(text ?? '');
  const sanitizedMetadata = sanitizeValue(metadata);

  const attemptSlack = async () => {
    if (!SLACK_WEBHOOK_URL) {
      throw new Error('Slack webhook not configured');
    }

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sanitizedText })
    });

    if (!response.ok) {
      throw new Error(`Slack webhook responded with ${response.status}`);
    }
  };

  try {
    await attemptSlack();
    auditNotification({ type: 'notify_slack', provider: 'slack', status: 'sent', channel: sanitizedChannel, message: sanitizedText, metadata: sanitizedMetadata });
    return { ok: true, provider: 'slack' };
  } catch (error) {
    auditNotification({ type: 'notify_slack', provider: 'slack', status: 'failed', channel: sanitizedChannel, message: sanitizedText, metadata: sanitizedMetadata, error: error.message });
    logConsoleSlack(sanitizedChannel, sanitizedText);
    auditNotification({ type: 'notify_slack', provider: 'console', status: 'sent', channel: sanitizedChannel, message: sanitizedText, metadata: sanitizedMetadata });
    return { ok: true, provider: 'console' };
  }
}

export async function notifyVmAction({
  action,
  node,
  vmid,
  status,
  requestedBy,
  role,
  details
}) {
  const normalizedAction = String(action || 'action').toLowerCase();
  const normalizedStatus = String(status || 'pending').toLowerCase();
  const actor = requestedBy || 'unknown';
  const actorRole = role || 'unknown';
  const baseText = `VM ${vmid} on ${node}: ${normalizedAction} ${normalizedStatus} by ${actor} (${actorRole}).`;
  const metadata = sanitizeValue({ action: normalizedAction, node, vmid, status: normalizedStatus, requestedBy: actor });

  await sendSlack('#ops', baseText, metadata);
  const recipients = resolveRecipientsByRole(['admin', 'operator']);
  const subject = `Argus ${normalizedAction} ${normalizedStatus}: VM ${vmid}`;
  const emailBody = `${baseText}${details ? ` Details: ${formatDetail(details)}` : ''}`;
  if (recipients.length > 0) {
    await sendEmail(recipients, subject, emailBody, metadata);
  } else {
    await sendEmail(['admins@argus.local'], subject, emailBody, metadata);
  }
}

export async function notifyAssistantDecision({
  proposalId,
  status,
  actor,
  role,
  decision,
  destructive,
  error
}) {
  const normalizedStatus = String(status || 'unknown').toLowerCase();
  const normalizedDecision = String(decision || 'approve').toLowerCase();
  const actorName = actor || 'unknown';
  const actorRole = role || 'unknown';
  const flag = destructive ? ' (destructive)' : '';
  const baseText = `Proposal ${proposalId}${flag} ${normalizedStatus} via ${normalizedDecision} by ${actorName} (${actorRole}).`;
  const metadata = sanitizeValue({ proposalId, status: normalizedStatus, decision: normalizedDecision, actor: actorName, destructive: Boolean(destructive) });
  if (error) {
    metadata.error = sanitizeValue(error);
  }

  await sendSlack('#ops', baseText, metadata);
  const recipients = resolveRecipientsByRole(['admin']);
  const subject = `Argus proposal ${normalizedStatus}: ${proposalId}`;
  const body = error ? `${baseText} Error: ${formatDetail(error)}` : baseText;
  if (recipients.length > 0) {
    await sendEmail(recipients, subject, body, metadata);
  } else {
    await sendEmail(['admins@argus.local'], subject, body, metadata);
  }
}
