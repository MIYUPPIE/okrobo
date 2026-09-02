//! Pack signature verification (docs/decisions/pack-signing.md).
//!
//! A `sha256` proves an archive arrived intact; a signature proves who
//! published it. Anyone can run a pack server, so schools need the second
//! guarantee as well as the first.
//!
//! Signed payload: `id|version|sha256|size_bytes` joined with `\n` — the four
//! fields that decide exactly which bytes get installed. Signing those covers
//! archive swaps and version downgrades alike.

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Publisher keys the studio trusts out of the box. A school adds its own
/// through the trusted-key list; that is always an explicit action.
pub const BUILTIN_KEYS: &[(&str, &str)] = &[
    // ("okhub", "<64 hex chars of the raw ed25519 public key>"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trust {
    /// Signed by a key we trust: install without ceremony.
    Verified,
    /// No signature at all: installable, but the user must say so.
    Unsigned,
    /// Signed by a key we do not know: installable with confirmation.
    UnknownKey,
    /// A signature that does not match the manifest: never install.
    Invalid,
}

pub fn canonical_payload(id: &str, version: &str, sha256: &str, size_bytes: u64) -> Vec<u8> {
    format!("{id}\n{version}\n{sha256}\n{size_bytes}").into_bytes()
}

fn parse_key(hex_key: &str) -> Option<VerifyingKey> {
    let bytes = hex::decode(hex_key).ok()?;
    let array: [u8; 32] = bytes.try_into().ok()?;
    VerifyingKey::from_bytes(&array).ok()
}

fn parse_signature(hex_signature: &str) -> Option<Signature> {
    let bytes = hex::decode(hex_signature).ok()?;
    let array: [u8; 64] = bytes.try_into().ok()?;
    Some(Signature::from_bytes(&array))
}

