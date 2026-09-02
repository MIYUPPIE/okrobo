//! Pack installation (contracts/pack/v0).
//!
//! Packs are downloaded content, so this module is deliberately paranoid:
//! the archive is verified against the manifest digest before anything is
//! written, entries that escape the pack directory are refused, and an
//! install only proceeds as a first install or a version upgrade. A failed
//! install leaves the previously installed version untouched.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstalledPack {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// SHA-256 without pulling in a crypto crate: the digest is a content check
/// against a manifest we already trust as much as the archive, not a
/// signature. Small, self-contained, and covered by known-answer tests.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let mut message = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d) = (h[0], h[1], h[2], h[3]);
        let (mut e, mut f, mut g, mut hh) = (h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }

    h.iter().map(|word| format!("{word:08x}")).collect()
}

/// Reject archive entries that would escape the pack directory.
pub fn safe_entry_path(pack_root: &Path, entry: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(entry);
    if candidate.is_absolute() {
        return Err(format!("unsafe entry (absolute): {entry}"));
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir => return Err(format!("unsafe entry (escapes pack): {entry}")),
            Component::Prefix(_) | Component::RootDir => {
                return Err(format!("unsafe entry (absolute): {entry}"))
            }
            _ => {}
        }
    }
    Ok(pack_root.join(candidate))
}

pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| -> Vec<u32> { v.split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    parse(a).cmp(&parse(b))
}

pub struct PackStore {
    root: PathBuf,
}

