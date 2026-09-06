// 动作映射输入系统。
//
// 游戏逻辑永远不问"J 键按了吗"，只问"跳跃按了吗"（Action 语义）：
// 改键、加默认布局、将来接手柄，都不用动一行游戏逻辑。
//
// 用 event.code（物理键位）而不是 event.key（产生的字符）：
// WASD 在法语 AZERTY 键盘上依然是同一排物理键。
export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "jump"
  | "use"
  | "cycle"
  | "slot1"
  | "slot2"
  | "slot3"
  | "slot4"
  | "confirm"
  | "pause"
  | "mute"
  | "map"
  | "zoomIn"
  | "zoomOut";

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["KeyK", "KeyZ"],
  use: ["KeyJ", "KeyX"],
  cycle: ["KeyL"],
  slot1: ["Digit1"], // 快捷道具槽：1=藤鞭 2=泡泡荚 3=孢子笛 4=蔓豆
  slot2: ["Digit2"],
  slot3: ["Digit3"],
  slot4: ["Digit4"],
  confirm: ["Enter", "KeyJ"],
  pause: ["Escape"],
  mute: ["KeyM"],
  map: ["Tab"],
  zoomIn: ["KeyE"], // 地图放大
  zoomOut: ["KeyQ"], // 地图缩小
};

const STORAGE_KEY = "plantwell.bindings.v1";

export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, "")
    .replace(/^Arrow/, "")
    .replace("Escape", "Esc")
    .replace("Enter", "Enter");
}

interface KeyEvent {
  down: boolean;
  code: string;
}

export class Input {
  private bindings: Record<Action, string[]>;
  private codeToActions = new Map<string, Action[]>();

  private heldActions = new Set<Action>();
  private justPressedSet = new Set<Action>();
  private queue: KeyEvent[] = [];
  private captureCb: ((code: string) => void) | null = null;

  constructor() {
    this.bindings = this.load();
    this.rebuildMap();
  }

  attach(target: Window): void {
    target.addEventListener("keydown", (e) => {
      // 捕获模式（改键 UI）：下一个按键直接交给回调，不进动作系统
      if (this.captureCb) {
        e.preventDefault();
        const cb = this.captureCb;
        this.captureCb = null;
        cb(e.code);
        return;
      }
      // 游戏按键一律挡住默认行为（方向键滚页面、空格滚页面等）
      if (this.codeToActions.has(e.code)) e.preventDefault();
      if (!e.repeat) this.queue.push({ down: true, code: e.code });
    });
    target.addEventListener("keyup", (e) => {
      this.queue.push({ down: false, code: e.code });
    });
    // 切走窗口时 OS 不会再送 keyup，回来会"鬼按键"——直接全松
    target.addEventListener("blur", () => this.heldActions.clear());
  }

  /** 每个逻辑步开头调用一次，把上一步以来积累的真实按键事件落成动作状态。 */
  update(): void {
    this.justPressedSet.clear();
    for (const { down, code } of this.queue) {
      for (const action of this.codeToActions.get(code) ?? []) {
        if (down) {
          if (!this.heldActions.has(action)) this.justPressedSet.add(action);
          this.heldActions.add(action);
        } else {
          this.heldActions.delete(action);
        }
      }
    }
    this.queue.length = 0;
  }

  /** 这个动作现在是否被按住（持续状态：移动、攀爬）。 */
  held(action: Action): boolean {
    return this.heldActions.has(action);
  }

  /** 这个动作是否本步刚刚按下（瞬时状态：跳、使用道具）。 */
  pressed(action: Action): boolean {
    return this.justPressedSet.has(action);
  }

  /** 调试/测试用：当前排队中的按键事件数。 */
  queueLength(): number {
    return this.queue.length;
  }

  /** 调试/测试用：进入捕获模式：下一个按下的物理键交给回调（改键 UI 用），Esc 取消。 */
  captureNext(cb: (code: string) => void): void {
    this.captureCb = cb;
  }

  cancelCapture(): void {
    this.captureCb = null;
  }

  // ---- 改键 ----

  getBindings(): Readonly<Record<Action, string[]>> {
    return this.bindings;
  }

  /** 把某个物理键绑到动作上；该键同时会从其他动作上摘除（一键不绑两用）。 */
  rebind(action: Action, code: string): void {
    for (const a of Object.keys(this.bindings) as Action[]) {
      this.bindings[a] = this.bindings[a].filter((c) => c !== code);
    }
    this.bindings[action].push(code);
    this.rebuildMap();
    this.save();
  }

  resetBindings(): void {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.rebuildMap();
    this.save();
  }

  private rebuildMap(): void {
    this.codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings) as [
      Action,
      string[],
    ][]) {
      for (const code of codes) {
        const actions = this.codeToActions.get(code) ?? [];
        actions.push(action);
        this.codeToActions.set(code, actions);
      }
    }
  }

  private load(): Record<Action, string[]> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...structuredClone(DEFAULT_BINDINGS), ...JSON.parse(raw) };
    } catch {
      // 隐私模式等场景 localStorage 可能不可用，退回默认绑定即可
    }
    return structuredClone(DEFAULT_BINDINGS);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // 存不进去就只用本次会话
    }
  }
}
