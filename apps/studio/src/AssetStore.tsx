import { useEffect, useState } from "react";
import {
  checkPackSignature,
  installPack,
  type InstalledPack,
  listPacks,
  type Trust,
  uninstallPack,
} from "./projects/api";
import {
  catalogue,
  DEFAULT_SOURCES,
  discoverSource,
  fetchIndex,
  type StoreEntry,
  type StoreSource,
} from "./packs/store";

// Asset store: browse a pack source (a school server on the LAN by default),
// download a pack once, and install it locally. After that the pack works
// offline forever, which is the whole point.

export function AssetStore({ onClose }: { onClose: () => void }) {
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_SOURCES[0]);
  const [source, setSource] = useState<StoreSource | null>(null);
  const [installed, setInstalled] = useState<InstalledPack[]>([]);
  const [status, setStatus] = useState("looking for a school server…");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingTrust, setPendingTrust] = useState<{ entry: StoreEntry; trust: Trust } | null>(null);

  const refreshInstalled = async () => {
    try {
      setInstalled(await listPacks());
    } catch (error) {
      console.error("list packs failed:", error);
    }
  };

  useEffect(() => {
    void (async () => {
      await refreshInstalled();
      const found = await discoverSource();
      if (found) {
        setSource(found);
        setSourceUrl(found.url);
        setStatus(`${found.packs.length} packs at ${found.url}`);
      } else {
        setStatus("no pack source found · enter an address below");
      }
    })();
  }, []);

  const connect = async (url: string) => {
    setStatus(`connecting to ${url}…`);
    try {
      const found = await fetchIndex(url);
      setSource(found);
      setStatus(`${found.packs.length} packs at ${found.url}`);
    } catch (error) {
      setSource(null);
      setStatus(`could not read ${url}: ${(error as Error).message}`);
    }
  };

  const install = async (entry: StoreEntry, confirmedUnverified = false) => {
    const { manifest } = entry;
    if (!manifest.url || !manifest.sha256) {
      setStatus(`${manifest.id}: the index has no archive url or digest`);
      return;
    }

    // Check the publisher before downloading anything
    // (docs/decisions/pack-signing.md).
    if (!confirmedUnverified) {
      let trust: Trust = "unsigned";
      try {
        trust = await checkPackSignature({
          id: manifest.id,
          version: manifest.version,
          sha256: manifest.sha256,
          size_bytes: manifest.size_bytes ?? 0,
          signature: manifest.signature,
          key_id: manifest.key_id,
        });
      } catch {
        // No shell (browser dev mode): treat as unsigned and ask.
      }
      if (trust === "invalid") {
        setStatus(`${manifest.name}: signature does not match this archive · not installed`);
        return;
      }
      if (trust !== "verified") {
        setPendingTrust({ entry, trust });
        return;
      }
    }

    setPendingTrust(null);
    setBusy(manifest.id);
    setStatus(`downloading ${manifest.name}…`);
    try {
      const response = await fetch(manifest.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const archive = new Uint8Array(await response.arrayBuffer());
      // The shell verifies the digest, and refuses a mismatched signature,
      // before unpacking anything.
      const result = await installPack(
        {
          id: manifest.id,
          version: manifest.version,
          sha256: manifest.sha256,
          size_bytes: manifest.size_bytes,
          signature: manifest.signature,
          key_id: manifest.key_id,
        },
        archive,
      );
      await refreshInstalled();
      setStatus(`installed ${result.name} ${result.version} · works offline now`);
    } catch (error) {
      setStatus(`install failed: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await uninstallPack(id);
      await refreshInstalled();
      setStatus(`removed ${id}`);
    } catch (error) {
      setStatus(`remove failed: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const entries = source ? catalogue(source.packs, installed) : [];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Asset Store</h3>

        <form
          className="store-source"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(sourceUrl);
          }}
        >
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="http://school-server:8480/"
          />
          <button type="submit">Connect</button>
        </form>

        <p className="store-status">{status}</p>

        {pendingTrust && (
          <div className="trust-prompt">
            <p>
              <strong>{pendingTrust.entry.manifest.name}</strong>{" "}
              {pendingTrust.trust === "unsigned"
                ? "is not signed."
                : "is signed by a publisher this studio does not know."}{" "}
              Install it only if you trust where it came from.
            </p>
            <div className="dialog-actions">
              <button onClick={() => setPendingTrust(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => void install(pendingTrust.entry, true)}
              >
                Install anyway
              </button>
            </div>
          </div>
        )}

        <ul className="project-list">
          {entries.map((entry) => (
            <li key={entry.manifest.id}>
              <div className="store-row">
                <span className="project-name">{entry.manifest.name}</span>
                <span className="project-date">
                  v{entry.manifest.version}
                  {entry.manifest.size_bytes
                    ? ` · ${(entry.manifest.size_bytes / 1_000_000).toFixed(1)} MB`
                    : ""}
                  {entry.manifest.signature ? " · signed" : " · unsigned"}
                  {entry.state === "upgradable" ? ` · installed ${entry.installedVersion}` : ""}
                </span>
              </div>
              {entry.state === "installed" ? (
                <>
                  <span className="store-badge">installed</span>
                  <button
                    className="delete-btn"
                    disabled={busy !== null || entry.manifest.id === "core"}
                    title={entry.manifest.id === "core" ? "The core pack cannot be removed" : "Remove"}
                    onClick={() => void remove(entry.manifest.id)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  className="store-install"
                  disabled={busy !== null}
                  onClick={() => void install(entry)}
                >
                  {busy === entry.manifest.id
                    ? "…"
                    : entry.state === "upgradable"
                      ? "Upgrade"
                      : "Download"}
                </button>
              )}
            </li>
          ))}
        </ul>

        {installed.length > 0 && (
          <p className="store-status">
            installed: {installed.map((p) => `${p.id} ${p.version}`).join(", ")}
          </p>
        )}

        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
