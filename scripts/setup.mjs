// One-time setup: npm packages, the .venv virtualenv and the Python packages.
// Usage: npm run setup
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT, VENV, venvPython } from "./venv.mjs";

function run(cmd, args = []) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  // A bare command string (npm, which is npm.cmd on Windows) needs a shell.
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: args.length === 0 });
  if (r.status !== 0) {
    console.error(`\nSetup failed at: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

// The first Python 3.10+ on the PATH.
function systemPython() {
  for (const cmd of ["python3", "python", "py"]) {
    const r = spawnSync(cmd, ["-c", "import sys; sys.exit(sys.version_info < (3, 10))"]);
    if (r.status === 0) return cmd;
  }
  console.error("Python 3.10 or newer is required: install it from https://www.python.org/downloads/");
  process.exit(1);
}

if (!existsSync(join(ROOT, "node_modules"))) run("npm install");
if (!venvPython()) run(systemPython(), ["-m", "venv", VENV]);
run(venvPython(), ["-m", "pip", "install", "--upgrade", "pip"]);
run(venvPython(), ["-m", "pip", "install", "-r", "requirements.txt"]);

console.log("\nSetup done. Start the app with: npm run dev");
