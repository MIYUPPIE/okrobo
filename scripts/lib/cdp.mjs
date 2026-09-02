// Minimal Chrome DevTools Protocol client shared by the browser gate checks.
// Deliberately dependency-free (no Puppeteer/Playwright): the whole surface
// this repo's checks need is "navigate, evaluate JS, dispatch input events",
// which is a couple hundred lines of raw CDP over a WebSocket.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect(cdpPort, { retries = 20, delayMs = 500 } = {}) {
  let targets = [];
  for (let i = 0; i < retries; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {
      // Chrome not listening yet.
    }
    await sleep(delayMs);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target on CDP port ${cdpPort}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

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

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.exceptionDetails) {
      throw new Error(
        `page evaluate threw: ${result.result.exceptionDetails.text} — ${expression.slice(0, 120)}`,
      );
    }
    return result.result?.result?.value;
  };

  const navigate = async (url) => {
    await send("Page.navigate", { url });
  };

  /** Click the element matched by `selector` (querySelector, first match). */
  const click = async (selector) => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!box) throw new Error(`click: no element matches ${selector}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  };

  /** Click the first element whose text content matches `pattern` under `containerSelector`. */
  const clickText = async (containerSelector, pattern) => {
    const box = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(containerSelector)})];
      const el = nodes.find((n) => ${pattern}.test(n.textContent || ""));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!box) throw new Error(`clickText: no ${containerSelector} matches ${pattern}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  };

  const keyPress = async (key) => {
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, key, code: key });
    }
  };

  const close = () => ws.close();

  return { send, evaluate, navigate, click, clickText, keyPress, close };
}

export { sleep };
