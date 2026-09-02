import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RobotKind } from "./blocks/okroboBlocks";
import { type ArmState, DEFAULT_ARM, type State } from "./contracts/robotApi";
import type { EngineArm } from "./engine/EngineArm";
import type { EngineWorld } from "./engine/EngineWorld";
import { planSteps } from "./lib/fixedStep";
import type { WorldDef } from "./lib/validateWorld";
import type { ProgramRunner } from "./program/ProgramRunner";

// 3D view stepping the WASM engine at a fixed timestep; renders the active
// robot (car in its arena, or the 4-DOF arm). World frame: x/y on the ground,
// theta CCW. Scene frame: y up, so world (x, y) -> scene (x, elevation, -y)
// and yaw -> rotation.y.

const DT = 0.01;
const MAX_STEPS_PER_FRAME = 100;
const CRUISE_SPEED = 0.2;
const STOP_DISTANCE = 0.2;
const LIDAR_RAYS = 9;
const LIDAR_FOV = Math.PI; // 180 degrees

export type HudInfo = { kind: "car"; state: State } | { kind: "arm"; state: ArmState };

export interface Viewport3DProps {
  robot: RobotKind;
  engine: EngineWorld;
  arm: EngineArm;
  world: WorldDef;
  /** steps the engine and completes program movements */
  runner: ProgramRunner;
  /** true while the built-in cruise behavior owns the wheels */
  autopilotRef: React.RefObject<boolean>;
  onState: (hud: HudInfo) => void;
  onAutoStop: () => void;
}

