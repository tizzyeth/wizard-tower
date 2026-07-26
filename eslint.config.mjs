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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent git worktrees live inside the project; their transient build
    // artifacts make ESLint crash on files that vanish mid-scan.
    ".claude/worktrees/**",
    // Installed agent skills are vendored third-party tools, not our source.
    ".agents/**",
  ]),
]);

export default eslintConfig;
