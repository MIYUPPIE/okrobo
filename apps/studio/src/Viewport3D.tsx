import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { State } from "./contracts/robotApi";
import type { EngineWorld } from "./engine/EngineWorld";
import { planSteps } from "./lib/fixedStep";
import type { WorldDef } from "./lib/validateWorld";

// 3D view of the arena, stepping the WASM engine at a fixed timestep.
// World frame: x/y on the ground, theta CCW. Scene frame: y up, so
// world (x, y) -> scene (x, elevation, -y) and rotation.y = theta.

const DT = 0.01;
const MAX_STEPS_PER_FRAME = 100;
const CRUISE_SPEED = 0.2;
const STOP_DISTANCE = 0.2;

export interface Viewport3DProps {
  engine: EngineWorld;
  world: WorldDef;
  /** true while the built-in cruise behavior owns the wheels */
  autopilotRef: React.RefObject<boolean>;
  onState: (state: State) => void;
  onAutoStop: () => void;
}

export function Viewport3D({ engine, world, autopilotRef, onState, onAutoStop }: Viewport3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { arena_width: w, arena_height: h, robot_radius: radius } = world;
    const center = new THREE.Vector3(w / 2, 0, -h / 2);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181d);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(w / 2, Math.max(w, h) * 1.1, -h / 2 + Math.max(w, h) * 1.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(w, 3, h);
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: 0x1a2230 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(center);
    scene.add(floor);

    const grid = new THREE.GridHelper(Math.max(w, h), Math.max(w, h) * 2, 0x263043, 0x263043);
    grid.position.set(center.x, 0.001, center.z);
    scene.add(grid);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f4c });
    const t = 0.04;
    const wallHeight = 0.12;
    const walls: Array<[number, number, number, number, number]> = [
      [w + 2 * t, t, w / 2, wallHeight / 2, t / 2],
      [w + 2 * t, t, w / 2, wallHeight / 2, -h - t / 2],
      [t, h, -t / 2, wallHeight / 2, -h / 2],
      [t, h, w + t / 2, wallHeight / 2, -h / 2],
    ];
    for (const [sx, sz, px, py, pz] of walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, wallHeight, sz), wallMaterial);
      wall.position.set(px, py, pz);
      scene.add(wall);
    }

    const robot = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 0.06, 32),
      new THREE.MeshStandardMaterial({ color: 0x4ea1ff }),
    );
    body.position.y = 0.03;
    robot.add(body);
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.02, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x0d2b4d }),
    );
    nose.position.set(radius - 0.025, 0.07, 0);
    robot.add(nose);
    scene.add(robot);

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const ray = new THREE.Line(
      rayGeometry,
      new THREE.LineBasicMaterial({ color: 0x37c871 }),
    );
    scene.add(ray);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let accumulator = 0;
    let lastTime = performance.now();
    let frame = 0;
    let raf = 0;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const elapsed = Math.min((now - lastTime) / 1000, 1);
      lastTime = now;

      // The world always steps; wheels are zero unless something commands them.
      const plan = planSteps(accumulator, elapsed, DT, MAX_STEPS_PER_FRAME);
      accumulator = plan.accumulator;
      for (let i = 0; i < plan.steps; i++) engine.step(DT);

      // Phase 1 built-in behavior: cruise forward, halt at the wall.
      // Replaced by real student programs in Phase 2.
      if (autopilotRef.current && engine.state().sensors.distance <= STOP_DISTANCE) {
        engine.apply({ type: "stop" });
        onAutoStop();
      }

      const state = engine.state();
      robot.position.set(state.pose.x, 0, -state.pose.y);
      robot.rotation.y = state.pose.theta;
      const cos = Math.cos(state.pose.theta);
      const sin = Math.sin(state.pose.theta);
      const fromX = state.pose.x + radius * cos;
      const fromY = state.pose.y + radius * sin;
      rayGeometry.setFromPoints([
        new THREE.Vector3(fromX, 0.05, -fromY),
        new THREE.Vector3(
          fromX + state.sensors.distance * cos,
          0.05,
          -(fromY + state.sensors.distance * sin),
        ),
      ]);

      if (frame++ % 10 === 0) onState(state);
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [engine, world, autopilotRef, onState, onAutoStop]);

  return <div ref={containerRef} className="viewport-3d" />;
}

export { CRUISE_SPEED };
