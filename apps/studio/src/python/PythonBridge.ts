import type { RobotApi } from "../program/ProgramRunner";

// Client side of contracts/robot-remote/v1: connects to the local Python
// sidecar and executes its robot requests (car, arm, sensors) on the engine
// via the runner's robot API. Reconnects quietly while the sidecar is down.

export const SIDECAR_URL = "ws://127.0.0.1:8355";
const RETRY_MS = 3000;

export interface SerialPort {
  device: string;
  description: string;
  hwid: string;
}

export interface HardwareStatus {
  connected: boolean;
  port?: string;
  identity?: string;
  error?: string;
}

export interface BridgeEvents {
  onStatus(connected: boolean): void;
  onStarted(): void;
  onOutput(stream: "stdout" | "stderr", text: string): void;
  onDone(exitCode: number): void;
  /** Serial ports the sidecar can see (contracts/robot-serial/v0). */
  onPorts?(ports: SerialPort[]): void;
  /** Physical robot connection state. */
  onHardware?(status: HardwareStatus): void;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Map one remote method call onto the robot API. Exported for tests. */
export async function executeRemoteRequest(
  robot: RobotApi,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "forward":
      return robot.forward(num(args.meters, 0.1));
    case "backward":
      return robot.backward(num(args.meters, 0.1));
    case "turn_left":
      return robot.turnLeft(num(args.degrees, 90));
    case "turn_right":
      return robot.turnRight(num(args.degrees, 90));
    case "wait":
      return robot.wait(num(args.seconds, 1));
    case "distance":
      return robot.distance();
    case "lidar":
      return robot.lidar(
        Math.trunc(num(args.rays, 9)),
        num(args.fov_degrees, 180),
      );
    case "heading":
      return robot.heading();
    case "position":
      return robot.position();
    case "stop":
      return robot.stop();
    case "arm_move":
      return robot.armMove(
        typeof args.joint === "string" ? args.joint : Math.trunc(num(args.joint, 0)),
        num(args.degrees, 0),
      );
    case "arm_move_all":
      return robot.armMoveAll(Array.isArray(args.angles) ? args.angles.map((a) => num(a, 0)) : []);
    case "arm_angles":
      return robot.armAngles();
    case "arm_tip":
      return robot.armTip();
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

export class PythonBridge {
  private ws: WebSocket | null = null;
  private disposed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly robot: RobotApi,
    private readonly events: BridgeEvents,
  ) {}

  connect(): void {
    if (this.disposed || this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.events.onStatus(true);
    ws.onmessage = (event) => void this.handle(String(event.data));
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.events.onStatus(false);
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  run(code: string): void {
    this.send({ op: "run", code });
  }

  stop(): void {
    this.send({ op: "stop" });
  }

  listPorts(): void {
    this.send({ op: "list_ports" });
  }

  connectHardware(port: string): void {
    this.send({ op: "connect_hardware", port });
  }

  disconnectHardware(): void {
    this.send({ op: "disconnect_hardware" });
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, RETRY_MS);
  }

  private send(message: Record<string, unknown>): void {
    if (this.connected) this.ws?.send(JSON.stringify(message));
  }

  private async handle(raw: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.op) {
      case "started":
        this.events.onStarted();
        break;
      case "output":
        this.events.onOutput(
          message.stream === "stderr" ? "stderr" : "stdout",
          String(message.text ?? ""),
        );
        break;
      case "done":
        this.events.onDone(Number(message.exit_code ?? 0));
        break;
      case "ports":
        this.events.onPorts?.(Array.isArray(message.ports) ? (message.ports as SerialPort[]) : []);
        break;
      case "hardware":
        this.events.onHardware?.({
          connected: Boolean(message.connected),
          port: typeof message.port === "string" ? message.port : undefined,
          identity: typeof message.identity === "string" ? message.identity : undefined,
          error: typeof message.error === "string" ? message.error : undefined,
        });
        break;
      case "request": {
        const id = message.id;
        try {
          const result = await executeRemoteRequest(
            this.robot,
            String(message.method),
            (message.args ?? {}) as Record<string, unknown>,
          );
          this.send({ op: "result", id, ok: true, result: result ?? null });
        } catch (error) {
          this.send({ op: "result", id, ok: false, error: String((error as Error).message ?? error) });
        }
        break;
      }
    }
  }
}
