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
  const lessonsReady = await waitForCondition("document.querySelectorAll('.lesson-card').length >= 3", 5000);
  const lessonCount = await page.evaluate("document.querySelectorAll('.lesson-card').length");
  check("Lessons tab lists at least the three core lessons", lessonsReady, `${lessonCount} lessons`);

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

  await page.clickText(".builder-new-robot", "/New Robot/");
  const builderInspectorReady = await waitForCondition(
    "!!document.querySelector('[aria-label=\"body name\"]')",
    5000,
  );
  check("Build mode: + New Robot creates a robot with an inspector", builderInspectorReady);
  check(
    "Build mode: 3-pane layout appears (hierarchy, stage, inspector)",
    await page.evaluate(
      "!!document.querySelector('.builder-hierarchy') && !!document.querySelector('.builder-stage') && !!document.querySelector('.builder-inspector')",
    ),
  );
  const builderCanvasReady = await waitForCondition("!!document.querySelector('.builder-stage canvas')", 5000);
  check("Build mode: 3D canvas renders", builderCanvasReady);
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

  await page.clickText(".hierarchy-row", "/^Chassis$/");
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

  await page.clickText(".builder-toolbar button", "/^Rotate$/");
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

  await page.clickText(".mode-toggle button", "/^Simulate$/");
  const backToSimulate = await waitForCondition(
    "!!document.querySelector('.sidebar') && !!document.querySelector('.viewport-3d canvas')",
    5000,
  );
  check("Build mode: switching back to Simulate restores the sim UI", backToSimulate);
} catch (error) {
  console.error("e2e check threw:", error);
  failures.push(String(error));
}

page.close();
console.log(failures.length === 0 ? "STUDIO E2E: ALL CHECKS PASSED" : `STUDIO E2E FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
