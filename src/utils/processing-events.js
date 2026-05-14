/**
 * Global event bus. Services emit processing events here;
 * the live server subscribes and streams them to the browser via SSE.
 *
 * Event shape: { type, documentId, ...payload }
 */
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.setMaxListeners(50);
export default bus;
