// Permanent browser regression test for the core student journeys.
//
// Every phase of this build was verified by hand in headless Chrome and the
// script thrown away afterward — meaning nothing in the gate suite actually
// exercised the browser. This is that verification made permanent: it
// belongs in test-all.sh so a future change (mine or anyone else's) that
// breaks robot switching, running a program, the camera, or the lesson
// player fails the build instead of shipping unnoticed.
//
// env: CDP_PORT, URL. Exits non-zero and prints which check failed.

import { connect, sleep } from "./cdp.mjs";

const CDP_PORT = Number(process.env.CDP_PORT || 9270);
const TARGET = process.env.URL || "http://localhost:5199/";

const failures = [];
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
  return ok;
}

const page = await connect(CDP_PORT);

/**
 * Poll `expression` until it is truthy. Every condition here explicitly
 * requires its target element to EXIST before checking a property on it:
 * `document.querySelector(x)?.disabled` is `undefined` (falsy) while
 * enabled, but `!document.querySelector(x)?.disabled` is `true` both when
 * the element is enabled AND when it doesn't exist yet — a real bug caught
 * while writing this check, since the second case fires long before the
 * page has actually finished loading.
 */
async function waitForCondition(expression, timeoutMs = 15000, pollMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(expression)) return true;
    await sleep(pollMs);
  }
  return false;
}

const status = () => page.evaluate("document.querySelector('.run-bar .status')?.textContent ?? ''");

// Monaco renders spaces as U+00A0 (non-breaking) to preserve monospace
// alignment in its DOM, so `.innerText` never contains a literal " " between
// words. Every read of the editor normalizes that first — an in-page
// expression fragment (for waitForCondition) and a JS-side fetch (for
// printing/asserting on the result) share this one definition so the two
// can never drift out of sync the way they briefly did while writing this.
const PYTHON_EDITOR_TEXT_EXPR =
  "(document.querySelector('.python-editor')?.innerText ?? '').replace(/\\u00a0/g, ' ')";
const pythonEditorText = () => page.evaluate(PYTHON_EDITOR_TEXT_EXPR);

