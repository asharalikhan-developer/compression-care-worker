/**
 * Extraction-engine registry.
 *
 * Lets the running worker switch which client-PDF extraction engine handles
 * incoming jobs — driven by the live demo's dropdown — without editing code or
 * restarting. Both engines expose the same `extractPatientFromPdfUrls(urls)`.
 *
 * Default can be set via EXTRACTION_ENGINE env var ('gpt-5.5' | 'mistral').
 */
import openaiClientService from './openai-client.service.js'; // gpt-5.5: digital→text+form images, fax→file input
import openaiClientService2 from './openai-client.service2.js'; // Mistral OCR → GPT-4o-mini

const ENGINES = {
  'gpt-5.5': { label: 'gpt-5.5 — digital: text + form images · fax: file input', service: openaiClientService },
  mistral: { label: 'Mistral OCR → GPT-4o-mini', service: openaiClientService2 },
};

let current = ENGINES[process.env.EXTRACTION_ENGINE] ? process.env.EXTRACTION_ENGINE : 'gpt-5.5';

export function listEngines() {
  return Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label }));
}

export function getEngineName() {
  return current;
}

export function getEngineLabel() {
  return ENGINES[current].label;
}

export function getEngine() {
  return ENGINES[current].service;
}

/** Switch the active engine. Returns false if the id is unknown. */
export function setEngine(id) {
  if (!ENGINES[id]) return false;
  current = id;
  return true;
}

// File-input model selection lives in runtime-settings (no circular imports);
// re-exported here so the demo server has a single import surface.
export {
  listFileInputModels,
  getFileInputModel,
  setFileInputModel,
} from './runtime-settings.js';

export default { listEngines, getEngineName, getEngineLabel, getEngine, setEngine };
