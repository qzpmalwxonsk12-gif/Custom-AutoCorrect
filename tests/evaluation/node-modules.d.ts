/**
 * Minimal Node declarations for the development-only evaluator.
 *
 * The project deliberately does not depend on `@types/node`: everything that
 * ships runs in a browser, and `tsconfig` sets `types: ["chrome"]` so a stray
 * Node API in extension code is a compile error rather than a runtime surprise.
 *
 * The evaluator reads a corpus from disk, so it needs three functions. Declaring
 * exactly those keeps that property intact - anything else from Node is still
 * unavailable, here and everywhere else.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string;
  export function join(...segments: string[]): string;
}
