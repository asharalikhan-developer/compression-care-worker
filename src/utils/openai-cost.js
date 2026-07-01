import { emitProcessingEvent } from './processing-logger.js';

// Prices in $ per 1M tokens. Update as OpenAI pricing changes.
// Source: https://openai.com/api/pricing
const PRICING = {
  'gpt-5.5': { input: 5,  output: 30.00 },
  'gpt-5-2025-08-07': { input: 1.25,  output: 10.00 },
  'gpt-5.4-2026-03-05':{input: 2.5, output: 15.00},
  'gpt-5.2-2025-12-11': { input: 1.75, output: 14.00 },
  'gpt-5.1-2025-11-13': { input: 1.25, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};

function pickTokens(usage = {}) {
  const inTokens =
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.inputTokens ??
    0;
  const outTokens =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.outputTokens ??
    0;
  const totalTokens = usage.total_tokens ?? usage.totalTokens ?? inTokens + outTokens;
  return { inTokens, outTokens, totalTokens };
}

export function calculateCost(model, usage) {
  if (!usage) return null;
  const { inTokens, outTokens, totalTokens } = pickTokens(usage);
  const price = PRICING[model];
  if (!price) {
    return { model, inTokens, outTokens, totalTokens, cost: null, unknownPricing: true };
  }
  const cost = (inTokens * price.input) / 1_000_000 + (outTokens * price.output) / 1_000_000;
  return { model, inTokens, outTokens, totalTokens, cost };
}

export function logCost(label, model, usage) {
  const info = calculateCost(model, usage);
  if (!info) {
    console.log(`  💵 ${label} [${model}] — no usage info returned`);
    return null;
  }
  const tokenLine = `tokens: ${info.totalTokens} (in ${info.inTokens} / out ${info.outTokens})`;
  if (info.unknownPricing) {
    console.log(`  💵 ${label} [${model}] — ${tokenLine} — cost: unknown pricing (add ${model} to PRICING)`);
  } else {
    console.log(`  💵 ${label} [${model}] — ${tokenLine} — cost: $${info.cost.toFixed(5)}`);
  }
  // Surface a structured cost event to the live demo dashboard (no-op outside a job).
  emitProcessingEvent('cost', { label, ...info });
  return info;
}

export default { calculateCost, logCost };
