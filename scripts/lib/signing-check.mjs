// Gate check for pack signing (docs/decisions/pack-signing.md): a freshly
// generated key signs the built index, the signatures verify, and tampering
// with the archive digest or the version breaks them.
//
//   node scripts/lib/signing-check.mjs

import { execFileSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIGNER = join(ROOT, "scripts", "sign-pack.mjs");
const INDEX = join(ROOT, "dist", "packs", "index.json");

const keyDir = mkdtempSync(join(tmpdir(), "okrobo-keys-"));
const failures = [];
const check = (name, condition) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
  if (!condition) failures.push(name);
};

try {
  execFileSync("node", [SIGNER, "--keygen", keyDir], { stdio: "pipe" });
  const privatePath = join(keyDir, "okrobo-publisher.key");
  const publicKey = createPublicKey(readFileSync(join(keyDir, "okrobo-publisher.pub"), "utf8"));

  // A private key must never be published as the key id.
  const privateText = readFileSync(privatePath, "utf8");
  const [keyId] = readFileSync(join(keyDir, "okrobo-publisher.txt"), "utf8").trim().split(" ");
  check("key id is derived from the public key", !privateText.includes(keyId));
  check("key id is 16 hex chars", /^[a-f0-9]{16}$/.test(keyId));

  execFileSync("node", [SIGNER, "--key", privatePath, INDEX], { stdio: "pipe" });
  const index = JSON.parse(readFileSync(INDEX, "utf8"));
  check("every pack got a signature", index.packs.every((p) => p.signature && p.key_id));

  const payload = (m) =>
    Buffer.from([m.id, m.version, m.sha256, String(m.size_bytes)].join("\n"), "utf8");

  const allVerify = index.packs.every((p) =>
    verify(null, payload(p), publicKey, Buffer.from(p.signature, "hex")),
  );
  check("signatures verify against the public key", allVerify);

  const pack = index.packs[0];
  const swapped = { ...pack, sha256: "0".repeat(64) };
  check(
    "a swapped archive digest breaks the signature",
    !verify(null, payload(swapped), publicKey, Buffer.from(pack.signature, "hex")),
  );

  const downgraded = { ...pack, version: "0.0.1" };
  check(
    "a version downgrade breaks the signature",
    !verify(null, payload(downgraded), publicKey, Buffer.from(pack.signature, "hex")),
  );
} finally {
  rmSync(keyDir, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "pack signing OK" : `pack signing FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
