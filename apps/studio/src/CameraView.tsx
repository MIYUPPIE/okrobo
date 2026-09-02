import { useEffect, useRef } from "react";
import type { EngineWorld } from "./engine/EngineWorld";

// Live preview of what the robot's camera sees: the same frame student code
// receives from `robot.camera()`, rendered by the engine rather than the 3D
// scene, so what the student debugs by eye is exactly what their program gets.

const WIDTH = 64;
const HEIGHT = 48;
const REFRESH_MS = 100;

export function CameraView({ engine }: { engine: EngineWorld }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const image = context.createImageData(WIDTH, HEIGHT);
    const timer = window.setInterval(() => {
      const frame = engine.camera(WIDTH, HEIGHT);
      if (!frame) return;
      for (let i = 0; i < WIDTH * HEIGHT; i++) {
        image.data[i * 4] = frame.pixels[i * 3];
        image.data[i * 4 + 1] = frame.pixels[i * 3 + 1];
        image.data[i * 4 + 2] = frame.pixels[i * 3 + 2];
        image.data[i * 4 + 3] = 255;
      }
      context.putImageData(image, 0, 0);
    }, REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [engine]);

  return (
    <div className="camera-view">
      <h2>Camera</h2>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="camera-canvas" />
      <p className="camera-note">robot.camera() sees this</p>
    </div>
  );
}
