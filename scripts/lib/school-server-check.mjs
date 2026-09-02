// Gate check for the school server: it serves a valid index, serves archives
// with the digest the index promises, and refuses to serve anything outside
// its pack directory.
//
//   node scripts/lib/school-server-check.mjs [port]

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.argv[2] || 8481);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(
  "node",
  [join(ROOT, "scripts", "school-server.mjs"), "--port", String(PORT), "--dir", join(ROOT, "dist", "packs")],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const stop = () => server.kill();
process.on("exit", stop);

let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) {
      ready = true;
      break;
    }
  } catch {}
  await sleep(250);
}
if (!ready) {
  console.error("school server did not start");
  stop();
  process.exit(1);
}

const failures = [];
const check = (name, condition) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
  if (!condition) failures.push(name);
};

const index = await (await fetch(`${BASE}/`)).json();
check("index served at /", Array.isArray(index.packs) && index.packs.length > 0);

const pack = index.packs[0];
check("manifest carries size and digest", Boolean(pack.sha256 && pack.size_bytes && pack.url));

const archive = Buffer.from(await (await fetch(`${BASE}/${pack.url}`)).arrayBuffer());
const digest = createHash("sha256").update(archive).digest("hex");
check("archive matches the advertised digest", digest === pack.sha256);
check("archive matches the advertised size", archive.length === pack.size_bytes);

const traversal = await fetch(`${BASE}/../../package.json`);
check("refuses path traversal", traversal.status === 404);

const missing = await fetch(`${BASE}/no-such-pack.tar.gz`);
check("404s unknown files", missing.status === 404);

stop();
console.log(failures.length === 0 ? "school server OK" : `school server FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