/// Decide how far to trust a pack before installing it.
///
/// `trusted_keys` are (key_id, raw public key hex) pairs: the built-ins plus
/// whatever the school added.
pub fn verify_pack(
    id: &str,
    version: &str,
    sha256: &str,
    size_bytes: u64,
    signature: Option<&str>,
    key_id: Option<&str>,
    trusted_keys: &[(String, String)],
) -> Trust {
    let Some(signature_hex) = signature else {
        return Trust::Unsigned;
    };
    let Some(signature) = parse_signature(signature_hex) else {
        return Trust::Invalid;
    };
    let payload = canonical_payload(id, version, sha256, size_bytes);

    // A key id narrows the search, but a signature that verifies against any
    // trusted key is what actually counts.
    let candidates: Vec<&(String, String)> = match key_id {
        Some(wanted) => trusted_keys.iter().filter(|(id, _)| id == wanted).collect(),
        None => trusted_keys.iter().collect(),
    };
    if candidates.is_empty() {
        // Unknown publisher, but a malformed signature is still worse.
        return match trusted_keys
            .iter()
            .filter_map(|(_, key)| parse_key(key))
            .any(|key| key.verify_strict(&payload, &signature).is_ok())
        {
            true => Trust::Verified,
            false => Trust::UnknownKey,
        };
    }

    for (_, key_hex) in candidates {
        if let Some(key) = parse_key(key_hex) {
            if key.verify_strict(&payload, &signature).is_ok() {
                return Trust::Verified;
            }
        }
    }
    // The named key exists but the signature does not match it: tampering.
    Trust::Invalid
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn key_pair() -> (SigningKey, String, String) {
        // Deterministic key so the test is reproducible.
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let raw = hex::encode(signing.verifying_key().to_bytes());
        let id = raw[..16].to_string();
        (signing, id, raw)
    }

    fn sign(signing: &SigningKey, id: &str, version: &str, sha: &str, size: u64) -> String {
        hex::encode(
            signing
                .sign(&canonical_payload(id, version, sha, size))
                .to_bytes(),
        )
    }

    #[test]
    fn a_correctly_signed_pack_is_verified() {
        let (signing, key_id, raw) = key_pair();
        let sha = "a".repeat(64);
        let signature = sign(&signing, "core", "1.0.0", &sha, 2200);
        let trusted = vec![(key_id.clone(), raw)];

        let trust = verify_pack(
            "core",
            "1.0.0",
            &sha,
            2200,
            Some(&signature),
            Some(&key_id),
            &trusted,
        );
        assert_eq!(trust, Trust::Verified);
    }

    #[test]
    fn a_swapped_archive_digest_is_invalid() {
        let (signing, key_id, raw) = key_pair();
        let sha = "a".repeat(64);
        let signature = sign(&signing, "core", "1.0.0", &sha, 2200);
        let trusted = vec![(key_id.clone(), raw)];

        // Same signature, different archive: the attack signing defends against.
        let trust = verify_pack(
            "core",
            "1.0.0",
            &"b".repeat(64),
            2200,
            Some(&signature),
            Some(&key_id),
            &trusted,
        );
        assert_eq!(trust, Trust::Invalid);
    }

    #[test]
    fn a_version_downgrade_is_invalid() {
        let (signing, key_id, raw) = key_pair();
        let sha = "a".repeat(64);
        let signature = sign(&signing, "core", "2.0.0", &sha, 2200);
        let trusted = vec![(key_id.clone(), raw)];

        let trust = verify_pack(
            "core",
            "1.0.0",
            &sha,
            2200,
            Some(&signature),
            Some(&key_id),
            &trusted,
        );
        assert_eq!(trust, Trust::Invalid);
    }

    #[test]
    fn an_unsigned_pack_is_reported_not_rejected() {
        let trust = verify_pack("core", "1.0.0", &"a".repeat(64), 10, None, None, &[]);
        assert_eq!(trust, Trust::Unsigned);
    }

    #[test]
    fn an_unknown_publisher_is_distinguished_from_tampering() {
        let (signing, _, _) = key_pair();
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let other_raw = hex::encode(other.verifying_key().to_bytes());
        let other_id = other_raw[..16].to_string();

        let sha = "a".repeat(64);
        let signature = sign(&signing, "core", "1.0.0", &sha, 2200);
        // We only trust some other publisher's key.
        let trusted = vec![(other_id, other_raw)];

        let trust = verify_pack(
            "core",
            "1.0.0",
            &sha,
            2200,
            Some(&signature),
            Some("d8184756627754c3"),
            &trusted,
        );
        assert_eq!(trust, Trust::UnknownKey);
    }

    #[test]
    fn malformed_signatures_are_invalid() {
        let (_, key_id, raw) = key_pair();
        let trusted = vec![(key_id.clone(), raw)];
        for bad in ["", "zz", &"a".repeat(63), &"a".repeat(200)] {
            let trust = verify_pack(
                "core",
                "1.0.0",
                &"a".repeat(64),
                10,
                Some(bad),
                Some(&key_id),
                &trusted,
            );
            assert_eq!(trust, Trust::Invalid, "signature {bad:?} should be invalid");
        }
    }

    /// Cross-language parity: a signature produced by scripts/sign-pack.mjs
    /// (Node's native Ed25519) must verify here. Fixture generated with the
    /// same key these tests use — seed = 32 bytes of 0x07 — over the payload
    /// for core 1.0.0. If Node's signing or our canonical bytes ever drift,
    /// this fails instead of shipping packs no studio can verify.
    #[test]
    fn a_signature_made_by_the_node_signer_verifies_here() {
        const NODE_PUBLIC: &str =
            "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
        const NODE_SIGNATURE: &str = concat!(
            "2ed27c325c578743c67b54b7c2845e6bbf95c1a6d3473a89a464888112093d52",
            "a8a6ffe2c019ed885239a7b098dcbc18199ccde527663e37dad33923c39d9b01"
        );

        let trusted = vec![(NODE_PUBLIC[..16].to_string(), NODE_PUBLIC.to_string())];
        let trust = verify_pack(
            "core",
            "1.0.0",
            &"a".repeat(64),
            2200,
            Some(NODE_SIGNATURE),
            Some(&NODE_PUBLIC[..16]),
            &trusted,
        );
        assert_eq!(trust, Trust::Verified, "node-signed pack must verify in rust");

        // The same signature must not cover a different archive.
        let tampered = verify_pack(
            "core",
            "1.0.0",
            &"b".repeat(64),
            2200,
            Some(NODE_SIGNATURE),
            Some(&NODE_PUBLIC[..16]),
            &trusted,
        );
        assert_eq!(tampered, Trust::Invalid);
    }

    #[test]
    fn canonical_payload_matches_the_documented_format() {
        assert_eq!(
            String::from_utf8(canonical_payload("core", "1.0.0", "abc", 42)).unwrap(),
            "core\n1.0.0\nabc\n42"
        );
    }
}
