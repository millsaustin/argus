import Ajv from 'ajv';
import { createRequire } from 'module';

import { recordAudit } from '../src/auditLog.js';

const require = createRequire(import.meta.url);
const schema = require('../schemas/proposal.schema.json');

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function redact(input) {
  if (!input) return input;
  return input
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
}

export async function generateProposal(prompt, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const redactedPrompt = redact(prompt);
  const redactedContext = redact(JSON.stringify(context || {}));

  const requestBody = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are Argus assistant. Return a JSON object that matches the provided schema. Do not include prose.'
      },
      {
        role: 'user',
        content: `Context: ${redactedContext}\nPrompt: ${redactedPrompt}`
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response missing content');
  }

  let proposal;
  try {
    proposal = JSON.parse(content);
  } catch (error) {
    throw new Error('OpenAI response was not valid JSON');
  }

  const isValid = validate(proposal);
  if (!isValid) {
    recordAudit({
      user: 'system',
      role: 'system',
      action: 'proposal_validation_failed',
      details: validate.errors,
      ts: Date.now(),
      result: 'fail'
    });
    throw new Error('Generated proposal failed schema validation');
  }

  return proposal;
}
