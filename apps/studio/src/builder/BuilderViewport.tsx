import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { CadEdgeOverlay, CadFaceOverlay, CadPreview } from "../cad/cadClient";
import type { RobotDef, Transform } from "../contracts/robotDef";
import { edgeGroupDescriptor } from "./filletPicks";
import { geometryFor, materializeRobotScene, resolveBodyId, setHighlighted } from "./robotThree";

// The Robot Builder's own 3D view -- deliberately separate from
// Viewport3D.tsx (which stays untouched for the fixed Car/Arm/Drone
// simulation path). A builder RobotDef changes on nearly every user action
// (inspector Apply, add/delete body, gizmo drag-end), and Viewport3D's
// single-effect full-teardown-per-change pattern would reset the camera
// framing on every edit -- exactly the jarring UX WorldPanel's own comments
// warn against. There's also no WASM engine here (a builder robot isn't
// simulated), so nothing to step.
//
// Five effects, deliberately: a mount-once effect (renderer/scene/camera/
// OrbitControls/TransformControls/render loop/picking, deps []) that must
// never re-run -- re-running it would recreate the renderer and reset the
// camera on every edit -- a rebuild effect (deps [robot, selectedBodyId,
// gizmoMode, jointPick, bodyPick, suppressedBodyId]) that only touches the
// robot's own sub-scene, a CAD-preview effect (deps [cadPreview], Robot
// Builder CAD Kernel Phase 2) that only touches a separate preview group
// never added to bodyGroupByIdRef, an edge-overlay effect (deps
// [edgeOverlay], Phase 5), and a face-overlay effect (deps [faceOverlay],
// Phase 6) -- each touching its own separate group the same way, so none
// of the four can affect raycasting or the real robot's own rendering.
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
  /** Robot Builder CAD Kernel Phase 4 (Cut): a single-body pick (no
   * parent-then-child two-step, unlike jointPick) for choosing an existing
   * body as a Cut target. Same miss-is-ignored/gizmo-detached posture as
   * jointPick, kept as its own prop rather than unified with it -- Cut's
   * tools each got their own toggle handler in BuilderPanel.tsx too,
   * consistent with how Extrude/Revolve/Boundary never shared one with Add
   * Joint. */
  bodyPick?: { selectedId: string | null; onPick: (bodyId: string) => void };
  /** Extrude tool (Robot Builder CAD Kernel Phase 2). A live preview of the
   * CAD body being authored -- not yet part of `robot` -- rendered as a
   * separate, semi-transparent ghost mesh, positioned where the body would
   * actually land if Applied. */
  cadPreview?: CadPreview | null;
  /** Robot Builder CAD Kernel Phase 4 (Cut): hides this body's own real
   * mesh while a Cut tool is actively previewing, so only the live
   * cut-result ghost (cadPreview, positioned at the same spot) shows --
   * avoids a confusing double-render of the original solid overlapping its
   * own cut result. */
  suppressedBodyId?: string | null;
  /** Robot Builder CAD Kernel Phase 5 (Fillet + Chamfer): a visual-only
   * overlay of the current shape's own pickable edges -- no raycasting of
   * its own; the real pick path is FilletEdgeList's own DOM rows (see
   * docs/decisions/cad-kernel-fillet-chamfer.md for why). `pickedPoints`
   * recolors the edges already picked so a student can see which rows in
   * that list they correspond to. */
  edgeOverlay?: (CadEdgeOverlay & { pickedPoints: readonly [number, number, number][] }) | null;
  /** Robot Builder CAD Kernel Phase 6 (Shell + Draft): a visual-only
   * overlay of the current shape's own pickable faces -- same posture as
   * edgeOverlay (no raycasting; the real pick path is FacePickList's own
   * DOM rows). `pickedPoints` recolors the faces already picked. */
  faceOverlay?: (CadFaceOverlay & { pickedPoints: readonly [number, number, number][] }) | null;
}

const DRAG_CLICK_THRESHOLD_PX = 4;

