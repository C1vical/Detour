// Runs the Python backend (:8000) and the Next.js frontend (:3000) together.
// Usage: npm run dev   (Ctrl+C stops both)
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";

import { ROOT, venvPython } from "./venv.mjs";

const python = venvPython();
if (!python) {
  console.error("No Python environment yet. Run `npm run setup` first.");
  process.exit(1);
}
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

const services = [
  { name: "api", color: 36, cmd: python, args: ["-m", "uvicorn", "backend.api:app", "--reload", "--reload-dir", "backend", "--port", "8000"] },
  { name: "web", color: 35, cmd: process.execPath, args: [next, "dev"] },
];

const children = services.map(({ name, color, cmd, args }) => {
  // detached on POSIX gives each service its own process group, so killTree can stop it whole.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: "1" },
    detached: process.platform !== "win32",
  });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => console.log(tag + line));
  }
  child.on("exit", (code) => {
    console.log(`${tag}stopped${code ? ` (exit code ${code})` : ""}`);
    shutdown(code ?? 0);
  });
  return child;
});

console.log("Starting... open http://localhost:3000 (the backend takes a few seconds to load the campus).");

// Both servers start worker processes of their own (uvicorn's reloader, Next's
// server), so stop the whole tree or they keep holding the ports.
function killTree(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  children.forEach(killTree);
  process.exitCode = code;
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