export function Viewport3D({
  robot,
  engine,
  arm,
  world,
  runner,
  autopilotRef,
  onState,
  onAutoStop,
}: Viewport3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { arena_width: w, arena_height: h, robot_radius: radius } = world;
    const center = new THREE.Vector3(w / 2, 0, -h / 2);
    const controlsTarget = new THREE.Vector3();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16181d);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    if (robot === "arm") {
      // Frame the arm (reach ~0.5 m), not the whole arena: eye-level and close.
      const reach = DEFAULT_ARM.link1 + DEFAULT_ARM.link2 + DEFAULT_ARM.link3;
      camera.position.set(w / 2 + reach * 1.4, DEFAULT_ARM.baseHeight + reach * 1.1, -h / 2 + reach * 1.7);
      controlsTarget.set(w / 2, DEFAULT_ARM.baseHeight + reach * 0.4, -h / 2);
    } else {
      camera.position.set(w / 2, Math.max(w, h) * 1.1, -h / 2 + Math.max(w, h) * 1.2);
      controlsTarget.copy(center);
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(controlsTarget);
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

    // ---- car scene pieces ----
    let carGroup: THREE.Group | null = null;
    let lidarGeometries: THREE.BufferGeometry[] = [];
    if (robot === "car") {
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

      // Coloured boxes: what the camera sees and vision lessons look for.
      for (const obstacle of world.obstacles) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(obstacle.width, 0.2, obstacle.height),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(
              obstacle.color[0] / 255,
              obstacle.color[1] / 255,
              obstacle.color[2] / 255,
            ),
          }),
        );
        box.position.set(obstacle.x, 0.1, -obstacle.y);
        scene.add(box);
      }

      carGroup = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 0.06, 32),
        new THREE.MeshStandardMaterial({ color: 0x4ea1ff }),
      );
      body.position.y = 0.03;
      carGroup.add(body);
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.02, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x0d2b4d }),
      );
      nose.position.set(radius - 0.025, 0.07, 0);
      carGroup.add(nose);
      scene.add(carGroup);

      for (let i = 0; i < LIDAR_RAYS; i++) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(),
        ]);
        const center_ray = i === Math.floor(LIDAR_RAYS / 2);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: 0x37c871,
            transparent: !center_ray,
            opacity: center_ray ? 1 : 0.3,
          }),
        );
        scene.add(line);
        lidarGeometries.push(geometry);
      }
    }

    // ---- arm scene pieces ----
    let yawGroup: THREE.Group | null = null;
    let shoulderGroup: THREE.Group | null = null;
    let elbowGroup: THREE.Group | null = null;
    let wristGroup: THREE.Group | null = null;
    if (robot === "arm") {
      const { baseHeight, link1, link2, link3 } = DEFAULT_ARM;
      const root = new THREE.Group();
      root.position.set(w / 2, 0, -h / 2);
      scene.add(root);

      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, baseHeight, 24),
        new THREE.MeshStandardMaterial({ color: 0x3a3f4c }),
      );
      pedestal.position.y = baseHeight / 2;
      root.add(pedestal);

      const linkMaterial = new THREE.MeshStandardMaterial({ color: 0x4ea1ff });
      const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x0d2b4d });
      const makeLink = (length: number, thickness: number) => {
        const link = new THREE.Mesh(
          new THREE.BoxGeometry(length, thickness, thickness),
          linkMaterial,
        );
        link.position.x = length / 2;
        return link;
      };
      const makeJoint = (r: number) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), jointMaterial);

      yawGroup = new THREE.Group();
      yawGroup.position.y = baseHeight;
      root.add(yawGroup);

      shoulderGroup = new THREE.Group();
      shoulderGroup.add(makeJoint(0.045));
      shoulderGroup.add(makeLink(link1, 0.05));
      yawGroup.add(shoulderGroup);

      elbowGroup = new THREE.Group();
      elbowGroup.position.x = link1;
      elbowGroup.add(makeJoint(0.038));
      elbowGroup.add(makeLink(link2, 0.042));
      shoulderGroup.add(elbowGroup);

      wristGroup = new THREE.Group();
      wristGroup.position.x = link2;
      wristGroup.add(makeJoint(0.032));
      wristGroup.add(makeLink(link3, 0.034));
      elbowGroup.add(wristGroup);

      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x37c871 }),
      );
      tip.position.x = link3;
      wristGroup.add(tip);
    }

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

      // Both worlds always step; wheels/joints only move when commanded.
      const plan = planSteps(accumulator, elapsed, DT, MAX_STEPS_PER_FRAME);
      accumulator = plan.accumulator;
      runner.tick(plan.steps);

      if (robot === "car" && carGroup) {
        // Phase 1 built-in behavior: cruise forward, halt at the wall.
        if (autopilotRef.current && engine.state().sensors.distance <= STOP_DISTANCE) {
          engine.apply({ type: "stop" });
          onAutoStop();
        }

        const state = engine.state();
        carGroup.position.set(state.pose.x, 0, -state.pose.y);
        carGroup.rotation.y = state.pose.theta;
        for (let i = 0; i < LIDAR_RAYS; i++) {
          const offset = LIDAR_FOV / 2 - (i * LIDAR_FOV) / (LIDAR_RAYS - 1);
          const direction = state.pose.theta + offset;
          const cos = Math.cos(direction);
          const sin = Math.sin(direction);
          const fromX = state.pose.x + radius * cos;
          const fromY = state.pose.y + radius * sin;
          const length = engine.ray(offset);
          lidarGeometries[i].setFromPoints([
            new THREE.Vector3(fromX, 0.05, -fromY),
            new THREE.Vector3(fromX + length * cos, 0.05, -(fromY + length * sin)),
          ]);
        }
        if (frame++ % 10 === 0) onState({ kind: "car", state });
      }

      if (robot === "arm" && yawGroup && shoulderGroup && elbowGroup && wristGroup) {
        const state = arm.state();
        const [base, shoulder, elbow, wrist] = state.joints.angles;
        yawGroup.rotation.y = base;
        shoulderGroup.rotation.z = shoulder;
        elbowGroup.rotation.z = elbow;
        wristGroup.rotation.z = wrist;
        if (frame++ % 10 === 0) onState({ kind: "arm", state });
      }

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
  }, [robot, engine, arm, world, runner, autopilotRef, onState, onAutoStop]);

  return <div ref={containerRef} className="viewport-3d" />;
}

export { CRUISE_SPEED };
