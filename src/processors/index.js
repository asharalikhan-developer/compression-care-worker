import gmail from './gmail.processor.js';
import client from './client.processor.js';
import config from '../config/index.js';

const ALL = { gmail, client };

export function getEnabledProcessors() {
  const enabled = new Map();
  for (const source of config.processors) {
    const processor = ALL[source];
    if (!processor) {
      console.warn(`⚠️  Unknown processor in PROCESSORS env: "${source}" — skipping`);
      continue;
    }
    enabled.set(processor.source, processor);
  }
  if (enabled.size === 0) {
    throw new Error('No processors enabled. Set PROCESSORS env (e.g. PROCESSORS=gmail,client).');
  }
  return enabled;
}
