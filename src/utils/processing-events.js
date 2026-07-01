/**
 * Global event bus. The worker/services emit processing events here; the live
 * demo server subscribes and streams them to the browser via SSE.
 *
 * Event shape: { type, documentId, ...payload }
 *   type: 'job:start' | 'log' | 'cost' | 'result' | 'job:done' | 'job:error'
 */
import { EventEmitter } from 'events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

export default bus;
