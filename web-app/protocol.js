/**
 * Back-compat shim. Prefer: import { ... } from './protocol/index.js'
 * (Kept so any old single-file import still resolves to the package.)
 */
export * from './protocol/index.js';
