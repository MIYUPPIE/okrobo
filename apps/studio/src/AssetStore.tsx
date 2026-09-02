import { useEffect, useState } from "react";
import { installPack, type InstalledPack, listPacks, uninstallPack } from "./projects/api";
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

  const install = async (entry: StoreEntry) => {
    const { manifest } = entry;
    if (!manifest.url || !manifest.sha256) {
      setStatus(`${manifest.id}: the index has no archive url or digest`);
      return;
    }
    setBusy(manifest.id);
    setStatus(`downloading ${manifest.name}…`);
    try {
      const response = await fetch(manifest.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const archive = new Uint8Array(await response.arrayBuffer());
      // The shell verifies the digest before unpacking anything.
      const result = await installPack(manifest.id, manifest.version, manifest.sha256, archive);
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