try {
  // -- boot: engine ready, 3D rendering, starting on Car ----------------------
  await page.navigate(TARGET);
  const engineReady = await waitForCondition(
    "(() => { const b = document.querySelector('.run-bar .run'); return !!b && !b.disabled; })()",
  );
  check("engine loads and Run becomes enabled", engineReady);

  const canvasReady = await waitForCondition("!!document.querySelector('.viewport-3d canvas')");
  check("3D canvas renders", canvasReady);

  const carStatusReady = await waitForCondition("/d 0\\.50 m/.test(document.querySelector('.run-bar .status')?.textContent ?? '')");
  check("starts on the Car with the shipped arena (red box 0.5 m ahead)", carStatusReady, await status());

  // -- camera preview: live, non-blank frames ----------------------------------
  const cameraCanvasReady = await waitForCondition("!!document.querySelector('.camera-canvas')");
  check("camera preview canvas present", cameraCanvasReady);

  const cameraStatsExpr = `(() => {
    const canvas = document.querySelector('.camera-canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0, distinctColors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      distinctColors.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
      if (d[i] > d[i+1] * 2 && d[i] > d[i+2] * 2 && d[i] > 40) redPixels++;
    }
    return { redPixels, distinctColors: distinctColors.size };
  })()`;
  await waitForCondition(`(() => { const s = ${cameraStatsExpr}; return s && s.redPixels > 50; })()`, 5000);
  const cameraStats = await page.evaluate(cameraStatsExpr);
  check(
    "camera shows the red box (matches contracts/world/v1 arena)",
    cameraStats && cameraStats.redPixels > 50 && cameraStats.distinctColors > 3,
    JSON.stringify(cameraStats),
  );

  // -- running the preloaded wall-avoider blocks program -----------------------
  await page.click(".run-bar .run");
  const sawRunning = await waitForCondition(
    "/blocks running/.test(document.querySelector('.run-bar .status')?.textContent ?? '')",
    5000,
  );
  check("Run starts the preloaded block program", sawRunning);
  // The car starts 0.5 m from a wall; give it real simulated time to reach
  // and turn at one, which changes its heading and therefore its y position.
  const droveAndTurned = await waitForCondition(
    `(() => {
      const s = document.querySelector('.run-bar .status')?.textContent ?? '';
      const y = Number(/y (\\d+\\.\\d+)/.exec(s)?.[1] ?? 0);
      return y > 1.3 || y < 0.7;
    })()`,
    20000,
  );
  check("the robot drives and turns at a wall (y moves off 1.00)", droveAndTurned, await status());

  await page.click(".run-bar .run + button"); // Stop
  const stopped = await waitForCondition(
    "!/blocks running/.test(document.querySelector('.run-bar .status')?.textContent ?? '')",
    3000,
  );
  check("Stop halts the program", stopped);

  await page.click(".run-bar .run + button + button"); // Reset
  const reset = await waitForCondition(
    "/x 1\\.00 y 1\\.00/.test(document.querySelector('.run-bar .status')?.textContent ?? '')",
    3000,
  );
  check("Reset restores the starting pose", reset, await status());

  // -- World tab: editing an object actually rebuilds the live sim ------------
  // Coordinate-based click()/clickText() compute a bounding rect and dispatch
  // at that fixed point; a state update from the field edit just before can
  // shift the button before the dispatch lands (found writing this check).
  // evalClick/evalClickText do a real DOM .click(), immune to that race.
  await page.evalClickText(".code-tab", "/^World$/");
  const worldTabReady = await waitForCondition("!!document.querySelector('.world-panel')");
  check("World tab renders the editor for the Car robot", worldTabReady);

  const startsWithShippedObjects = await waitForCondition(
    "document.querySelector('.world-count')?.textContent?.trim() === '2 / 16'",
  );
  check(
    "World tab starts with the arena's 2 shipped objects (red + blue box)",
    startsWithShippedObjects,
    await page.evaluate("document.querySelector('.world-count')?.textContent"),
  );

  // Move the red box (originally x=1.7) to x=1.3, still directly ahead of the
  // car at x=1.0: the sensor reading should move from 0.50 m to 0.10 m —
  // (1.3 - width/2) - (robot_x + robot_radius) = 1.2 - 1.1.
  await page.setInputValue('[aria-label="object 1 x"]', "1.3");
  const noValidationError = await page.evaluate("!document.querySelector('.world-error')");
  check("editing an object to a valid position shows no validation error", noValidationError);

  await page.evalClick(".world-actions .primary"); // Apply changes
  const objectMoved = await waitForCondition("/d 0\\.10 m/.test(document.querySelector('.run-bar .status')?.textContent ?? '')");
  check("editing an object and clicking Apply moves it in the live sim, not just the form", objectMoved, await status());

  await page.evalClickText(".world-actions button", "/reset to pack default/i");
  const worldReset = await waitForCondition("/d 0\\.50 m/.test(document.querySelector('.run-bar .status')?.textContent ?? '')");
  check("reset to pack default restores the shipped arena", worldReset, await status());

  // -- Python tab mirrors the blocks --------------------------------------------
  await page.clickText(".code-tab", "/^Python$/");
  const pythonReady = await waitForCondition(
    `/from okrobo import Robot/.test(${PYTHON_EDITOR_TEXT_EXPR})`,
    5000,
  );
  const pythonText = (await pythonEditorText()) ?? "";
  check("Python tab shows okrobo Robot code generated from the blocks", pythonReady, pythonText.slice(0, 60));
  check("Python tab shows the wall-avoider's turn_left call", /turn_left\(90\)/.test(pythonText));

  // -- robot switching: Car -> Arm -> Car --------------------------------------
  await page.clickText(".robot.selectable", "/Arm/");
  const onArm = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Arm')",
    5000,
  );
  check("clicking Arm switches the active robot", onArm);
  check(
    "Arm status line shows joint telemetry",
    await waitForCondition("/joints/.test(document.querySelector('.run-bar .status')?.textContent ?? '')", 5000),
  );

  await page.clickText(".code-tab", "/^Python$/"); // re-select Python for the arm
  const armPythonReady = await waitForCondition(
    `/from okrobo import Arm/.test(${PYTHON_EDITOR_TEXT_EXPR})`,
    5000,
  );
  check(
    "Python tab switches to the okrobo Arm API for the arm",
    armPythonReady,
    (await pythonEditorText()).slice(0, 60),
  );

  await page.clickText(".robot.selectable", "/Car/");
  const backOnCar = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Car')",
    5000,
  );
  check("switching back to Car works", backOnCar);

  // -- lessons: list, open, "Try this" loads code and can switch robots -------
  await page.clickText(".code-tab", "/^Lessons$/");
  const lessonsReady = await waitForCondition("document.querySelectorAll('.lesson-card').length >= 2", 5000);
  const lessonCount = await page.evaluate("document.querySelectorAll('.lesson-card').length");
  check("Lessons tab lists at least the two core lessons", lessonsReady, `${lessonCount} lessons`);

  await page.clickText(".lesson-card", "/Wave the arm/");
  const stepsReady = await waitForCondition("document.querySelectorAll('.lesson-step').length >= 2", 5000);
  const stepCount = await page.evaluate("document.querySelectorAll('.lesson-step').length");
  check("opening a lesson shows its steps", stepsReady, `${stepCount} steps`);

  await page.click(".try-button");
  const trySwitchedRobotAndTab = await waitForCondition(
    `(() => {
      const robot = document.querySelector('.robot.selectable.active')?.textContent ?? '';
      const tab = document.querySelector('.code-tab.active')?.textContent ?? '';
      return robot.includes('Arm') && tab === 'Python';
    })()`,
    5000,
  );
  check('"Try this" on an arm lesson switches to Arm and the Python tab', trySwitchedRobotAndTab);

  const triedCodeReady = await waitForCondition(`/arm\\.move\\(/.test(${PYTHON_EDITOR_TEXT_EXPR})`, 5000);
  const triedCode = (await pythonEditorText()) ?? "";
  check('"Try this" loads real runnable code into the editor', triedCodeReady, triedCode.slice(0, 60));
} catch (error) {
  console.error("e2e check threw:", error);
  failures.push(String(error));
}

page.close();
console.log(failures.length === 0 ? "STUDIO E2E: ALL CHECKS PASSED" : `STUDIO E2E FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
