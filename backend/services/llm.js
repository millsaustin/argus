import Ajv from 'ajv';
import { createRequire } from 'module';

import { recordAudit } from '../src/auditLog.js';
import { sanitizeForLLM } from './sanitize.js';

const require = createRequire(import.meta.url);
const schema = require('../schemas/proposal.schema.json');

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('date-time', (value) => {
  if (typeof value !== 'string' || !value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
});
const validate = ajv.compile(schema);

export async function generateProposal(prompt, context, { proposalId } = {}) {
  if (!proposalId) {
    throw new Error('proposalId is required for proposal generation');
  }

  let promptResult;
  let contextResult;
  try {
    promptResult = sanitizeForLLM(prompt, proposalId);
    const contextJson = JSON.stringify(context || {});
    contextResult = sanitizeForLLM(contextJson, proposalId);
  } catch (error) {
    throw new Error(`Prompt sanitization failed: ${error.message}`);
  }

  const sanitizedPrompt = promptResult.text;
  const sanitizedContext = contextResult.text;
  const totalRedactions = (promptResult.redactionsApplied || 0) + (contextResult.redactionsApplied || 0);
  const sanitizedPromptPreview = promptResult.sanitizedPreview;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured');
    error.sanitizedPrompt = sanitizedPrompt;
    error.sanitizedContext = sanitizedContext;
    error.redactionsApplied = totalRedactions;
    error.sanitizedPromptPreview = sanitizedPromptPreview;
    throw error;
  }

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
        content: `Context: ${sanitizedContext}\nPrompt: ${sanitizedPrompt}`
      }
    ]
  };

  try {
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
      const error = new Error(`OpenAI request failed: ${response.status} ${errorText}`);
      error.sanitizedPrompt = sanitizedPrompt;
      error.sanitizedContext = sanitizedContext;
      throw error;
    }

    const payload = await response.json();
    const usage = payload?.usage || null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      const error = new Error('OpenAI response missing content');
      error.sanitizedPrompt = sanitizedPrompt;
      error.sanitizedContext = sanitizedContext;
      error.redactionsApplied = totalRedactions;
      error.sanitizedPromptPreview = sanitizedPromptPreview;
      throw error;
    }

    let proposal;
    try {
      proposal = JSON.parse(content);
    } catch (_parseError) {
      const error = new Error('OpenAI response was not valid JSON');
      error.sanitizedPrompt = sanitizedPrompt;
      error.sanitizedContext = sanitizedContext;
      throw error;
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
      const error = new Error('Generated proposal failed schema validation');
      error.sanitizedPrompt = sanitizedPrompt;
      error.sanitizedContext = sanitizedContext;
      error.redactionsApplied = totalRedactions;
      error.sanitizedPromptPreview = sanitizedPromptPreview;
      throw error;
    }

    return {
      proposal,
      sanitizedPrompt,
      sanitizedContext,
      redactionsApplied: totalRedactions,
      sanitizedPromptPreview,
      usage
    };
  } catch (error) {
    if (!error.sanitizedPrompt) {
      error.sanitizedPrompt = sanitizedPrompt;
    }
    if (!error.sanitizedContext) {
      error.sanitizedContext = sanitizedContext;
    }
    if (error.redactionsApplied == null) {
      error.redactionsApplied = totalRedactions;
    }
    if (!error.sanitizedPromptPreview) {
      error.sanitizedPromptPreview = sanitizedPromptPreview;
    }
    throw error;
  }
}
