import "server-only";
// Re-export from the new centralized ai-router
export { callProvider as ask, costOf, geminiSchema } from "./ai-router";
export class AiError extends Error {}
