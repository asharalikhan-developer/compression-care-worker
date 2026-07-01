/**
 * Runtime-tunable settings the live demo can change without a restart.
 * Kept dependency-light (only config) so any service can import it without
 * creating circular imports.
 */
import config from '../config/index.js';

// Model used by the file-input engine (Responses API). Keep in sync with the
// PRICING table in utils/openai-cost.js so cost is computed.
const FILE_INPUT_MODELS = ['gpt-5.5', 'gpt-5.4-2026-03-05', 'gpt-5.2-2025-12-11', 'gpt-5.1-2025-11-13', 'gpt-5-2025-08-07'];

let currentModel =
  FILE_INPUT_MODELS.includes(process.env.FILE_INPUT_MODEL)
    ? process.env.FILE_INPUT_MODEL
    : (FILE_INPUT_MODELS.includes(config.openai.gpt5model) ? config.openai.gpt5model : FILE_INPUT_MODELS[0]);

export function listFileInputModels() {
  return [...FILE_INPUT_MODELS];
}

export function getFileInputModel() {
  return currentModel;
}

/** Switch the file-input model. Returns false if the id is unknown. */
export function setFileInputModel(id) {
  if (!FILE_INPUT_MODELS.includes(id)) return false;
  currentModel = id;
  return true;
}

export default { listFileInputModels, getFileInputModel, setFileInputModel };
