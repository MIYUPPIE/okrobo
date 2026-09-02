// Build a pack store index: packages every pack under packs/ as a .tar.gz,
// hashes it, and writes index.json next to the archives.
//
//   node scripts/build-pack-index.mjs [outDir]   (default: dist/packs)
//
// The result is a plain directory of static files: serve it from a school
// server on the LAN, a USB stick, or the internet — the studio treats all
// three identically (contracts/pack/v0).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_DIR = join(ROOT, "packs");
const OUT_DIR = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, "dist", "packs");

mkdirSync(OUT_DIR, { recursive: true });

const manifests = [];
for (const entry of readdirSync(PACKS_DIR)) {
  const packDir = join(PACKS_DIR, entry);
  if (!statSync(packDir).isDirectory()) continue;
  const manifestPath = join(packDir, "pack.json");
  if (!existsSync(manifestPath)) {
    console.warn(`skip ${entry}: no pack.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archiveName = `${manifest.id}-${manifest.version}.tar.gz`;
  const archivePath = join(OUT_DIR, archiveName);

  // Deterministic archive: sorted entries, no owner or timestamp noise.
  execFileSync("tar", [
    "--sort=name",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--mtime=UTC 2020-01-01",
    "-czf",
    archivePath,
    "-C",
    PACKS_DIR,
    entry,
  ]);

  const bytes = readFileSync(archivePath);
  manifests.push({
    ...manifest,
    size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: archiveName,
  });
  console.log(`packed ${manifest.id} ${manifest.version} (${bytes.length} bytes)`);
}

manifests.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(OUT_DIR, "index.json"), `${JSON.stringify({ packs: manifests }, null, 2)}\n`);
console.log(`index: ${join(OUT_DIR, "index.json")} (${manifests.length} packs)`);
