// Sign the packs in a store index with an Ed25519 key
// (docs/decisions/pack-signing.md).
//
//   node scripts/sign-pack.mjs --keygen [outDir]     make a key pair
//   node scripts/sign-pack.mjs --key <priv.pem> [indexPath]
//
// Node signs Ed25519 natively, so publishing needs nothing installed.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

/** The bytes a signature covers: exactly what identifies the installed pack. */
export function canonicalPayload(manifest) {
  return Buffer.from(
    [manifest.id, manifest.version, manifest.sha256, String(manifest.size_bytes)].join("\n"),
    "utf8",
  );
}

/**
 * Raw 32-byte Ed25519 public key from any key object.
 *
 * Always goes through createPublicKey: the last 32 bytes of a PKCS8 *private*
 * key are the private seed, so deriving an id from the private DER directly
 * would publish the secret.
 */
export function rawPublicKey(key) {
  // createPublicKey only accepts private keys and encoded keys, not a public
  // KeyObject, so pass those straight through.
  const publicKey = key?.type === "public" ? key : createPublicKey(key);
  return publicKey.export({ type: "spki", format: "der" }).subarray(-32);
}

/** Short, stable key id: the first 16 hex characters of the public key. */
export function keyId(key) {
  return rawPublicKey(key).toString("hex").slice(0, 16);
}

if (args.includes("--keygen")) {
  const outDir = args[args.indexOf("--keygen") + 1] || join(ROOT, "keys");
  mkdirSync(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = rawPublicKey(publicKey);
  const id = keyId(publicKey);

  writeFileSync(join(outDir, "okrobo-publisher.key"), privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  writeFileSync(join(outDir, "okrobo-publisher.pub"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(outDir, "okrobo-publisher.txt"), `${id} ${raw.toString("hex")}\n`);

  console.log(`key pair written to ${outDir}`);
  console.log(`  key id:     ${id}`);
  console.log(`  public raw: ${raw.toString("hex")}`);
  console.log("Keep the .key file secret; ship the raw public key with the studio.");
  process.exit(0);
}

const keyIndex = args.indexOf("--key");
if (keyIndex < 0) {
  console.error("usage: sign-pack.mjs --key <private.pem> [index.json]   (or --keygen [dir])");
  process.exit(1);
}

const keyPath = args[keyIndex + 1];
const indexPath = args[keyIndex + 2] || join(ROOT, "dist", "packs", "index.json");
if (!keyPath || !existsSync(keyPath)) {
  console.error(`no such key: ${keyPath}`);
  process.exit(1);
}

const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
const id = keyId(privateKey);

const index = JSON.parse(readFileSync(indexPath, "utf8"));
for (const manifest of index.packs) {
  if (!manifest.sha256 || manifest.size_bytes === undefined) {
    console.warn(`skip ${manifest.id}: no digest or size (run build-pack-index.mjs first)`);
    continue;
  }
  manifest.signature = sign(null, canonicalPayload(manifest), privateKey).toString("hex");
  manifest.key_id = id;
  console.log(`signed ${manifest.id} ${manifest.version} with key ${id}`);
}

writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`updated ${indexPath}`);