impl PackStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(PackStore { root })
    }

    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    pub fn list(&self) -> Result<Vec<InstalledPack>, String> {
        let mut packs = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let manifest = path.join("pack.json");
            if !manifest.exists() {
                continue;
            }
            let text = fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
            let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            packs.push(InstalledPack {
                id: value["id"].as_str().unwrap_or_default().to_string(),
                name: value["name"].as_str().unwrap_or_default().to_string(),
                version: value["version"].as_str().unwrap_or_default().to_string(),
            });
        }
        packs.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(packs)
    }

    pub fn installed(&self, id: &str) -> Option<InstalledPack> {
        self.list().ok()?.into_iter().find(|p| p.id == id)
    }

    /// Verify a downloaded archive against the manifest before it is unpacked.
    pub fn verify(&self, archive: &[u8], expected_sha256: &str) -> Result<(), String> {
        let actual = sha256_hex(archive);
        if actual != expected_sha256.to_lowercase() {
            return Err(format!(
                "digest mismatch: expected {expected_sha256}, got {actual}"
            ));
        }
        Ok(())
    }

    /// Install a verified archive: unpack to a staging directory, then swap it
    /// in. The previous version survives any failure before the swap.
    pub fn install(
        &self,
        id: &str,
        version: &str,
        archive: &[u8],
        expected_sha256: &str,
    ) -> Result<InstalledPack, String> {
        self.can_install(id, version)?;
        self.verify(archive, expected_sha256)?;

        let staging = self.root.join(format!(".staging-{id}"));
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

        let archive_path = staging.join("pack.tar.gz");
        fs::write(&archive_path, archive).map_err(|e| e.to_string())?;

        // tar refuses absolute paths and traversal itself, and we re-check the
        // unpacked manifest below; pack content is data, never executed.
        let output = std::process::Command::new("tar")
            .arg("-xzf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&staging)
            .output()
            .map_err(|e| format!("tar failed to run: {e}"))?;
        if !output.status.success() {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "unpack failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        // The archive holds one directory; find the one carrying pack.json.
        let unpacked = fs::read_dir(&staging)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .find(|path| path.is_dir() && path.join("pack.json").exists())
            .ok_or_else(|| "archive has no pack.json".to_string())?;

        let manifest_text =
            fs::read_to_string(unpacked.join("pack.json")).map_err(|e| e.to_string())?;
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;
        let manifest_id = manifest["id"].as_str().unwrap_or_default();
        let manifest_version = manifest["version"].as_str().unwrap_or_default();
        if manifest_id != id || manifest_version != version {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "archive contents ({manifest_id} {manifest_version}) do not match the index entry ({id} {version})"
            ));
        }

        let destination = self.dir(id);
        let previous = self.root.join(format!(".previous-{id}"));
        let _ = fs::remove_dir_all(&previous);
        if destination.exists() {
            fs::rename(&destination, &previous).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&unpacked, &destination) {
            // Roll back to the version that was installed before.
            if previous.exists() {
                let _ = fs::rename(&previous, &destination);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(error.to_string());
        }
        let _ = fs::remove_dir_all(&previous);
        let _ = fs::remove_dir_all(&staging);

        Ok(InstalledPack {
            id: id.to_string(),
            name: manifest["name"].as_str().unwrap_or(id).to_string(),
            version: version.to_string(),
        })
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        let dir = self.dir(id);
        if dir.exists() {
            fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Refuse anything that is not a first install or a version upgrade.
    pub fn can_install(&self, id: &str, version: &str) -> Result<(), String> {
        match self.installed(id) {
            None => Ok(()),
            Some(existing) => match compare_versions(version, &existing.version) {
                std::cmp::Ordering::Greater => Ok(()),
                std::cmp::Ordering::Equal => Err(format!("{id} {version} is already installed")),
                std::cmp::Ordering::Less => Err(format!(
                    "{id} {version} is older than the installed {}",
                    existing.version
                )),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_answers() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // Longer than one 64-byte block, exercising the padding path.
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn verify_accepts_matching_digest_and_rejects_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let store = PackStore::new(dir.path().to_path_buf()).unwrap();
        let archive = b"pack bytes";
        let digest = sha256_hex(archive);
        assert!(store.verify(archive, &digest).is_ok());
        assert!(store.verify(b"tampered bytes", &digest).is_err());
        // Upper-case digests from a manifest are accepted.
        assert!(store.verify(archive, &digest.to_uppercase()).is_ok());
    }

    #[test]
    fn entry_paths_cannot_escape_the_pack() {
        let root = Path::new("/tmp/packs/core");
        assert!(safe_entry_path(root, "worlds/arena.json").is_ok());
        assert!(safe_entry_path(root, "../../etc/passwd").is_err());
        assert!(safe_entry_path(root, "/etc/shadow").is_err());
        assert!(safe_entry_path(root, "worlds/../../../escape").is_err());
    }

    #[test]
    fn install_rules_allow_first_install_and_upgrades_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = PackStore::new(dir.path().to_path_buf()).unwrap();
        assert!(store.can_install("core", "1.0.0").is_ok());

        let pack_dir = store.dir("core");
        fs::create_dir_all(&pack_dir).unwrap();
        fs::write(
            pack_dir.join("pack.json"),
            r#"{"id":"core","name":"Core","version":"1.2.0"}"#,
        )
        .unwrap();

        assert!(store.can_install("core", "1.3.0").is_ok());
        assert!(store.can_install("core", "1.2.0").is_err());
        assert!(store.can_install("core", "1.1.0").is_err());
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.installed("core").unwrap().version, "1.2.0");
    }

    /// Build a real pack archive the way scripts/build-pack-index.mjs does.
    fn make_archive(dir: &Path, id: &str, version: &str) -> Vec<u8> {
        let pack_dir = dir.join(id);
        fs::create_dir_all(pack_dir.join("worlds")).unwrap();
        fs::write(
            pack_dir.join("pack.json"),
            format!(r#"{{"id":"{id}","name":"Test Pack","version":"{version}"}}"#),
        )
        .unwrap();
        fs::write(pack_dir.join("worlds/arena.json"), "{}").unwrap();
        let archive = dir.join("pack.tar.gz");
        let status = std::process::Command::new("tar")
            .args(["-czf"])
            .arg(&archive)
            .arg("-C")
            .arg(dir)
            .arg(id)
            .status()
            .unwrap();
        assert!(status.success());
        let bytes = fs::read(&archive).unwrap();
        fs::remove_dir_all(&pack_dir).unwrap();
        fs::remove_file(&archive).unwrap();
        bytes
    }

    #[test]
    fn install_unpacks_a_verified_archive() {
        let build = tempfile::tempdir().unwrap();
        let archive = make_archive(build.path(), "robotics", "1.0.0");
        let digest = sha256_hex(&archive);

        let home = tempfile::tempdir().unwrap();
        let store = PackStore::new(home.path().to_path_buf()).unwrap();
        let installed = store
            .install("robotics", "1.0.0", &archive, &digest)
            .unwrap();

        assert_eq!(installed.version, "1.0.0");
        assert!(store.dir("robotics").join("pack.json").exists());
        assert!(store.dir("robotics").join("worlds/arena.json").exists());
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn install_refuses_a_tampered_archive_and_keeps_the_old_version() {
        let build = tempfile::tempdir().unwrap();
        let good = make_archive(build.path(), "robotics", "1.0.0");
        let digest = sha256_hex(&good);

        let home = tempfile::tempdir().unwrap();
        let store = PackStore::new(home.path().to_path_buf()).unwrap();
        store.install("robotics", "1.0.0", &good, &digest).unwrap();

        // A "2.0.0" download whose bytes do not match its advertised digest.
        let tampered = make_archive(build.path(), "robotics", "2.0.0");
        let error = store
            .install("robotics", "2.0.0", &tampered, &"b".repeat(64))
            .unwrap_err();
        assert!(error.contains("digest mismatch"), "{error}");
        assert_eq!(store.installed("robotics").unwrap().version, "1.0.0");
    }

    #[test]
    fn install_refuses_an_archive_that_lies_about_its_contents() {
        let build = tempfile::tempdir().unwrap();
        // Archive really contains 1.0.0 but the index claims 2.0.0.
        let archive = make_archive(build.path(), "robotics", "1.0.0");
        let digest = sha256_hex(&archive);

        let home = tempfile::tempdir().unwrap();
        let store = PackStore::new(home.path().to_path_buf()).unwrap();
        let error = store
            .install("robotics", "2.0.0", &archive, &digest)
            .unwrap_err();
        assert!(error.contains("do not match the index entry"), "{error}");
        assert!(store.installed("robotics").is_none());
    }

    #[test]
    fn upgrade_replaces_the_previous_version() {
        let build = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let store = PackStore::new(home.path().to_path_buf()).unwrap();

        let v1 = make_archive(build.path(), "robotics", "1.0.0");
        store.install("robotics", "1.0.0", &v1, &sha256_hex(&v1)).unwrap();
        let v2 = make_archive(build.path(), "robotics", "2.0.0");
        store.install("robotics", "2.0.0", &v2, &sha256_hex(&v2)).unwrap();

        assert_eq!(store.installed("robotics").unwrap().version, "2.0.0");
        assert_eq!(store.list().unwrap().len(), 1);

        store.uninstall("robotics").unwrap();
        assert!(store.installed("robotics").is_none());
    }

    #[test]
    fn versions_compare_numerically_not_lexically() {
        assert_eq!(compare_versions("1.2.0", "1.10.0"), std::cmp::Ordering::Less);
        assert_eq!(
            compare_versions("2.0.0", "1.9.9"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(compare_versions("1.2.3", "1.2.3"), std::cmp::Ordering::Equal);
    }
}
