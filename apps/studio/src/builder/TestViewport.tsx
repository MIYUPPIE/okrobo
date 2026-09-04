import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RobotDef } from "../contracts/robotDef";
import type { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { materializeRobotScene } from "./robotThree";

// Physics preview for Test mode -- deliberately separate from
// BuilderViewport.tsx, the same reasoning that already separates
// BuilderViewport from Viewport3D.tsx: a different render-loop need. Unlike
// BuilderViewport, `robot` and `builtRobot` are stable for this component's
// entire mounted lifetime (BuilderPanel only mounts it while
// builderMode==="test", constructing one EngineBuiltRobot up front and
// destroying it on exit -- nothing mutates the document while testing, so
// there is no "document changed under me" case to handle, and this needs
// only one effect, not BuilderViewport's mount/rebuild split. No
// TransformControls/picking either -- Test mode has no selection.
//
// No unit test here (jsdom can't construct a real WebGLRenderer, same as
// BuilderViewport.tsx) -- verified by the CDP e2e checks in
// scripts/lib/studio-e2e-check.mjs instead.

export interface TestViewportProps {
  robot: RobotDef;
  builtRobot: EngineBuiltRobot;
}

const STEP_DT = 0.01;

export function TestViewport({ robot, builtRobot }: TestViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

    // GenerateMjcf always synthesizes a floor plane for the built model to
    // land on (docs/decisions/robot-builder-physics.md); rendered here
    // purely for visual reference, not itself simulated.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: 0x1a2230 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(4, 40, 0x263043, 0x263043);
    grid.position.y = 0.001;
    scene.add(grid);

    // Build meshes once from the static document. Each body's own
    // bodyGroup (already carrying body.transform as its local transform,
    // via materializeRobotScene) is reparented under a fresh, flat
    // physicsFrame Group added directly to the scene: MuJoCo's xpos/xquat
    // are already fully-resolved *world* poses, so no three.js-side
    // parent-chain composition is needed -- each frame just sets that
    // physicsFrame's own transform.
    const { bodyGroupById } = materializeRobotScene(robot);
    const physicsFrames: THREE.Group[] = robot.bodies.map((body) => {
      const frame = new THREE.Group();
      scene.add(frame);
      const bodyGroup = bodyGroupById.get(body.id);
      if (bodyGroup) frame.add(bodyGroup);
      return frame;
    });

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
      builtRobot.step(STEP_DT);
      const poses = builtRobot.bodyPoses();
      for (let i = 0; i < poses.length && i < physicsFrames.length; i++) {
        const pose = poses[i];
        physicsFrames[i].position.set(pose.x, pose.y, pose.z);
        // MuJoCo's native (w,x,y,z) quaternion order, explicitly reordered
        // to three.js's (x,y,z,w) here -- see EngineBuiltRobot.ts.
        physicsFrames[i].quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      }
      orbitControls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      orbitControls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [robot, builtRobot]);

  return <div ref={containerRef} className="viewport-3d test-viewport" />;
}
