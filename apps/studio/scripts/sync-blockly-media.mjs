// Copies Blockly's media assets (sprites, cursors) into public/ so the app
// never touches Blockly's CDN. Offline is a first-class requirement.
// Runs automatically via predev/prebuild. Output is gitignored.

import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "node_modules", "blockly", "media");
const destination = join(here, "..", "public", "blockly-media");

cpSync(source, destination, { recursive: true });
console.log("blockly media -> public/blockly-media");
