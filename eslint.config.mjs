import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-local/**",
    ".next-check/**",
    ".next-sentry-check/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Kestrel MCP: its own libraries and the built single file (the source mcp/src is checked).
    "mcp/node_modules/**",
    "downloads-private/**",
    // Kestrel Connect (desktop app, connect/): a separate Electron program (CommonJS require is right there), not the web App.
    "connect/**",
  ]),
]);

export default eslintConfig;
