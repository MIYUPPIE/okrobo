// Drives a headless browser against a running studio dev server and asserts
// the engine loaded and the 3D viewport rendered. Used by
// scripts/check-dev-server.sh; env: CDP_PORT, URL.

const CDP_PORT = Number(process.env.CDP_PORT || 9231);
const TARGET = process.env.URL || "http://localhost:5199/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = [];
for (let i = 0; i < 20; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(500);
}
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("dev-server check: no page target in the browser");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

await send("Page.navigate", { url: TARGET });
await sleep(9000);

const status = (await evaluate("document.querySelector('.run-bar .status')?.textContent ?? ''")) ?? "";
const hasCanvas = await evaluate("!!document.querySelector('.viewport-3d canvas')");
const hasOverlay = await evaluate("!!document.querySelector('vite-error-overlay')");

const live = /tick \d/.test(status);
const notBuilt = /not built|Loading engine/.test(status);
const ok = hasCanvas && live && !notBuilt && !hasOverlay;

console.log(`status:  ${status.trim()}`);
console.log(`canvas:  ${hasCanvas}`);
console.log(`overlay: ${hasOverlay ? "PRESENT (vite error)" : "none"}`);
console.log(ok ? "dev server OK: engine loaded, 3D rendering" : "dev server BROKEN");
ws.close();
process.exit(ok ? 0 : 1);
