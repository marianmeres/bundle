/**
 * Example module: TypeScript bundled for browser use.
 * @module
 */

export { debounce, EventEmitter, randomId } from "./utils.ts";

/** Library version */
export const VERSION = "1.0.0";

/** Greet function for demo purposes */
export function greet(name: string): string {
	return `Hello, ${name}!`;
}
