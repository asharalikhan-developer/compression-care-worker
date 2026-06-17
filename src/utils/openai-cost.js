// Prices in $ per 1M tokens. Update as OpenAI pricing changes.
// Source: https://openai.com/api/pricing
const PRICING = {
  'gpt-5.5': { input: 5,  output: 30.00 },
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
  return info;
}

export default { calculateCost, logCost };
