// Temporary audit config: type-aware rules that catch the classic damage from a
// bulk async conversion (unawaited promises, promises used as event handlers).
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts", "src/**/*.tsx"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    "@typescript-eslint/await-thenable": "error",
  },
});
