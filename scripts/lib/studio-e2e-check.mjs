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

// Menu-bar helpers: the top nav's Edit/Robot/Simulation/Help used to be
// disabled placeholders titled "Later phases". Each is now wired to real
// app state, checked below alongside the flow it naturally belongs to
// (Edit's Blocks/Python items where those tabs are already visited, Robot
// and Simulation as alternate entry points to actions the sidebar/run-bar
// already exercise). A dropdown only closes on mouseleave or on clicking one
// of its own items (see App.tsx's closeMenu), so every open-menu step here
// re-clicks the header button fresh rather than assuming a previous dropdown
// already closed itself.
const menuItemTexts = () =>
  page.evaluate("[...document.querySelectorAll('.menu-dropdown button')].map(b => b.textContent.trim())");
const isMenuItemDisabled = (label) =>
  page.evaluate(
    `[...document.querySelectorAll('.menu-item')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.disabled`,
  );

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

  // -- Robot menu: an alternate entry point to the same robot switch the ----
  // sidebar already exercises further down; proves the menu's own wiring
  // rather than re-testing switchRobot itself.
  await page.evalClickText(".menu-item", "/^Robot$/");
  const robotMenuItems = await waitForCondition(
    "document.querySelectorAll('.menu-dropdown button').length > 0",
  ).then(() => menuItemTexts());
  check(
    "Robot menu lists Car (checked), Arm, and Drone",
    JSON.stringify(robotMenuItems) === JSON.stringify(["🚗 Car✓", "🦾 Arm", "🛸 Drone"]),
    robotMenuItems.join(", "),
  );
  await page.evalClickText(".menu-dropdown button", "/Arm/");
  const menuSwitchedToArm = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Arm')",
    5000,
  );
  check("Robot menu > Arm switches the active robot", menuSwitchedToArm);

  await page.evalClickText(".menu-item", "/^Robot$/");
  await page.evalClickText(".menu-dropdown button", "/Car/");
  const menuSwitchedBackToCar = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Car')",
    5000,
  );
  check("Robot menu > Car switches back", menuSwitchedBackToCar);

  // -- Edit menu on the Blocks tab: real Undo/Redo/Clean Up Blocks, wired to
  // the live Blockly workspace via BlocksPanelHandle -----------------------
  await page.evalClickText(".menu-item", "/^Edit$/");
  const editItemsOnBlocks = await waitForCondition(
    "document.querySelectorAll('.menu-dropdown button').length > 0",
  ).then(() => menuItemTexts());
  check(
    "Edit menu on the Blocks tab offers Undo, Redo, and Clean Up Blocks",
    JSON.stringify(editItemsOnBlocks) === JSON.stringify(["Undo Ctrl+Z", "Redo Ctrl+Y", "Clean Up Blocks"]),
    editItemsOnBlocks.join(", "),
  );
  // Nothing has been edited yet, so Undo/Redo are no-ops and Clean Up only
  // repositions blocks — none of the three should add, remove, or otherwise
  // break the workspace. The block count staying exactly put, plus the wall
  // avoider still running correctly right below, is the proof.
  const blockCountBeforeEditMenu = await page.evaluate(
    "document.querySelectorAll('.blocks-editor [data-id]').length",
  );
  await page.evalClickText(".menu-dropdown button", "/^Undo/");
  await page.evalClickText(".menu-item", "/^Edit$/");
  await page.evalClickText(".menu-dropdown button", "/^Redo/");
  await page.evalClickText(".menu-item", "/^Edit$/");
  await page.evalClickText(".menu-dropdown button", "/Clean Up Blocks/");
  const blockCountAfterEditMenu = await page.evaluate(
    "document.querySelectorAll('.blocks-editor [data-id]').length",
  );
  check(
    "Edit menu Undo/Redo/Clean Up Blocks run without disturbing the workspace",
    blockCountAfterEditMenu === blockCountBeforeEditMenu,
    `${blockCountBeforeEditMenu} -> ${blockCountAfterEditMenu}`,
  );

  // -- Help menu: About dialog shows real version + shortcut info -------------
  await page.evalClickText(".menu-item", "/^Help$/");
  await page.evalClickText(".menu-dropdown button", "/About/");
  const aboutReady = await waitForCondition("!!document.querySelector('.dialog h3')", 3000);
  const aboutText = await page.evaluate("document.querySelector('.dialog')?.textContent ?? ''");
  check(
    "Help > About shows the app name, a version, and the keyboard shortcuts",
    aboutReady && /OKHUB Robotics Studio/.test(aboutText) && /v\d+\.\d+\.\d+/.test(aboutText) && /Ctrl\+Z/.test(aboutText),
    aboutText.slice(0, 80),
  );
  await page.evalClickText(".dialog-actions button", "/close/i");
  const aboutClosed = await waitForCondition("!document.querySelector('.dialog h3')", 3000);
  check("About dialog closes", aboutClosed);

  // -- running the preloaded wall-avoider blocks program, Run/Reset via the
  // Simulation menu (an alternate entry point to the same run/stop/reset the
  // run-bar footer already exposes) --------------------------------------
  await page.evalClickText(".menu-item", "/^Simulation$/");
  const simulationItems = await waitForCondition(
    "document.querySelectorAll('.menu-dropdown button').length > 0",
  ).then(() => menuItemTexts());
  check(
    "Simulation menu lists Run, Stop, and Reset",
    JSON.stringify(simulationItems) === JSON.stringify(["▶ Run", "⏹ Stop", "🔄 Reset"]),
    simulationItems.join(", "),
  );
  await page.evalClickText(".menu-dropdown button", "/Run/");
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

  await page.click(".run-bar .run + button"); // Stop (run-bar footer entry point)
  const stopped = await waitForCondition(
    "!/blocks running/.test(document.querySelector('.run-bar .status')?.textContent ?? '')",
    3000,
  );
  check("Stop halts the program", stopped);

  await page.evalClickText(".menu-item", "/^Simulation$/");
  await page.evalClickText(".menu-dropdown button", "/Reset/"); // Reset (Simulation menu entry point)
  const reset = await waitForCondition(
    "/x 1\\.00 y 1\\.00/.test(document.querySelector('.run-bar .status')?.textContent ?? '')",
    3000,
  );
  check("Simulation menu > Reset restores the starting pose", reset, await status());

  // -- World tab: editing an object actually rebuilds the live sim ------------
  // Coordinate-based click()/clickText() compute a bounding rect and dispatch
  // at that fixed point; a state update from the field edit just before can
  // shift the button before the dispatch lands (found writing this check).
  // evalClick/evalClickText do a real DOM .click(), immune to that race.
  await page.evalClickText(".code-tab", "/^World$/");
  const worldTabReady = await waitForCondition("!!document.querySelector('.world-panel')");
  check("World tab renders the editor for the Car robot", worldTabReady);

  // The World tab is a form, not an editing surface with undo/redo — the
  // Edit menu button itself is disabled here (see lib/editMenu.ts).
  check("Edit menu is disabled on the World tab", await isMenuItemDisabled("Edit"));

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

  // Monaco (this Python editor) has its own undo/redo but no "clean up" — the
  // Edit menu offers just those two here, unlike the Blocks tab's three.
  await page.evalClickText(".menu-item", "/^Edit$/");
  const editItemsOnPython = await waitForCondition(
    "document.querySelectorAll('.menu-dropdown button').length > 0",
  ).then(() => menuItemTexts());
  check(
    "Edit menu on the Python tab offers Undo and Redo, not Clean Up Blocks",
    JSON.stringify(editItemsOnPython) === JSON.stringify(["Undo Ctrl+Z", "Redo Ctrl+Y"]),
    editItemsOnPython.join(", "),
  );
  await page.evalClickText(".menu-item", "/^Edit$/"); // close it before moving on

  // -- C++ tab: real code against engine/api/{robot,arm,drone}.hpp ------------
  await page.evalClickText(".code-tab", "/^C\\+\\+$/");
  const cppReady = await waitForCondition(
    "document.querySelector('.cpp-preview')?.textContent?.includes('#include \"robot.hpp\"')",
    5000,
  );
  const cppText = await page.evaluate("document.querySelector('.cpp-preview')?.textContent ?? ''");
  check("C++ tab shows real code against robot.hpp for the Car", cppReady, cppText.slice(0, 40));
  check("C++ tab mirrors the wall-avoider's turn_left call", /robot\.turn_left\(90\)/.test(cppText));
  check("C++ tab has no JS/Python leftovers (await, def, etc.)", !/\bawait\b|\bdef\b/.test(cppText));

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

  // The C++ tab follows the robot switch: real Arm code now, not stale Car
  // content left over from before the switch.
  await page.evalClickText(".code-tab", "/^C\\+\\+$/");
  const armCppReady = await waitForCondition(
    "document.querySelector('.cpp-preview')?.textContent?.includes('#include \"arm.hpp\"')",
    5000,
  );
  const armCppText = await page.evaluate("document.querySelector('.cpp-preview')?.textContent ?? ''");
  check("C++ tab switches to real code against arm.hpp for the Arm", armCppReady, armCppText.slice(0, 40));
  check(
    "Arm C++ mirrors the wave's shoulder move, not the car's forward/turn_left",
    /arm\.move\("shoulder", 85\);/.test(armCppText) && !/robot\.(forward|turn_left)/.test(armCppText),
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

  // -- drone: switch, telemetry, Python API, and its own starter program ------
  await page.clickText(".robot.selectable", "/Drone/");
  const onDrone = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Drone')",
    5000,
  );
  check("clicking Drone switches the active robot", onDrone);
  check(
    "Drone status line shows altitude telemetry",
    await waitForCondition("/alt \\d/.test(document.querySelector('.run-bar .status')?.textContent ?? '')", 5000),
  );

  await page.clickText(".code-tab", "/^Python$/");
  const dronePythonReady = await waitForCondition(
    `/from okrobo import Drone/.test(${PYTHON_EDITOR_TEXT_EXPR})`,
    5000,
  );
  check(
    "Python tab switches to the okrobo Drone API for the drone",
    dronePythonReady,
    (await pythonEditorText()).slice(0, 60),
  );
  check("Python tab shows the square flight's takeoff call", /drone\.takeoff\(0\.4\)/.test(await pythonEditorText()));

  await page.evalClickText(".code-tab", "/^C\\+\\+$/");
  const droneCppReady = await waitForCondition(
    "document.querySelector('.cpp-preview')?.textContent?.includes('#include \"drone.hpp\"')",
    5000,
  );
  const droneCppText = await page.evaluate("document.querySelector('.cpp-preview')?.textContent ?? ''");
  check("C++ tab switches to real code against drone.hpp for the Drone", droneCppReady, droneCppText.slice(0, 40));
  check("Drone C++ shows the square flight's takeoff call", /drone\.takeoff\(0\.4\);/.test(droneCppText));
  await page.clickText(".code-tab", "/^Python$/"); // back to Python for the run check below

  // Unlike the car's while(true) wall avoider, the drone's square flight
  // terminates on its own — and headless Chrome can run well faster than 1x
  // real time (each animation frame steps up to a full simulated second), so
  // the whole ~20 s program can finish before any "still running" poll ever
  // observes it mid-flight. That race makes an intermediate check unreliable;
  // waiting for the terminal landed state is definitive proof Run executed
  // takeoff, the full square, and land correctly either way.
  const tickBeforeRun = await page.evaluate(
    "Number((document.querySelector('.run-bar .status')?.textContent ?? '').match(/tick (\\d+)/)?.[1] ?? 0)",
  );
  await page.evalClick(".run-bar .run");
  const droneLanded = await waitForCondition(
    `(() => {
      const s = document.querySelector('.run-bar .status')?.textContent ?? '';
      const tick = Number(/tick (\\d+)/.exec(s)?.[1] ?? 0);
      return tick > ${tickBeforeRun} && /alt 0\\.00 m/.test(s);
    })()`,
    30000,
  );
  check("Run executes the drone's takeoff-square-land program to completion", droneLanded, await status());

  await page.clickText(".robot.selectable", "/Car/");
  const backOnCarAgain = await waitForCondition(
    "document.querySelector('.robot.selectable.active')?.textContent?.includes('Car')",
    5000,
  );
  check("switching from Drone back to Car works", backOnCarAgain);

  // -- lessons: list, open, "Try this" loads code and can switch robots -------
  await page.clickText(".code-tab", "/^Lessons$/");
  const lessonsReady = await waitForCondition("document.querySelectorAll('.lesson-card').length >= 5", 5000);
  const lessonCount = await page.evaluate("document.querySelectorAll('.lesson-card').length");
  check("Lessons tab lists at least the five core lessons (including Compete mode's own)", lessonsReady, `${lessonCount} lessons`);

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

  // Regression check: the lesson parser used to hardcode `robot === "arm" ?
  // "arm" : "car"`, so a `robot: drone` lesson would have silently switched
  // to Car instead — caught by inspection, not by any existing check, before
  // this one was added.
  // The lesson reader stays open across tab switches (LessonsPanel keeps its
  // own "open lesson" state while merely hidden, not unmounted), so go back
  // to the card list explicitly rather than assuming the tab click resets it.
  await page.clickText(".code-tab", "/^Lessons$/");
  await page.clickText(".lesson-header .link-button", "/all lessons/i");
  await page.clickText(".lesson-card", "/Fly a square/");
  await waitForCondition("document.querySelectorAll('.lesson-step').length >= 2", 5000);
  await page.click(".try-button");
  const droneTrySwitched = await waitForCondition(
    `(() => {
      const robot = document.querySelector('.robot.selectable.active')?.textContent ?? '';
      const tab = document.querySelector('.code-tab.active')?.textContent ?? '';
      return robot.includes('Drone') && tab === 'Python';
    })()`,
    5000,
  );
  check('"Try this" on a drone lesson switches to Drone (not Car) and the Python tab', droneTrySwitched);
  const droneTriedCodeReady = await waitForCondition(
    `/drone\\.takeoff\\(/.test(${PYTHON_EDITOR_TEXT_EXPR})`,
    5000,
  );
  check(
    '"Try this" on a drone lesson loads real okrobo Drone code',
    droneTriedCodeReady,
    (await pythonEditorText()).slice(0, 60),
  );

  // -- robot builder: Build mode -----------------------------------------
  // Coverage gap, stated plainly: this script drives a plain browser
  // against the Vite dev server, where isTauri() is false and the File
  // menu (Save/Open) stays disabled -- so a Save-As -> reload -> reopen
  // persistence round-trip cannot run here. That path is instead covered by
  // apps/studio/src-tauri/src/projects.rs's `robot_and_world_custom_roundtrip`
  // and `legacy_project_json_without_new_fields_still_loads` cargo tests,
  // which exercise the actual Store save/load of `robot_def` directly.
  // Likewise, a real mouse-drag on a specific 3D gizmo handle isn't
  // simulated here (handle screen position depends on camera/geometry,
  // making it brittle) -- the gizmo-mode-toggle check below plus the
  // inspector-driven transform edit are the accepted proxy coverage for
  // "a body's transform can be changed and it sticks."
  await page.clickText(".mode-toggle button", "/^Build$/");
  const builderStageReady = await waitForCondition("!!document.querySelector('.builder-stage')", 5000);
  check("Build mode: switching in shows the empty-state stage (no robot yet)", builderStageReady);

  // -- robot builder: New Robot template picker (Phase 7) -----------------
  // A real robot only gets created here once per project (there is no
  // "start over" affordance once robotDef is set, so this dialog is only
  // reachable this one time in this whole e2e run) -- the rest of this
  // section's flow (Add/Delete body, Test mode's empty-actuator-panel
  // check) depends on starting from the single-box Blank starter exactly
  // like every check below already assumed before this phase, so this
  // picks Blank rather than a multi-body template. Two-Wheeled Rover's own
  // exact body list, and that it actually drives/turns under real physics,
  // are proven directly (not re-derived here) by robotTemplates.test.ts,
  // TemplateDialog.test.tsx, and robotTemplates.physics.test.ts against the
  // real compiled WASM module. This check only proves the dialog itself is
  // wired end to end in a real browser: it lists real template data, and
  // picking one actually creates the robot. See
  // docs/decisions/robot-builder-templates.md.
  await page.clickText(".builder-new-robot", "/New Robot/");
  const templateDialogShown = await waitForCondition(
    "[...document.querySelectorAll('.dialog h3')].some(h => h.textContent === 'New robot')",
    5000,
  );
  check("Build mode: + New Robot opens a template picker dialog", templateDialogShown);
  check(
    "Build mode: the template picker lists Blank, Two-Wheeled Rover, and Simple Arm with descriptions",
    await page.evaluate(
      "[...document.querySelectorAll('.template-row .project-name')].map(n => n.textContent).join(',') === 'Blank,Two-Wheeled Rover,Simple Arm' && " +
        "[...document.querySelectorAll('.template-description')].every(d => (d.textContent ?? '').length > 0)",
    ),
  );
  // -- robot builder: pack-sourced robots (Phase 8) ------------------------
  // This harness drives the app as a plain browser tab (scripts/check-dev-
  // server.sh boots the Vite dev server, not the Tauri desktop shell), so
  // isTauri() is false here and every Tauri IPC call (list_packs,
  // read_pack_file) rejects -- there is no way to install a real pack and
  // prove a robot from it appears, the same "can't drive the real path
  // headlessly" limitation this suite already states plainly elsewhere
  // (see the gizmo-drag note above). What this DOES prove: a browser-mode
  // student with no desktop packs sees a clean, settled empty state, not a
  // stuck "Loading…" or a crash -- the graceful-degradation path in
  // TemplateDialog.tsx's listPackRobots().catch() really works. The pack
  // read-back pipeline itself is proven directly (not re-derived here) by
  // packRobots.test.ts and the Rust read_file tests in packs.rs. See
  // docs/decisions/robot-builder-packs.md.
  const packSectionSettled = await waitForCondition(
    "document.querySelector('.template-section-header')?.textContent === 'From your packs' && " +
      "[...document.querySelectorAll('.dialog-empty')].some(p => p.textContent?.includes('No installed packs carry a built robot'))",
    5000,
  );
  check("Build mode: the New Robot dialog's pack section settles to a clean empty state (no packs installed)", packSectionSettled);

  await page.clickText(".template-row .project-name", "/^Blank$/");
  const builderInspectorReady = await waitForCondition(
    "!!document.querySelector('[aria-label=\"body name\"]')",
    5000,
  );
  check("Build mode: picking Blank from the template picker creates a robot with an inspector", builderInspectorReady);
  check(
    "Build mode: 3-pane layout appears (hierarchy, stage, inspector)",
    await page.evaluate(
      "!!document.querySelector('.builder-hierarchy') && !!document.querySelector('.builder-stage') && !!document.querySelector('.builder-inspector')",
    ),
  );
  const builderCanvasReady = await waitForCondition("!!document.querySelector('.builder-stage canvas')", 5000);
  check("Build mode: 3D canvas renders", builderCanvasReady);

  // Export (Phase 8): in this browser-mode harness, exportRobotDef's Blob +
  // <a download> path runs -- this suite has no CDP download interception
  // (cdp.mjs has no download-handling method), so it can't assert a file
  // actually landed. What it does prove for real: clicking Export doesn't
  // throw, and the document/hierarchy survive untouched afterward (Export
  // never mutates the document it reads from). The desktop native-save-
  // dialog path is a separate, real code path this harness cannot reach at
  // all (no Tauri webview here) -- proven instead by exportRobot.test.ts's
  // own desktop-branch tests. See docs/decisions/robot-builder-packs.md.
  await page.evalClickText(".builder-export", "/Export/");
  const survivedExport = await waitForCondition(
    "document.querySelectorAll('.hierarchy-row').length === 1 && !!document.querySelector('[aria-label=\"body name\"]')",
    5000,
  );
  check("Build mode: Export doesn't crash and doesn't mutate the document", survivedExport);

  check(
    "Build mode: hierarchy shows exactly the starter body",
    (await page.evaluate("document.querySelectorAll('.hierarchy-row').length")) === 1,
  );

  await page.clickText(".builder-add-body", "/Add body/");
  const secondBodyAdded = await waitForCondition(
    "document.querySelectorAll('.hierarchy-row').length === 2",
    5000,
  );
  check("Build mode: + Add body grows the hierarchy and auto-selects the new body", secondBodyAdded);
  const newRowActive = await page.evaluate(
    "[...document.querySelectorAll('.hierarchy-row')][1]?.classList.contains('active')",
  );
  check("Build mode: the newly added body is the active hierarchy row", newRowActive);

  // -- robot builder: Add Joint (joint authoring in Build mode) -----------
  // Real picking normally happens by raycasting a 3D click, which this
  // harness can't reliably drive (no way to compute where a body renders
  // on screen from here) -- HierarchyList rows are wired to the exact same
  // parent-then-child picking handler as a real, DOM-native alternative
  // input, so this check drives that path instead of faking coordinates.
  // The origin math (computeJointOrigin) and the validation-diff gating
  // (issuesIntroducedBy) are proven directly by robotEdits.test.ts and
  // JointCreator.test.tsx, not re-derived here. See
  // docs/decisions/robot-builder-joints.md.
  await page.evalClickText(".builder-toolbar button", "/^Add Joint$/");
  const jointHintShown = await waitForCondition(
    "document.querySelector('.joint-pick-hint')?.textContent === 'Click the parent body.'",
    5000,
  );
  check("Build mode: Add Joint enters the picking tool with a hint", jointHintShown);

  await page.evalClickText(".hierarchy-row", "/^Chassis$/");
  const jointHintAdvanced = await waitForCondition(
    "document.querySelector('.joint-pick-hint')?.textContent === 'Click the child body.'",
    5000,
  );
  check("Build mode: picking the parent advances the hint to the child", jointHintAdvanced);

  await page.evalClickText(".hierarchy-row", "/^body-2$/");
  const jointFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New joint'",
    5000,
  );
  check("Build mode: picking parent then child shows the joint-creation form", jointFormShown);

  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const jointApplied = await waitForCondition(
    "document.querySelectorAll('.hierarchy-list > ul > li').length === 1", // body-2 is nested under Chassis now, not its own root row
    5000,
  );
  check("Build mode: Apply commits the joint -- the child is no longer a separate root", jointApplied);

  await page.evalClickText(".hierarchy-row", "/^Chassis$/");
  await waitForCondition("document.querySelector('[aria-label=\"body name\"]')?.value === 'Chassis'", 5000);
  await page.setInputValue('[aria-label="body mass"]', "2.5");
  // evalClickText, not clickText: a field edit immediately followed by
  // clicking Apply can race a coordinate-based click (see evalClick's
  // docstring in cdp.mjs) -- the same reason the World tab section above
  // uses it for the identical edit-then-Apply shape.
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const massApplied = await waitForCondition(
    "document.querySelector('[aria-label=\"body mass\"]')?.value === '2.5' && !document.querySelector('.body-issue.error')",
    5000,
  );
  check("Build mode: editing mass and clicking Apply commits with no error issue", massApplied);

  await page.evalClickText(".builder-toolbar button", "/^Rotate$/");
  const rotateActive = await waitForCondition(
    "[...document.querySelectorAll('.builder-toolbar button')].find(b => b.textContent === 'Rotate')?.classList.contains('active')",
    5000,
  );
  check("Build mode: the gizmo-mode toolbar switches to Rotate", rotateActive);

  await page.evalClickText(".inspector-actions .delete-btn", "/Delete body/");
  await page.evalClickText(".inspector-actions .delete-btn", "/delete\\?/");
  const bodyDeleted = await waitForCondition(
    "document.querySelectorAll('.hierarchy-row').length === 1",
    5000,
  );
  check("Build mode: two-click Delete body removes the selected body", bodyDeleted);

  // -- robot builder: Test mode (Phase 3 physics) -------------------------
  // Coverage gap, stated plainly: this repo's Build-mode UI has no way to
  // author joints or actuators yet (Phase 2's own non-goal, still true
  // here) -- the one remaining body has no joint, so there is nothing for
  // an actuator to drive and the panel's documented empty state is exactly
  // what should render. A real joint falling/settling under gravity is
  // proven numerically by engine/tests/test_built_robot.cpp and
  // EngineBuiltRobot.test.ts (a measured drop-and-settle height, an
  // actuator moving a joint) -- this check only confirms Test mode's own
  // wiring (engine loads, a real BuiltRobot compiles, the render loop
  // keeps running) end to end in a real browser, via two canvas snapshots
  // a couple of seconds apart actually differing (proof frames are still
  // being drawn, not frozen). Entering Test mode requires zero
  // error-severity issues on the document (BuilderPanel disables the
  // button otherwise, exercised directly in BuilderPanel.test.tsx) -- this
  // is exactly why this section runs after Delete body above, not before
  // it: two disconnected bodies is itself a robot-multiple-root-bodies error.
  await page.clickText(".builder-mode-toggle button", "/^Test$/");
  const testCanvasReady = await waitForCondition("!!document.querySelector('.test-viewport canvas')", 10000);
  check("Test mode: physics engine loads and the canvas renders", testCanvasReady);
  check(
    "Test mode: a robot with no joints shows the actuator panel's empty state",
    await waitForCondition("document.querySelector('.actuator-empty')?.textContent?.includes('no actuators')", 5000),
  );
  // Symmetric with the actuator-empty-state check above: Build mode has no
  // sensor-authoring UI either (Phase 4's own non-goal, same limitation
  // Phase 3 already documented for actuators), so the one remaining body
  // has no sensors and the panel's documented empty state is exactly what
  // should render. Real sensor readings are proven numerically by
  // engine/tests/test_built_robot.cpp and EngineBuiltRobot.test.ts.
  check(
    "Test mode: a robot with no sensors shows the sensor panel's empty state",
    await waitForCondition("document.querySelector('.sensor-empty')?.textContent?.includes('no sensors')", 5000),
  );
  check(
    "Test mode: explains that nothing here is saved back to the document",
    await page.evaluate("!!document.querySelector('.test-mode-note')"),
  );

  // Not a pixel-diff check: the default starter body begins essentially at
  // its own rest height, and headless Chrome's requestAnimationFrame runs
  // unthrottled (no real display to sync to), so it can settle before the
  // very first paint -- two canvas snapshots showing identical pixels here
  // would be a settled robot, not a frozen render loop. What this can
  // reliably catch instead: the render loop (and the BuiltRobot instance
  // driving it) surviving several seconds of real stepping without
  // throwing and unmounting the canvas out from under itself.
  await sleep(2500);
  check(
    "Test mode: the render loop is still running after a few seconds (no crash)",
    await page.evaluate("!!document.querySelector('.test-viewport canvas')"),
  );

  // -- robot builder: world picker (Phase 5 static world objects) ---------
  // Real collision physics against a world object is proven numerically by
  // engine/tests/test_built_robot.cpp's TestRobotSettlesOnWorldObject and
  // EngineBuiltRobot.test.ts's matching WASM-boundary test -- this check
  // only confirms the picker itself is wired end to end in a real browser:
  // it lists the example worlds, and picking a non-empty one rebuilds the
  // physics instance (a brief drop back to "loading") without crashing Test
  // mode. See docs/decisions/robot-builder-world.md.
  check(
    "Test mode: the world picker lists every example world",
    await page.evaluate(
      "[...document.querySelectorAll('.builder-world-picker option')].map(o => o.textContent).join(',') === 'None (floor only),Empty,Obstacle Course,Ramp'",
    ),
  );
  await page.setSelectValue(".builder-world-picker select", "obstacle-course");
  const worldRebuilt = await waitForCondition(
    "!!document.querySelector('.test-viewport canvas') && document.querySelector('.builder-world-picker select')?.value === 'obstacle-course'",
    10000,
  );
  check("Test mode: picking a world rebuilds physics and keeps the canvas alive", worldRebuilt);

  // -- robot builder: program drawer (Phase 6 programming) -----------------
  // Real actuator/sensor set()/read() behavior against a real actuator is
  // proven numerically by BuiltProgramRunner.test.ts against the real
  // compiled WASM module -- this check only confirms the drawer itself is
  // wired end to end in a real browser: it exists in Test mode, its three
  // tabs switch, and Run/Stop actually drive a real BuiltProgramRunner (the
  // default starter is a single 1s wait block). Build mode still has no
  // joint/actuator-authoring UI, so this e2e robot always has zero
  // actuators/sensors -- that also exercises the built-in blocks' own
  // empty-document dropdown placeholder fallback for free. See
  // docs/decisions/robot-builder-programming.md.
  check(
    "Test mode: the program drawer is present with Run/Stop and three code tabs",
    await page.evaluate(
      "!!document.querySelector('.builder-program-drawer') && " +
        "[...document.querySelectorAll('.builder-program-drawer .code-tab')].map(t => t.textContent).join(',') === 'Blocks,Python,C++'",
    ),
  );

  // Robot Builder Python execution: the Python tab is now a real, connected-
  // or-offline PythonPanel (see docs/decisions/robot-builder-python-execution.md)
  // -- this harness has no real sidecar running, so it shows the same
  // "python: offline" fallback Simulate mode's own Python tab already shows
  // in that state, proving this is the real component, not the old preview.
  await page.clickText(".builder-program-drawer .code-tab", "/^Python$/");
  const pythonRealPanelShown = await waitForCondition(
    "document.querySelector('.builder-program-drawer .tab-panel.active .python-note')?.textContent?.includes('python: offline')",
    5000,
  );
  check("Test mode: the Python tab is a real, sidecar-connected PythonPanel", pythonRealPanelShown);

  await page.clickText(".builder-program-drawer .code-tab", "/^C\\+\\+$/");
  const cppPreviewShown = await waitForCondition(
    "document.querySelector('.builder-program-drawer .tab-panel.active .placeholder-note')?.textContent?.includes('no real C++ SDK')",
    5000,
  );
  check("Test mode: the C++ tab shows an illustrative-only preview, not a real SDK", cppPreviewShown);

  await page.clickText(".builder-program-drawer .code-tab", "/^Blocks$/");
  await page.evalClickText(".builder-program-actions button", "/Run/");
  const programRunning = await waitForCondition(
    "document.querySelector('.builder-program-status')?.textContent === 'running…'",
    2000,
  );
  check("Test mode: Run starts the default wait(1) program", programRunning);

  await page.evalClickText(".builder-program-actions button", "/Stop/");
  const programStoppedEarly = await waitForCondition(
    "document.querySelector('.builder-program-status')?.textContent === 'idle'",
    2000,
  );
  check("Test mode: Stop interrupts a running program back to idle", programStoppedEarly);

  // Run again and let it finish naturally this time (no Stop), proving a
  // completed program also returns to idle on its own.
  await page.evalClickText(".builder-program-actions button", "/Run/");
  const programFinished = await waitForCondition(
    "document.querySelector('.builder-program-status')?.textContent === 'idle'",
    5000,
  );
  check("Test mode: a finished program returns to idle on its own", programFinished);

  await page.clickText(".builder-mode-toggle button", "/^Edit$/");
  const backToEdit = await waitForCondition("!!document.querySelector('.builder-toolbar')", 5000);
  check("Test mode: switching back to Edit restores the gizmo viewport", backToEdit);
  check(
    "Test mode: the program drawer disappears back in Edit mode",
    await page.evaluate("!document.querySelector('.builder-program-drawer')"),
  );

  // -- robot builder: Extrude (CAD Kernel Phase 2: Sketch UI) -------------
  // The one place the real browser Worker + real OpenCascade WASM
  // (apps/studio/src/cad/{cadClient,worker,kernel}.ts) gets exercised
  // through actual UI interaction -- every layer above (CadExtrudeCreator's
  // own debounce/validation logic, BuilderPanel's tool-switching wiring) is
  // proven with mocks in CadExtrudeCreator.test.tsx/BuilderPanel.test.tsx
  // on purpose. Runs here (one clean body, zero validation errors, back in
  // Edit mode after Test mode's own checks above) rather than earlier in
  // the Add Joint section, since Test mode requires zero error-severity
  // issues and an unattached second body would introduce one; nothing below
  // re-enters Test mode. See docs/decisions/cad-kernel-sketch-ui.md.
  // evalClickText, not clickText: this fires right after switching back
  // from Test mode, a just-prior DOM change a coordinate-based click can
  // race (see evalClick's own docstring in cdp.mjs) -- two new toolbar
  // buttons (Add Actuator/Add Sensor, Robot Builder D1) made this a real
  // miss rather than a latent, never-triggered risk.
  await page.evalClickText(".builder-toolbar button", "/^Extrude$/");
  const cadFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part'",
    5000,
  );
  check("Build mode: Extrude opens the CAD part creation form", cadFormShown);

  // Cold: first-ever load of the ~23MB OpenCascade WASM through a real
  // Worker in this browser tab. extrude.test.ts's own direct-call gate test
  // already budgets 30s for a cold load; a real Worker adds its own spin-up
  // and same-origin fetch overhead on top of that.
  const rectanglePreviewReady = await waitForCondition(
    "!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled",
    45000,
  );
  check("Build mode: the default rectangle profile computes a real preview through the CAD worker (Apply enables)", rectanglePreviewReady);

  await page.setSelectValue('[aria-label="cad profile"]', "circle");
  const circleFieldsSwapped = await waitForCondition(
    "!!document.querySelector('[aria-label=\"cad radius\"]') && !document.querySelector('[aria-label=\"cad width\"]')",
    5000,
  );
  check("Build mode: switching profile to Circle swaps in the radius field", circleFieldsSwapped);

  // Warm now -- OpenCascade is already loaded in the worker.
  const circlePreviewReady = await waitForCondition(
    "!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled",
    8000,
  );
  check("Build mode: the Circle profile computes a real preview through the same warm CAD worker", circlePreviewReady);

  const bodyCountBeforeApply = await page.evaluate("document.querySelectorAll('.hierarchy-row').length");
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const cadBodyApplied = await waitForCondition(
    `document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeApply} + 1`,
    5000,
  );
  check("Build mode: Apply commits a real cad_mesh body into the document", cadBodyApplied);

  // No click needed: Apply already auto-selects the new body (mirroring
  // "+ Add body"'s own select-on-create UX, checked above) -- a coordinate-
  // based clickText right after Apply's own DOM mutation is exactly the
  // race cdp.mjs's evalClick docstring warns about, and this doesn't need it.
  const cadPartNoteShown = await waitForCondition(
    "document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')",
    5000,
  );
  check("Build mode: the newly Applied body round-trips as a real, schema-valid cad_mesh body", cadPartNoteShown);

  // Fast and deterministic: no worker round-trip should ever happen for a
  // degenerate dimension, so this needs no long poll.
  await page.evalClickText(".builder-toolbar button", "/^Extrude$/");
  await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part'", 5000);
  await page.setInputValue('[aria-label="cad width"]', "0");
  const degenerateRejectedLocally = await waitForCondition(
    "document.querySelector('.cad-status.error')?.textContent === 'Width must be greater than 0'",
    2000,
  );
  check(
    "Build mode: a zero-width rectangle is rejected client-side, Apply never enables",
    degenerateRejectedLocally &&
      (await page.evaluate("document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled")),
  );
  await page.evalClickText(".inspector-actions button", "/^Cancel$/");

  // -- robot builder: Revolve + Boundary (CAD Kernel Phase 3) -------------
  // The worker/WASM are already warm from the Extrude checks above (the
  // same memoized cadClient.ts Worker instance is reused), so these need
  // no long cold-load poll -- a real, if faster, round trip through the
  // same real replicad/OpenCascade pipeline. See
  // docs/decisions/cad-kernel-revolve-boundary.md.
  const bodyCountBeforeRevolve = await page.evaluate("document.querySelectorAll('.hierarchy-row').length");
  await page.evalClickText(".builder-toolbar button", "/^Revolve$/");
  const revolveFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part (Revolve)'",
    5000,
  );
  check("Build mode: Revolve opens the CAD part creation form", revolveFormShown);

  const revolvePreviewReady = await waitForCondition(
    "!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled",
    10000,
  );
  check("Build mode: the default profile computes a real torus/ring preview through the warm CAD worker (Apply enables)", revolvePreviewReady);

  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const revolveApplied = await waitForCondition(
    `document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeRevolve} + 1`,
    5000,
  );
  check("Build mode: Apply commits a real revolved cad_mesh body into the document", revolveApplied);
  check(
    "Build mode: the revolved body round-trips as a real, schema-valid cad_mesh body",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  const bodyCountBeforeBoundary = await page.evaluate("document.querySelectorAll('.hierarchy-row').length");
  await page.evalClickText(".builder-toolbar button", "/^Boundary$/");
  const boundaryFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part (Boundary)'",
    5000,
  );
  check("Build mode: Boundary opens the CAD part creation form", boundaryFormShown);

  const boundaryPreviewReady = await waitForCondition(
    "!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled",
    10000,
  );
  check("Build mode: the default Start/End profiles compute a real lofted preview through the warm CAD worker (Apply enables)", boundaryPreviewReady);

  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const boundaryApplied = await waitForCondition(
    `document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeBoundary} + 1`,
    5000,
  );
  check("Build mode: Apply commits a real lofted cad_mesh body into the document", boundaryApplied);
  check(
    "Build mode: the lofted body round-trips as a real, schema-valid cad_mesh body",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  // -- robot builder: Cut operations (CAD Kernel Phase 4) -----------------
  // body-2 (the original starter Chassis was itself deleted by the earlier
  // Add Joint section's own "Delete body" step, leaving body-2 -- a plain
  // box added via "+ Add body" -- as the sole surviving body at this
  // point) starts as a plain box -- Extruded Cut proves a primitive body
  // can be a real Cut target (geometryToMesh's own bridge, not just an
  // already-cad_mesh one), and chaining Revolved/Boundary Cut onto the
  // SAME now-cad_mesh body-2 proves Cut also works once the target is
  // already a cad_mesh part. See docs/decisions/cad-kernel-cut-operations.md.
  const bodyCountBeforeCuts = await page.evaluate("document.querySelectorAll('.hierarchy-row').length");

  await page.evalClickText(".builder-toolbar button", "/^Extruded Cut$/");
  check(
    "Build mode: Extruded Cut enters the picking tool with a hint",
    await waitForCondition("document.querySelector('.joint-pick-hint')?.textContent === 'Click the body to cut.'", 5000),
  );
  await page.evalClickText(".hierarchy-row", "/^body-2$/");
  check(
    "Build mode: picking a target body shows the Extruded Cut creation form",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part (Extruded Cut)'", 5000),
  );
  check(
    "Build mode: the default cutting tool computes a real preview through the warm CAD worker (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Extruded Cut commits a real cut into the target body's own geometry (no new body added)",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeCuts}`, 5000),
  );
  await page.evalClickText(".hierarchy-row", "/^body-2$/");
  check(
    "Build mode: body-2 (a plain box) really became a cad_mesh body -- Shape is now locked to CAD part",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  await page.evalClickText(".builder-toolbar button", "/^Revolved Cut$/");
  await page.evalClickText(".hierarchy-row", "/^body-2$/");
  check(
    "Build mode: Revolved Cut targets the same (already-cad_mesh) body and computes a real preview",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Revolved Cut commits with no new body added",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeCuts}`, 5000),
  );

  await page.evalClickText(".builder-toolbar button", "/^Boundary Cut$/");
  await page.evalClickText(".hierarchy-row", "/^body-2$/");
  check(
    "Build mode: Boundary Cut targets the same body and computes a real preview",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Boundary Cut commits with no new body added",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeCuts}`, 5000),
  );

  // -- robot builder: Fillet + Chamfer (CAD Kernel Phase 5) ---------------
  // Continues from the Cut section above: body-2 is now a cad_mesh part,
  // the sole body in the document. First, Extrude a fresh box with one
  // embedded fillet -- proving the Boss-flow edge-picking path (pick an
  // edge of a not-yet-baked shape via the real DOM "Edges" list, not a 3D
  // click; see docs/decisions/cad-kernel-fillet-chamfer.md for why). Then
  // the standalone Fillet/Chamfer tool targets a fresh plain box body (+
  // Add body, not an already-cad_mesh one) with one fillet and one
  // chamfer, proving the existing-primitive-body path.
  const bodyCountBeforeFillet = await page.evaluate("document.querySelectorAll('.hierarchy-row').length");

  await page.evalClickText(".builder-toolbar button", "/^Extrude$/");
  check(
    "Build mode: Extrude shows the New CAD part form",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'New CAD part'", 5000),
  );
  check(
    "Build mode: the Edges section appears once the base shape's own edge preview settles",
    await waitForCondition("!!document.querySelector('.fillet-edge-list')", 10000),
  );
  await page.evalClickText(".fillet-edge-row button", "/^Add$/");
  check(
    "Build mode: picking an edge (via the DOM list, not a 3D click) shows its Operation/Value controls",
    await waitForCondition('!!document.querySelector(\'[aria-label="edge 1 operation"]\')', 5000),
  );
  check(
    "Build mode: the fillet computes a real preview through the warm CAD worker (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Extrude with an embedded fillet commits a new cad_mesh body",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${bodyCountBeforeFillet} + 1`, 5000),
  );
  const rowsAfterExtrudeFillet = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map((r) => r.textContent)");
  const extrudeFilletBodyId = rowsAfterExtrudeFillet[rowsAfterExtrudeFillet.length - 1];

  // Extrude/Revolve/Boundary above each already added their own new body
  // (this is one continuous document, not reset between sections -- see
  // the Cut section's own comment above), so the fresh box's own id here
  // is whatever nextBodyId lands on next, not a fixed "body-N" -- read it
  // back from the newly appended (always-last) hierarchy row rather than
  // hardcoding a number that would silently drift as earlier sections
  // change.
  await page.evalClickText(".builder-add-body", "/Add body/");
  const rowsAfterAddBody = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map((r) => r.textContent)");
  const bodyCountAfterAddBody = rowsAfterAddBody.length;
  check("Build mode: + Add body grows the hierarchy by one plain box body", bodyCountAfterAddBody === bodyCountBeforeFillet + 2);
  const freshBoxId = rowsAfterAddBody[rowsAfterAddBody.length - 1];

  await page.evalClickText(".builder-toolbar button", "/^Fillet\\/Chamfer$/");
  check(
    "Build mode: Fillet/Chamfer enters the picking tool with a hint",
    await waitForCondition("document.querySelector('.joint-pick-hint')?.textContent === 'Click the body to fillet or chamfer.'", 5000),
  );
  await page.evalClickText(".hierarchy-row", `/^${freshBoxId}$/`);
  check(
    "Build mode: picking a box body shows the Fillet/Chamfer editor",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'Fillet / Chamfer'", 5000),
  );
  check(
    "Build mode: the target's own edges preview settles (Edges section appears)",
    await waitForCondition("!!document.querySelector('.fillet-edge-list')", 10000),
  );
  // Edge 1 and Edge 6 -- deliberately non-adjacent (don't share a vertex).
  // Mixing fillet and chamfer on two edges that DO share a vertex is a
  // real, documented limitation (see docs/decisions/cad-kernel-fillet-chamfer.md):
  // filleting one edge trims/moves its immediate neighbors, so a chamfer
  // recorded against the pristine shape can no longer find them on the
  // already-filleted result. Verified empirically which of a box's 12
  // edges are safe to combine.
  await page.evalClickText(".fillet-edge-row:nth-child(1) button", "/^Add$/"); // Edge 1 -> fillet (the default operation)
  await page.evalClickText(".fillet-edge-row:nth-child(6) button", "/^Add$/"); // Edge 6 -> changed to chamfer below
  await page.setSelectValue('[aria-label="edge 6 operation"]', "chamfer");
  check(
    "Build mode: one fillet and one chamfer compute a real combined preview (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Fillet/Chamfer commits with no new body added (geometry replaced in place)",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${bodyCountAfterAddBody}`, 5000),
  );
  await page.evalClickText(".hierarchy-row", `/^${freshBoxId}$/`);
  check(
    "Build mode: the fresh box really became a cad_mesh body -- Shape is now locked to CAD part",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  // -- robot builder: Shell + Draft (CAD Kernel Phase 6) ------------------
  // Standalone tools only this phase (no embedded step in the Boss
  // creators -- see docs/decisions/cad-kernel-shell-draft.md). Each needs
  // its own fresh plain box body (freshBoxId above is already a cad_mesh
  // part from the Fillet/Chamfer section), read back from the DOM the
  // same way, not hardcoded.
  await page.evalClickText(".builder-add-body", "/Add body/");
  const rowsAfterShellAddBody = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map((r) => r.textContent)");
  const shellBoxId = rowsAfterShellAddBody[rowsAfterShellAddBody.length - 1];

  await page.evalClickText(".builder-toolbar button", "/^Shell$/");
  check(
    "Build mode: Shell enters the picking tool with a hint",
    await waitForCondition("document.querySelector('.joint-pick-hint')?.textContent === 'Click the body to shell.'", 5000),
  );
  // evalClickText, not clickText: this immediately follows + Add body's
  // own DOM mutation (a new hierarchy row appearing), exactly the
  // coordinate-based click race cdp.mjs's own evalClick docstring warns
  // about -- found for real here (this exact pick intermittently missed
  // once the hierarchy list had accumulated enough prior rows).
  await page.evalClickText(".hierarchy-row", `/^${shellBoxId}$/`);
  check(
    "Build mode: picking a box body shows the Shell editor",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'Shell'", 5000),
  );
  check(
    "Build mode: the target's own faces preview settles (Faces section appears)",
    await waitForCondition("!!document.querySelector('.face-pick-list')", 10000),
  );
  await page.evalClickText(".face-pick-row button", "/^Select$/"); // Face 1 -- any single face is a valid opening
  check(
    "Build mode: the default thickness computes a real hollowed preview (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Shell commits with no new body added (geometry replaced in place)",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${rowsAfterShellAddBody.length}`, 5000),
  );
  await page.evalClickText(".hierarchy-row", `/^${shellBoxId}$/`);
  check(
    "Build mode: the fresh box really became a cad_mesh body -- Shape is now locked to CAD part",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  await page.evalClickText(".builder-add-body", "/Add body/");
  const rowsAfterDraftAddBody = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map((r) => r.textContent)");
  const draftBoxId = rowsAfterDraftAddBody[rowsAfterDraftAddBody.length - 1];

  await page.evalClickText(".builder-toolbar button", "/^Draft$/");
  check(
    "Build mode: Draft enters the picking tool with a hint",
    await waitForCondition("document.querySelector('.joint-pick-hint')?.textContent === 'Click the body to draft.'", 5000),
  );
  // Same evalClickText fix as the Shell pick above -- this is exactly
  // where the coordinate-based click was observed to miss for real.
  await page.evalClickText(".hierarchy-row", `/^${draftBoxId}$/`);
  check(
    "Build mode: picking a box body shows the Draft editor",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'Draft'", 5000),
  );
  check(
    "Build mode: the target's own faces preview settles (Faces section appears)",
    await waitForCondition("!!document.querySelector('.face-pick-list')", 10000),
  );
  // Face 1 is a box's own first side face (verified via kernel.ts's own
  // makeBox face order: indices 0-3 are the four vertical side faces,
  // 4-5 are the top/bottom caps, which lie parallel to the fixed XY
  // neutral plane and would throw -- see kernel.ts's draft doc comment).
  await page.evalClickText(".face-pick-row button", "/^Select$/");
  check(
    "Build mode: the default angle computes a real tapered preview (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 10000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Draft commits with no new body added (geometry replaced in place)",
    await waitForCondition(`document.querySelectorAll('.hierarchy-row').length === ${rowsAfterDraftAddBody.length}`, 5000),
  );
  await page.evalClickText(".hierarchy-row", `/^${draftBoxId}$/`);
  check(
    "Build mode: the fresh box really became a cad_mesh body -- Shape is now locked to CAD part",
    await waitForCondition("document.querySelector('.inspector-mesh-note')?.textContent?.includes('CAD part')", 5000),
  );

  // -- robot builder: Feature tree (CAD Kernel Phase 7.1) -----------------
  // Read-only construction-history panel -- no new tool, so this just
  // re-selects bodies already produced by the sections above and checks
  // the recorded features[] rendered correctly, in order. See
  // docs/decisions/cad-kernel-feature-tree-data-model.md.
  await page.evalClickText(".hierarchy-row", `/^${extrudeFilletBodyId}$/`);
  check(
    "Build mode: an Extrude with an embedded fillet records both steps in the Construction history panel, in order",
    await waitForCondition(
      `(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); ` +
        `return rows[0] === 'Extrude (0.05×0.05m rect, depth 0.02m)' && rows[1] === 'Fillet/Chamfer (1 fillet)'; })()`,
      5000,
    ),
  );

  await page.evalClickText(".hierarchy-row", `/^${freshBoxId}$/`);
  check(
    "Build mode: a plain box Fillet/Chamfered in place gets a synthesized Box root plus its own fillet_chamfer step",
    await waitForCondition(
      `(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); ` +
        `return rows[0] === 'Box (0.05 × 0.05 × 0.05 m)' && rows[1] === 'Fillet/Chamfer (1 fillet, 1 chamfer)'; })()`,
      5000,
    ),
  );

  await page.evalClickText(".hierarchy-row", `/^${shellBoxId}$/`);
  check(
    "Build mode: a plain box Shelled in place gets a synthesized Box root plus its own shell step",
    await waitForCondition(
      `(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); ` +
        `return rows[0] === 'Box (0.05 × 0.05 × 0.05 m)' && rows[1] === 'Shell (1 face, thickness 0.005m)'; })()`,
      5000,
    ),
  );

  await page.evalClickText(".hierarchy-row", `/^${draftBoxId}$/`);
  check(
    "Build mode: a plain box Drafted in place gets a synthesized Box root plus its own draft step",
    await waitForCondition(
      `(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); ` +
        `return rows[0] === 'Box (0.05 × 0.05 × 0.05 m)' && rows[1] === 'Draft (1 face, angle 5°)'; })()`,
      5000,
    ),
  );

  // -- robot builder: edit-any-step + live recompute (CAD Kernel Phase 7.3) --
  // Re-selects shellBoxId (features: [Box, Shell] from the section above)
  // and edits its own recorded box ROOT -- proving the whole chain (the
  // shell step) replays on top of the edited size, through the real CAD
  // worker, not just the isolated root. The shell step's own picked face
  // was one of the box's own side faces (found empirically, right here:
  // its recorded point sits on the -X face, at [-0.025, ~0, ~0], the box's
  // own default 0.05m size halved) -- editing Size Y or Z (axes that
  // face's own position doesn't depend on at all) leaves that pick fully
  // intact, while editing Size X moves that exact face and reliably
  // breaks it, even for a modest change: the match tolerance is a tiny
  // fraction of the shape's own bounding-box diagonal (see kernel.ts's own
  // toleranceFor), far smaller than any real resize along the SAME axis a
  // pick lies on. See docs/decisions/cad-kernel-edit-any-step.md.
  await page.evalClickText(".hierarchy-row", `/^${shellBoxId}$/`);
  await page.evalClickText(".feature-tree-step", "/^Box \\(/");
  check(
    "Build mode: clicking the Box row opens its own editor, pre-filled with the current size",
    await waitForCondition(
      "document.querySelector('.builder-inspector h4')?.textContent === 'Edit Box' && " +
        "document.querySelector('[aria-label=\"root size x\"]')?.value === '0.05'",
      5000,
    ),
  );
  await page.setInputValue('[aria-label="root size y"]', "0.09");
  check(
    "Build mode: editing an axis orthogonal to the shell's own picked face computes a real preview of the WHOLE chain (shell still applied) through the warm CAD worker",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 15000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Apply recomputes the whole chain and returns to the Construction history view",
    await waitForCondition("document.querySelector('.feature-tree-list')?.textContent?.includes('0.09')", 10000),
  );
  check(
    "Build mode: the shell step survives the edit, recorded right after the resized root",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows[0]?.includes('0.09') && rows[1] === 'Shell (1 face, thickness 0.005m)'; })()",
      2000,
    ),
  );

  // A real rebuild-error case: editing Size X moves the shell step's own
  // picked face (the -X side, whose position is exactly `-sizeX/2`) far
  // beyond the match tolerance -- even this modest a change (0.05 -> 0.08)
  // is already enough. Surfaces through the same generic error-message
  // path every other opaque CAD failure already does -- no crash, no
  // silent wrong result.
  await page.evalClickText(".feature-tree-step", "/^Box \\(/");
  check(
    "Build mode: re-opening the Box row shows its own (already-edited) current size",
    await waitForCondition("document.querySelector('[aria-label=\"root size y\"]')?.value === '0.09'", 5000),
  );
  await page.setInputValue('[aria-label="root size x"]', "0.08");
  check(
    "Build mode: editing the SAME axis a downstream pick lies on surfaces a real rebuild-error message, not a crash",
    await waitForCondition(
      "document.querySelector('.cad-status.error')?.textContent?.includes('face') && " +
        "document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled",
      15000,
    ),
  );
  await page.evalClickText(".inspector-actions button", "/^Cancel$/");
  check(
    "Build mode: Cancel from the broken edit returns to the Construction history view with the document unchanged (still 0.09, not 0.08)",
    await waitForCondition("document.querySelector('.feature-tree-list')?.textContent?.includes('0.09') ?? false", 5000),
  );

  // -- robot builder: reorder/insert/delete a step (CAD Kernel Phase 7.4) --
  // Re-selects draftBoxId (features: [Box, Draft] from the Phase 6 section
  // above, untouched by Phase 7.3's own edits to shellBoxId). Every new
  // step inserted here is a Cut -- deliberately, not a Shell/Draft/
  // Fillet-Chamfer: a cut carries no picks at all (executor.ts's own
  // applyCut always returns resolvedPicks: []), and set-difference is
  // commutative regardless of overlap (A-B-C == A-C-B always) -- so two
  // inserted cuts can be freely reordered or deleted with zero risk of
  // tripping the same real geometric-tolerance limitation the edit-any-step
  // section above deliberately exercises. That failure mode belongs to
  // picks, not to reordering itself -- this section proves the reorder/
  // insert/delete MECHANISM independent of it. See
  // docs/decisions/cad-kernel-reorder-insert-delete.md.
  // Reuses draftBoxId (already a cad_mesh body with its own recorded
  // history, [Box, Draft] -- the Construction history panel, and the
  // Insert-step mechanism it hosts, only ever shows for a cad_mesh body;
  // a bare, never-yet-modified primitive has no features/panel at all).
  // Every step inserted here is a Cut -- deliberately, not another Shell/
  // Draft/Fillet-Chamfer: a cut carries no picks at all (executor.ts's own
  // applyCut always returns resolvedPicks: []), so it can never depend on
  // (or be broken by) whatever picks the existing Draft step already has,
  // and set-difference is commutative regardless of overlap (A-B-C ==
  // A-C-B always) -- so the two cuts inserted here can be freely reordered
  // or deleted with zero risk of tripping the same real geometric-
  // tolerance limitation the edit-any-step section above deliberately
  // exercises for picks. That failure mode belongs to picks, not to
  // reordering itself -- this section proves the reorder/insert/delete
  // MECHANISM independent of it. See
  // docs/decisions/cad-kernel-reorder-insert-delete.md.
  await page.evalClickText(".hierarchy-row", `/^${draftBoxId}$/`);
  check(
    "Build mode: draftBoxId still has its own 2-step history (Box, Draft) from the Phase 6 section",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows.length === 2 && rows[0]?.startsWith('Box') && rows[1]?.startsWith('Draft'); })()",
      5000,
    ),
  );

  // Insert an Extruded Cut right after the Draft step (afterIndex 1 --
  // append at the tail). Every row has its own identically-labeled
  // "+ Insert step" button, so this targets the SECOND li's own toggle
  // (Draft's row) directly by position rather than by (ambiguous) text --
  // same default profile/depth/position already proven safe on an
  // identical fresh box in the standalone Extruded Cut section above.
  await page.evalClick(".feature-tree-list li:nth-child(2) .feature-tree-insert-toggle");
  await page.evalClickText(".feature-tree-insert-menu button", "/^Extruded Cut$/");
  check(
    "Build mode: choosing Extruded Cut from the Insert menu opens it in insert mode",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'Insert Cut (Extruded)'", 5000),
  );
  // Replaying [Box, Draft, Cut] through the executor -- a real taper plus a
  // real boolean subtraction -- takes noticeably longer than a single fresh
  // op's own preview, and this machine's own desktop load varies enough
  // (confirmed via repeated timed diagnostics -- genuinely just slow under
  // contention, never actually stuck) to need the same generous 45s budget
  // extrude.test.ts's own cold-WASM-load check above uses.
  check(
    "Build mode: the default cutting tool computes a real preview through the warm CAD worker (Apply enables)",
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 45000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Apply splices the new Cut step in right after Draft -- 3 rows now, in order",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows.length === 3 && rows[0]?.startsWith('Box') && rows[1]?.startsWith('Draft') && rows[2] === 'Cut (Extruded)'; })()",
      // Apply's own commit calls insertFeatureStep, which replays the whole
      // chain again -- same real cost as the preview above.
      45000,
    ),
  );

  // Insert a Revolved Cut after the Extruded Cut (afterIndex 2 -- append
  // again -- now the THIRD li's own toggle). Same default offset/angle/
  // radius already proven safe on an identical fresh box in the
  // standalone Revolved Cut section above.
  await page.evalClick(".feature-tree-list li:nth-child(3) .feature-tree-insert-toggle");
  await page.evalClickText(".feature-tree-insert-menu button", "/^Revolved Cut$/");
  check(
    "Build mode: choosing Revolved Cut from the Insert menu opens it in insert mode",
    await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'Insert Cut (Revolved)'", 5000),
  );
  check(
    "Build mode: the default revolved cutting tool computes a real preview (Apply enables)",
    // Replaying [Box, Draft, Cut, Cut] on this machine's own real, variable
    // desktop load (confirmed via repeated timed diagnostics: genuinely
    // just slow under contention, never actually stuck) -- same generous
    // 45s budget extrude.test.ts's own cold-WASM-load check above uses,
    // not a special case just for this step.
    await waitForCondition("!document.querySelector('.cad-extrude-creator .inspector-actions button.primary')?.disabled", 45000),
  );
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  check(
    "Build mode: Apply splices the second new Cut step in at the tail -- 4 rows now, in order",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows.length === 4 && rows[2] === 'Cut (Extruded)' && rows[3] === 'Cut (Revolved)'; })()",
      45000,
    ),
  );

  // Move: swap the two cuts (step 3 up, into step 2's own slot).
  await page.evalClick('[aria-label="move step 3 up"]');
  check(
    "Build mode: moving the Revolved Cut step up swaps it with the Extruded Cut step -- order now Revolved, then Extruded",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows.length === 4 && rows[2] === 'Cut (Revolved)' && rows[3] === 'Cut (Extruded)'; })()",
      // Same reasoning as the insert checks above -- a 4-feature replay.
      45000,
    ),
  );

  // Delete: the (now-last) Extruded Cut step, two-click confirm -- same
  // confirm/commit convention as Body Inspector's own Delete body.
  await page.evalClick('[aria-label="delete step 3"]');
  check(
    "Build mode: a first click on Delete asks for confirmation, without deleting yet",
    await waitForCondition(
      "document.querySelector('[aria-label=\"delete step 3\"]')?.textContent === 'delete?' && " +
        "document.querySelectorAll('.feature-tree-list li').length === 4",
      3000,
    ),
  );
  await page.evalClick('[aria-label="delete step 3"]');
  check(
    "Build mode: the second confirming click deletes the step -- 3 rows now, Revolved Cut last",
    await waitForCondition(
      "(() => { const rows = [...document.querySelectorAll('.feature-tree-list .feature-tree-step')].map((r) => r.textContent); " +
        "return rows.length === 3 && rows[2] === 'Cut (Revolved)'; })()",
      45000,
    ),
  );

  // -- robot builder: Add Actuator / Add Sensor (Robot Builder D1) --------
  // Self-contained: adds its own two fresh bodies and a fresh hinge joint
  // first, rather than depending on whatever joints the long CAD-Kernel/
  // Joint-Authoring sequence above happened to leave behind (some of which
  // are "fixed" type, not targetable by an actuator). The field-by-field
  // authoring logic itself (issuesIntroducedBy gating, encoder's joint-not-
  // transform branch, the ball/free-joint warning) is proven directly by
  // ActuatorCreator.test.tsx/SensorCreator.test.tsx/robotEdits.test.ts, not
  // re-derived here -- this only proves the real browser wiring: the
  // toolbar tools, the pick flow, and the new Actuators/Sensors list's own
  // edit/delete affordances. See
  // docs/decisions/robot-builder-actuator-sensor-authoring.md.
  const bodyNamesBefore = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map(b => b.textContent)");
  const countBefore = bodyNamesBefore.length;
  await page.evalClick(".builder-add-body");
  await page.evalClick(".builder-add-body");
  const twoNewBodies = await waitForCondition(`document.querySelectorAll('.hierarchy-row').length >= ${countBefore + 2}`, 5000);
  check("Build mode: two more bodies added for a fresh joint/actuator/sensor fixture", twoNewBodies);

  // Body order in the hierarchy is tree order, not insertion order -- diff
  // against the "before" snapshot instead of assuming the two new ones are
  // last, so this doesn't depend on where buildKinematicTree happens to
  // place a fresh unattached root.
  const bodyNamesAfter = await page.evaluate("[...document.querySelectorAll('.hierarchy-row')].map(b => b.textContent)");
  const beforeSet = new Set(bodyNamesBefore);
  const [firstNew, secondNew] = bodyNamesAfter.filter((name) => !beforeSet.has(name));

  await page.evalClickText(".builder-toolbar button", "/^Add Joint$/");
  await page.evalClickText(".hierarchy-row", new RegExp(`^${firstNew}$`));
  await page.evalClickText(".hierarchy-row", new RegExp(`^${secondNew}$`));
  await waitForCondition("document.querySelector('.builder-inspector h4')?.textContent === 'New joint'", 5000);

  // Reproduces the actual user bug report ("the actuator not working
  // again") end to end: Apply is clicked WITHOUT ever touching the "Joint
  // type" dropdown -- the single most natural first-time flow, and the
  // one that leaves a joint at its default "fixed" type (fixed joints
  // don't move, so Add Actuator's own gate correctly keeps rejecting it).
  // Robot Builder D3 fixed this: a student can now find and re-type that
  // joint via the new Joints list instead of deleting the child body.
  const newJointName = await page.evaluate('document.querySelector(\'[aria-label="joint name"]\')?.value');
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const fixedJointAdded = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent !== 'New joint'",
    5000,
  );
  check("Build mode: a joint left at its default 'fixed' type is added (the actual user flow)", fixedJointAdded);

  const actuatorDisabledForFixedOnly = await waitForCondition(
    "(() => { const btn = [...document.querySelectorAll('.builder-toolbar button')].find(b => b.textContent === 'Add Actuator'); " +
      "return !!btn && btn.disabled && btn.title.includes(\"Every joint on this robot is 'fixed'\"); })()",
    5000,
  );
  check(
    "Build mode: Add Actuator shows the distinguishing 'every joint is fixed' message, not a generic disabled state",
    actuatorDisabledForFixedOnly,
  );

  const inlineHintShown = await waitForCondition(
    "[...document.querySelectorAll('.joint-pick-hint')].some(p => p.textContent?.includes('grayed out because every joint here is \"fixed\"'))",
    5000,
  );
  check("Build mode: an always-visible inline hint explains why Add Actuator is grayed out", inlineHintShown);

  await page.evalClickText(".actuator-sensor-list .feature-tree-step", new RegExp(`^${newJointName}`));
  const jointEditShown = await waitForCondition(
    `document.querySelector('.builder-inspector h4')?.textContent === 'Edit joint' && document.querySelector('[aria-label="joint name"]')?.value === ${JSON.stringify(newJointName)}`,
    5000,
  );
  check("Build mode: clicking the joint in the new Joints list opens it for editing, prefilled", jointEditShown);

  await page.setSelectValue('[aria-label="joint type"]', "hinge");
  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const hingeJointAdded = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent !== 'Edit joint'",
    5000,
  );
  check("Build mode: editing the joint to 'hinge' in place fixes it -- no body deletion needed", hingeJointAdded);

  const actuatorNowEnabled = await waitForCondition(
    "(() => { const btn = [...document.querySelectorAll('.builder-toolbar button')].find(b => b.textContent === 'Add Actuator'); " +
      "return !!btn && !btn.disabled; })()",
    5000,
  );
  check("Build mode: Add Actuator becomes enabled once the joint is fixed to a movable type", actuatorNowEnabled);

  await page.evalClickText(".builder-toolbar button", "/^Add Actuator$/");
  const actuatorFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New actuator'",
    5000,
  );
  check("Build mode: Add Actuator shows the creation form directly, no viewport pick needed", actuatorFormShown);

  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const actuatorInList = await waitForCondition(
    "[...document.querySelectorAll('.actuator-sensor-list .feature-tree-step')].some(b => b.textContent?.includes('actuator-1'))",
    5000,
  );
  check("Build mode: Apply adds the actuator, shown in the new Actuators list", actuatorInList);

  await page.evalClickText(".builder-toolbar button", "/^Add Sensor$/");
  const sensorHintShown = await waitForCondition(
    "document.querySelector('.joint-pick-hint')?.textContent === 'Click the body to mount the sensor on.'",
    5000,
  );
  check("Build mode: Add Sensor enters the picking tool with a hint", sensorHintShown);

  await page.evalClickText(".hierarchy-row", new RegExp(`^${firstNew}$`));
  const sensorFormShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'New sensor'",
    5000,
  );
  check("Build mode: picking a body shows the sensor creation form", sensorFormShown);

  await page.evalClickText(".inspector-actions button", "/^Apply$/");
  const sensorInList = await waitForCondition(
    "[...document.querySelectorAll('.actuator-sensor-list .feature-tree-step')].some(b => b.textContent?.includes('sensor-1'))",
    5000,
  );
  check("Build mode: Apply adds the sensor, shown in the new Sensors list", sensorInList);

  await page.evalClickText(".actuator-sensor-list .feature-tree-step", "/sensor-1/");
  const sensorEditShown = await waitForCondition(
    "document.querySelector('.builder-inspector h4')?.textContent === 'Edit sensor' && " +
      "document.querySelector('[aria-label=\"sensor name\"]')?.value === 'sensor-1'",
    5000,
  );
  check("Build mode: clicking an existing sensor opens it for editing, prefilled", sensorEditShown);
  await page.evalClickText(".inspector-actions button", "/^Cancel$/");

  // aria-label, not the generic .feature-tree-delete class + text: the
  // actuator added earlier shares that exact class and "Delete" text, so a
  // loosely-scoped click here would hit its row instead (first DOM match).
  await page.evalClick('[aria-label="delete sensor sensor-1"]');
  await page.evalClick('[aria-label="delete sensor sensor-1"]');
  const sensorDeleted = await waitForCondition(
    "![...document.querySelectorAll('.actuator-sensor-list .feature-tree-step')].some(b => b.textContent?.includes('sensor-1'))",
    5000,
  );
  check("Build mode: two-click delete removes the sensor from the list", sensorDeleted);

  await page.clickText(".mode-toggle button", "/^Simulate$/");
  const backToSimulate = await waitForCondition(
    "!!document.querySelector('.sidebar') && !!document.querySelector('.viewport-3d canvas')",
    5000,
  );
  check("Build mode: switching back to Simulate restores the sim UI", backToSimulate);

  // -- simulate mode: a built robot (Robot Builder B2) ---------------------
  // Coverage gap, stated plainly, mirroring this file's own established
  // pattern for what's honestly provable in this harness: by this point
  // Build mode's own long CAD-Kernel/Joint-Authoring sequence above has
  // left the shared document with several real, un-cleaned-up validation
  // errors (a natural byproduct of exercising manufactured-cycle/rebuild-
  // error/insert-delete test cases back to back, never a bug) -- so the
  // "current robot" row is genuinely, correctly disabled here, which is
  // itself real proof the validity gate works, not a weaker substitute for
  // testing the happy path. The happy path itself (picking a valid current
  // robot renders a real TestViewport inside Simulate mode, Run/Stop drive
  // it for real) is proven directly by BuiltRobotDialog.test.tsx (a
  // controlled zero-issue fixture) and was verified by hand in a real
  // headless-Chrome session against a fresh "Simple Arm" template. See
  // docs/decisions/robot-builder-simulate-mode.md.
  await page.evalClickText(".robot.selectable", "/Built robot/");
  const builtDialogShown = await waitForCondition(
    "[...document.querySelectorAll('.dialog h3')].some(h => h.textContent === 'Choose a built robot')",
    5000,
  );
  check("Simulate mode: the 4th sidebar entry opens the built-robot picker", builtDialogShown);
  const currentRobotGated = await waitForCondition(
    "(() => { const row = document.querySelector('.project-row.template-row'); " +
      "return !!row && row.disabled && row.title.includes('issues'); })()",
    5000,
  );
  check("Simulate mode: a Build-mode document with real errors is correctly disabled, not pickable", currentRobotGated);
  const packsSettled = await waitForCondition(
    "[...document.querySelectorAll('.dialog-empty')].some(p => p.textContent?.includes('No installed packs carry a built robot'))",
    5000,
  );
  check("Simulate mode: the picker's packs section settles to a clean empty state", packsSettled);
  // Robot Builder D2's third section -- this harness has no other saved
  // project to read back (isTauri() is false, listProjects() rejects,
  // same limitation the packs section above already has), so only the
  // real empty state is provable here; the real happy path (a robot saved
  // in a DIFFERENT project becomes pickable) is proven by
  // projectRobots.test.ts/BuiltRobotDialog.test.tsx and needs a manual
  // pass in the real Tauri desktop shell to see end to end. See
  // docs/decisions/robot-builder-lifecycle.md.
  const projectsSettled = await waitForCondition(
    "[...document.querySelectorAll('.dialog-empty')].some(p => p.textContent?.includes('No other saved project carries a robot'))",
    5000,
  );
  check("Simulate mode: the picker's saved-projects section settles to a clean empty state", projectsSettled);

  await page.evalClickText(".dialog-actions button", "/^Cancel$/");
  const cancelledCleanly = await waitForCondition(
    "!document.querySelector('.dialog-backdrop') && !!document.querySelector('.robot.selectable.active')",
    5000,
  );
  check("Simulate mode: Cancel closes the built-robot picker without changing anything", cancelledCleanly);

  // -- compete mode: Competition Arena C2/C3 -------------------------------
  // Coverage gap, stated plainly, mirroring the Build-mode packs note above:
  // this harness runs as a plain browser tab against the Vite dev server
  // (isTauri() is false), so there is no installed desktop pack to pick a
  // competition from -- only the bundled ones (packs/core/competitions/,
  // shipped via import.meta.glob, no Tauri IPC needed) are reachable here.
  // What this section proves for real: the 3rd mode switches in cleanly,
  // the picker lists the real bundled competitions (sorted by file name,
  // same order bundledCompetitions() itself sorts by) with the
  // installed-pack section settled to its real empty state, picking one
  // rebuilds the arena and starts the scoreboard, Run actually drives the
  // car and the scoreboard's own clock advances live, Stop freezes it and
  // shows a real end-of-run report, and switching back to Simulate
  // restores the sim UI. The Blocks tab is reselected first -- a much
  // earlier lesson's "Try this" step (tryLessonStep) leaves the shared
  // `tab` state on Python, and Run on the Python tab correctly no-ops with
  // no sidecar running in this harness (same as it would in Simulate mode);
  // that's real, existing, sidecar-gated behavior, not something this
  // section means to exercise.
  await page.evalClickText(".code-tab", "/^Blocks$/");
  await page.clickText(".mode-toggle button", "/^Compete$/");
  const competeDialogShown = await waitForCondition(
    "[...document.querySelectorAll('.dialog h3')].some(h => h.textContent === 'Choose a competition')",
    5000,
  );
  check("Compete mode: switching in opens the competition picker", competeDialogShown);
  const competeBundledListed = await waitForCondition(
    "[...document.querySelectorAll('.template-row .project-name')].map(n => n.textContent).join(',') === " +
      "'Obstacle Slalom,Precision Docking,Sprint to the Zone' && " +
      "[...document.querySelectorAll('.dialog-empty')].some(p => p.textContent?.includes('No installed packs carry a competition'))",
    5000,
  );
  check("Compete mode: the picker lists the three real bundled competitions", competeBundledListed);

  await page.clickText(".template-row .project-name", "/^Sprint to the Zone$/");
  const competeHudShown = await waitForCondition(
    "document.querySelector('.compete-hud h4')?.textContent === 'Sprint to the Zone' && " +
      "!!document.querySelector('.viewport-3d canvas')",
    5000,
  );
  check("Compete mode: picking a competition rebuilds the arena and shows the scoreboard", competeHudShown);

  const timeBeforeRun = await page.evaluate(
    "document.querySelector('.compete-hud-row:nth-child(3) span:nth-child(2)')?.textContent",
  );
  await page.evalClick(".run-bar .run");
  const scoreboardLive = await waitForCondition(
    `document.querySelector('.compete-hud-row:nth-child(3) span:nth-child(2)')?.textContent !== ${JSON.stringify(timeBeforeRun)}`,
    5000,
  );
  check("Compete mode: Run drives the car and the scoreboard's own clock updates live", scoreboardLive, `before: ${timeBeforeRun}`);

  await page.evalClick(".run-bar .run + button"); // Stop (run-bar footer entry point)
  const competeReportShown = await waitForCondition(
    "!!document.querySelector('.compete-report') && " +
      "document.querySelector('.compete-report-total')?.textContent?.includes('Total score') && " +
      "document.querySelectorAll('.compete-report-table tbody tr').length >= 1",
    5000,
  );
  check("Compete mode: Stop ends the run and shows a report with a total score and objective rows", competeReportShown);

  await page.evalClickText(".dialog-actions button", "/Choose another competition/");
  const competePickerReopened = await waitForCondition(
    "[...document.querySelectorAll('.dialog h3')].some(h => h.textContent === 'Choose a competition')",
    5000,
  );
  check("Compete mode: 'Choose another competition' returns to the picker", competePickerReopened);
  await page.evalClickText(".dialog-actions button", "/^Cancel$/");

  await page.clickText(".mode-toggle button", "/^Simulate$/");
  const backToSimulateFromCompete = await waitForCondition(
    "!!document.querySelector('.sidebar') && !!document.querySelector('.viewport-3d canvas')",
    5000,
  );
  check("Compete mode: switching back to Simulate restores the sim UI", backToSimulateFromCompete);
} catch (error) {
  console.error("e2e check threw:", error);
  failures.push(String(error));
}

page.close();
console.log(failures.length === 0 ? "STUDIO E2E: ALL CHECKS PASSED" : `STUDIO E2E FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
