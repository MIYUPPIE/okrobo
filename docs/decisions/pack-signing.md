# Decision: pack signing

**Date:** 2026-09-02 (Phase 7; deferred from Phase 6 pending this decision)

## The question

A pack manifest carries a `sha256`, which proves an archive was not corrupted
in transit. It does not prove *who made it*: anyone who can serve an index can
serve their own archive with a matching digest. Schools run their own servers,
so "trust the server" is not enough on its own.

## Choice

**Ed25519 signatures over the manifest, with a small trusted-key list.**

- The publisher signs the canonical manifest bytes; the signature and the
  signing key id go in the index entry (`signature`, `key_id`).
- The studio ships with the OKHUB publisher key built in.
- A school can add its own key so teachers publish local packs. Adding a key
  is an explicit, visible action, never automatic.
- An unsigned or wrongly-signed pack is **not** refused outright: it installs
  only after an explicit confirmation that names the pack and says it is
  unverified. Refusing outright would push teachers to disable checks
  entirely, which is worse than an informed yes.

## Why Ed25519

- Node signs it with no dependency: `crypto.sign(null, data, key)` supports
  Ed25519 natively, so `scripts/sign-pack.mjs` needs nothing installed.
- Small keys (32 bytes) and signatures (64 bytes), so a key fits in a config
  file and a signature fits in the index.
- Verification is a few lines with `ed25519-dalek` in the Rust shell.

## Rejected

- **GPG:** heavyweight for schools; needs the gpg binary and a keyring.
- **X.509/TLS certificates:** the trust story is about publishers, not hosts;
  a certificate chain adds machinery without answering the actual question.
- **Signing the archive rather than the manifest:** the manifest already binds
  the archive through `sha256`, so signing the manifest covers both with one
  signature over stable, canonical bytes.

## Canonical bytes

The signed payload is `id|version|sha256|size_bytes` joined with `\n`. Compact,
unambiguous, and free of JSON key-ordering questions — the four fields that
identify exactly which bytes get installed.
