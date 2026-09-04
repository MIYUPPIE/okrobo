import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { RobotDef, Transform } from "../contracts/robotDef";
import { materializeRobotScene, resolveBodyId, setHighlighted } from "./robotThree";

// The Robot Builder's own 3D view -- deliberately separate from
// Viewport3D.tsx (which stays untouched for the fixed Car/Arm/Drone
// simulation path). A builder RobotDef changes on nearly every user action
// (inspector Apply, add/delete body, gizmo drag-end), and Viewport3D's
// single-effect full-teardown-per-change pattern would reset the camera
// framing on every edit -- exactly the jarring UX WorldPanel's own comments
// warn against. There's also no WASM engine here (a builder robot isn't
// simulated), so nothing to step.
//
// Two effects, deliberately: a mount-once effect (renderer/scene/camera/
// OrbitControls/TransformControls/render loop/picking, deps []) that must
// never re-run -- re-running it would recreate the renderer and reset the
// camera on every edit -- and a rebuild effect (deps [robot, selectedBodyId,
// gizmoMode]) that only touches the robot's own sub-scene.
//
// No unit test here (matches the existing precedent -- Viewport3D.tsx has
// none either; jsdom can't construct a real WebGLRenderer). Verified by the
// CDP e2e checks in scripts/lib/studio-e2e-check.mjs instead.

export type GizmoMode = "translate" | "rotate";

export interface BuilderViewportProps {
  robot: RobotDef;
  selectedBodyId: string | null;
  onSelectBody: (id: string | null) => void;
  /** Called once, when a gizmo drag ends -- not on every intermediate frame
   * (avoids a re-render storm and fighting the gizmo's own live mutation of
   * the same object while dragging). */
  onTransformBody: (bodyId: string, transform: Transform) => void;
  gizmoMode: GizmoMode;
  /** Joint-authoring tool (Add Joint in the toolbar). When set, a viewport
   * click picks a body for the joint instead of selecting/gizmo-editing it
   * -- a miss is ignored rather than deselecting, so a stray click on the
   * grid can't cancel an in-progress pick. `parentId` (once picked) is
   * highlighted in place of `selectedBodyId`, and the gizmo stays detached
   * the whole time -- dragging bodies and picking a joint pair are two
   * different things to be doing at once. */
  jointPick?: { parentId: string | null; onPick: (bodyId: string) => void };
}

const DRAG_CLICK_THRESHOLD_PX = 4;

export function BuilderViewport({ robot, selectedBodyId, onSelectBody, onTransformBody, gizmoMode, jointPick }: BuilderViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Populated by the mount effect; read by the rebuild effect and by the
  // mount effect's own listeners (created once, so they close over refs
  // rather than props/state directly).
  const robotRootRef = useRef<THREE.Group | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const bodyGroupByIdRef = useRef<Map<string, THREE.Group>>(new Map());

  const selectedBodyIdRef = useRef(selectedBodyId);
  const onSelectBodyRef = useRef(onSelectBody);
  const onTransformBodyRef = useRef(onTransformBody);
  const jointPickRef = useRef(jointPick);
  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
    onSelectBodyRef.current = onSelectBody;
    onTransformBodyRef.current = onTransformBody;
    jointPickRef.current = jointPick;
  });

  // Mount-once: renderer, scene, camera, controls, render loop, picking.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181d);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(0.6, 0.5, 0.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.target.set(0, 0.1, 0);
    orbitControls.enableDamping = true;
    orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 3, 1);
    scene.add(sun);

    // A neutral workbench, not a physical arena -- a builder robot isn't
    // placed in any particular world yet.
    const grid = new THREE.GridHelper(2, 20, 0x263043, 0x263043);
    scene.add(grid);

    const robotRoot = new THREE.Group();
    scene.add(robotRoot);
    robotRootRef.current = robotRoot;

    const transformControls = new TransformControls(camera, renderer.domElement);
    scene.add(transformControls.getHelper());
    transformControlsRef.current = transformControls;

    transformControls.addEventListener("dragging-changed", (event) => {
      orbitControls.enabled = !event.value;
      if (event.value) return; // drag just started, nothing to commit yet
      const bodyId = selectedBodyIdRef.current;
      const object = transformControls.object;
      if (!bodyId || !object) return;
      const rotation = new THREE.Euler().setFromQuaternion(object.quaternion, "XYZ");
      onTransformBodyRef.current(bodyId, {
        position: [object.position.x, object.position.y, object.position.z],
        rotation_rpy: [rotation.x, rotation.y, rotation.z],
      });
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownAt: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      pointerDownAt = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const start = pointerDownAt;
      pointerDownAt = null;
      if (transformControls.dragging) return;
      if (!start) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > DRAG_CLICK_THRESHOLD_PX) return; // an orbit-drag release, not a click

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...bodyGroupByIdRef.current.values()], true);
      const hitBodyId = hits.length > 0 ? resolveBodyId(hits[0].object) : null;

      const pick = jointPickRef.current;
      if (pick) {
        if (hitBodyId) pick.onPick(hitBodyId);
        return; // a miss is ignored -- don't cancel an in-progress pick
      }
      onSelectBodyRef.current(hitBodyId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      orbitControls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      transformControls.dispose();
      orbitControls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      robotRootRef.current = null;
      transformControlsRef.current = null;
      bodyGroupByIdRef.current = new Map();
    };
  }, []);

  // Rebuilds the robot's own sub-scene whenever the document, selection, or
  // gizmo mode changes -- cheap at the handful-of-bodies scale a student
  // builds at, and far simpler than fine-grained diffing. Never touches the
  // renderer/camera/controls created above.
  useEffect(() => {
    const robotRoot = robotRootRef.current;
    const transformControls = transformControlsRef.current;
    if (!robotRoot || !transformControls) return;

    robotRoot.clear();
    const { root, bodyGroupById } = materializeRobotScene(robot);
    robotRoot.add(root);
    bodyGroupByIdRef.current = bodyGroupById;

    const highlightedId = jointPick ? jointPick.parentId : selectedBodyId;
    for (const [id, group] of bodyGroupById) setHighlighted(group, id === highlightedId);

    if (jointPick) {
      // Picking a joint pair and dragging a body are two different things
      // to be doing at once -- the gizmo has no business being attached
      // while the tool is active, regardless of any stale selection.
      transformControls.detach();
      return;
    }
    transformControls.setMode(gizmoMode);
    const selectedGroup = selectedBodyId ? bodyGroupById.get(selectedBodyId) : undefined;
    if (selectedGroup) transformControls.attach(selectedGroup);
    else transformControls.detach();
  }, [robot, selectedBodyId, gizmoMode, jointPick]);

  return <div ref={containerRef} className="viewport-3d builder-viewport" />;
}
