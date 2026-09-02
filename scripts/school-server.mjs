// OKROBO school server: serves a pack index and archives to every studio on
// the local network, so a class of 30 downloads a pack once over the LAN
// instead of 30 times over the internet.
//
//   node scripts/school-server.mjs [--port 8480] [--dir dist/packs]
//
// It is deliberately a plain static file server with CORS: the studio's store
// speaks the same shape to a school server, a USB stick, or the internet.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number(flag("port", process.env.PORT || 8480));
const DIR = resolve(flag("dir", "dist/packs"));

const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".gz": "application/gzip",
  ".md": "text/markdown; charset=utf-8",
  ".urdf": "application/xml; charset=utf-8",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  // Any studio on the LAN may read the packs.
  response.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ service: "okrobo-school-server", packs: DIR }));
    return;
  }

  const requested = url.pathname === "/" ? "/index.json" : url.pathname;
  // Contain the served path: no traversal outside DIR.
  const target = join(DIR, normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(DIR) || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found\n");
    return;
  }

  response.writeHead(200, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
    "Content-Length": statSync(target).size,
  });
  createReadStream(target).pipe(response);
});

server.listen(PORT, () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log(`okrobo school server: serving ${DIR}`);
  console.log(`  local:   http://localhost:${PORT}/`);
  for (const address of addresses) console.log(`  network: http://${address}:${PORT}/`);
  console.log("students: point the studio's Asset Store at a network address above.");
});