export function BuilderViewport({
  robot,
  selectedBodyId,
  onSelectBody,
  onTransformBody,
  gizmoMode,
  jointPick,
  bodyPick,
  cadPreview,
  suppressedBodyId,
  edgeOverlay,
  faceOverlay,
}: BuilderViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Populated by the mount effect; read by the rebuild effect and by the
  // mount effect's own listeners (created once, so they close over refs
  // rather than props/state directly).
  const robotRootRef = useRef<THREE.Group | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const bodyGroupByIdRef = useRef<Map<string, THREE.Group>>(new Map());
  const previewGroupRef = useRef<THREE.Group | null>(null);
  const edgeOverlayGroupRef = useRef<THREE.Group | null>(null);
  const faceOverlayGroupRef = useRef<THREE.Group | null>(null);

  const selectedBodyIdRef = useRef(selectedBodyId);
  const onSelectBodyRef = useRef(onSelectBody);
  const onTransformBodyRef = useRef(onTransformBody);
  const jointPickRef = useRef(jointPick);
  const bodyPickRef = useRef(bodyPick);
  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
    onSelectBodyRef.current = onSelectBody;
    onTransformBodyRef.current = onTransformBody;
    jointPickRef.current = jointPick;
    bodyPickRef.current = bodyPick;
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

    const previewGroup = new THREE.Group();
    previewGroup.name = "cad-preview";
    scene.add(previewGroup);
    previewGroupRef.current = previewGroup;

    const edgeOverlayGroup = new THREE.Group();
    edgeOverlayGroup.name = "cad-edge-overlay";
    scene.add(edgeOverlayGroup);
    edgeOverlayGroupRef.current = edgeOverlayGroup;

    const faceOverlayGroup = new THREE.Group();
    faceOverlayGroup.name = "cad-face-overlay";
    scene.add(faceOverlayGroup);
    faceOverlayGroupRef.current = faceOverlayGroup;

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
      const cutPick = bodyPickRef.current;
      if (cutPick) {
        if (hitBodyId) cutPick.onPick(hitBodyId);
        return; // same miss-is-ignored posture as jointPick
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
      previewGroupRef.current = null;
      edgeOverlayGroupRef.current = null;
      faceOverlayGroupRef.current = null;
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

    const highlightedId = jointPick ? jointPick.parentId : bodyPick ? bodyPick.selectedId : selectedBodyId;
    for (const [id, group] of bodyGroupById) setHighlighted(group, id === highlightedId);

    if (suppressedBodyId) {
      const suppressed = bodyGroupById.get(suppressedBodyId);
      if (suppressed) suppressed.visible = false;
    }

    if (jointPick || bodyPick) {
      // Picking a body (joint pair or Cut target) and dragging one are two
      // different things to be doing at once -- the gizmo has no business
      // being attached while either tool is active, regardless of any
      // stale selection.
      transformControls.detach();
      return;
    }
    transformControls.setMode(gizmoMode);
    const selectedGroup = selectedBodyId ? bodyGroupById.get(selectedBodyId) : undefined;
    if (selectedGroup) transformControls.attach(selectedGroup);
    else transformControls.detach();
  }, [robot, selectedBodyId, gizmoMode, jointPick, bodyPick, suppressedBodyId]);

  // CAD-preview effect (Robot Builder CAD Kernel Phase 2): deliberately
  // independent of the rebuild effect above -- previewGroup is never added
  // to bodyGroupByIdRef, so it structurally cannot be hit by the raycast
  // that resolves clicks to a real body id, and this effect never touches
  // robotRoot/transformControls either.
  useEffect(() => {
    const previewGroup = previewGroupRef.current;
    if (!previewGroup) return;
    previewGroup.clear();
    if (!cadPreview) return;
    const geometry = geometryFor({ type: "cad_mesh", vertices: cadPreview.mesh.vertices, faces: cadPreview.mesh.faces });
    const material = new THREE.MeshStandardMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.45, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...cadPreview.position);
    // CAD Kernel Phase 5: the target body's own current rotation (Cut,
    // Fillet/Chamfer editing an already-rotated body in place) -- omitted
    // by the three Boss creators, whose new bodies are always created
    // unrotated, so this defaults to identity for them.
    mesh.rotation.set(...(cadPreview.rotation ?? [0, 0, 0]), "XYZ");
    previewGroup.add(mesh);
  }, [cadPreview]);

  // Edge-overlay effect (Robot Builder CAD Kernel Phase 5): a visual-only
  // aid, independent of the rebuild/cadPreview effects above the same way
  // the cadPreview effect already is -- edgeOverlayGroup is never added to
  // bodyGroupByIdRef, so it can never be hit by the body-select raycast,
  // and there is deliberately no raycast of its own here either (see
  // FilletEdgeList.tsx's own doc for why the real pick path is a DOM list,
  // not a 3D click).
  useEffect(() => {
    const edgeOverlayGroup = edgeOverlayGroupRef.current;
    if (!edgeOverlayGroup) return;
    edgeOverlayGroup.clear();
    if (!edgeOverlay) return;
    const { edgeMesh, position, rotation, pickedPoints } = edgeOverlay;
    const pickedColor = new THREE.Color(0x33ff77);
    const unpickedColor = new THREE.Color(0xffcc33);
    for (let groupIndex = 0; groupIndex < edgeMesh.edgeGroups.length; groupIndex++) {
      const group = edgeMesh.edgeGroups[groupIndex];
      const points: THREE.Vector3[] = [];
      for (let i = group.start; i < group.start + group.count; i++) {
        points.push(new THREE.Vector3(edgeMesh.lines[i * 3], edgeMesh.lines[i * 3 + 1], edgeMesh.lines[i * 3 + 2]));
      }
      const descriptor = edgeGroupDescriptor(edgeMesh, groupIndex);
      const isPicked = pickedPoints.some(
        (p) => Math.abs(p[0] - descriptor[0]) < 1e-9 && Math.abs(p[1] - descriptor[1]) < 1e-9 && Math.abs(p[2] - descriptor[2]) < 1e-9,
      );
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: isPicked ? pickedColor : unpickedColor });
      const line = new THREE.Line(geometry, material);
      edgeOverlayGroup.add(line);
    }
    edgeOverlayGroup.position.set(...position);
    edgeOverlayGroup.rotation.set(...rotation, "XYZ");
  }, [edgeOverlay]);

  // Face-overlay effect (Robot Builder CAD Kernel Phase 6): same
  // visual-only-aid posture as the edge-overlay effect above, but per
  // face rather than per edge -- each faceGroup's own triangle range is
  // rendered as its own semi-transparent THREE.Mesh, sharing the
  // overlay's vertex/normal/index arrays via setDrawRange rather than
  // copying them per face. "Picked" state compares against the overlay's
  // own `centers` (the exact Face.center values FacePreview carries), not
  // a client-recomputed mesh centroid -- a curved face's own mesh
  // centroid isn't a reliable substitute (see
  // docs/decisions/cad-kernel-shell-draft.md).
  useEffect(() => {
    const faceOverlayGroup = faceOverlayGroupRef.current;
    if (!faceOverlayGroup) return;
    faceOverlayGroup.clear();
    if (!faceOverlay) return;
    const { faceMesh, centers, position, rotation, pickedPoints } = faceOverlay;
    const pickedColor = 0x33ff77;
    const unpickedColor = 0x4da6ff;
    const positions = new Float32Array(faceMesh.vertices);
    const normals = new Float32Array(faceMesh.normals);
    const index = faceMesh.triangles;
    for (let groupIndex = 0; groupIndex < faceMesh.faceGroups.length; groupIndex++) {
      const group = faceMesh.faceGroups[groupIndex];
      const center = centers[groupIndex];
      const isPicked = pickedPoints.some(
        (p) => Math.abs(p[0] - center[0]) < 1e-9 && Math.abs(p[1] - center[1]) < 1e-9 && Math.abs(p[2] - center[2]) < 1e-9,
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geometry.setIndex(index);
      geometry.setDrawRange(group.start, group.count);
      const material = new THREE.MeshStandardMaterial({
        color: isPicked ? pickedColor : unpickedColor,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      faceOverlayGroup.add(mesh);
    }
    faceOverlayGroup.position.set(...position);
    faceOverlayGroup.rotation.set(...rotation, "XYZ");
  }, [faceOverlay]);

  return <div ref={containerRef} className="viewport-3d builder-viewport" />;
}
