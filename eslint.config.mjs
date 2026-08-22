import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships flat config directly. The previous setup routed these same
// two configs through `FlatCompat`, the eslintrc-compat shim, which crashed ESLint 9 before
// it linted anything: the shim JSON.stringifies a config to validate it, and the flat config
// it is handed holds a circular plugins reference ("Converting circular structure to JSON").
// The shim is what broke, not the configs — importing them natively is the documented path
// (node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md).
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // eslint-config-next already defaults to these; restated because declaring any
  // `globalIgnores` here replaces that default rather than adding to it.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
