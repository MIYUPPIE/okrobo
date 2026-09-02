// Drives a headless browser against a running studio dev server and asserts
// the engine loaded and the 3D viewport rendered. Used by
// scripts/check-dev-server.sh; env: CDP_PORT, URL.

import { connect, sleep } from "./cdp.mjs";

const CDP_PORT = Number(process.env.CDP_PORT || 9231);
const TARGET = process.env.URL || "http://localhost:5199/";

const page = await connect(CDP_PORT);
await page.navigate(TARGET);
await sleep(9000);

const status = (await page.evaluate("document.querySelector('.run-bar .status')?.textContent ?? ''")) ?? "";
const hasCanvas = await page.evaluate("!!document.querySelector('.viewport-3d canvas')");
const hasOverlay = await page.evaluate("!!document.querySelector('vite-error-overlay')");

const live = /tick \d/.test(status);
const notBuilt = /not built|Loading engine/.test(status);
const ok = hasCanvas && live && !notBuilt && !hasOverlay;

console.log(`status:  ${status.trim()}`);
console.log(`canvas:  ${hasCanvas}`);
console.log(`overlay: ${hasOverlay ? "PRESENT (vite error)" : "none"}`);
console.log(ok ? "dev server OK: engine loaded, 3D rendering" : "dev server BROKEN");
page.close();
process.exit(ok ? 0 : 1);
