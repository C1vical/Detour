// Where the project's Python virtualenv keeps its interpreter.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VENV = join(ROOT, ".venv");

export const venvPython = () =>
  [join(VENV, "Scripts", "python.exe"), join(VENV, "bin", "python")].find((p) => existsSync(p));
