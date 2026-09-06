// 标题画面 + 改键界面。全游戏唯一有文字的地方。
import type { Input } from "../engine/input";
import { keyLabel } from "../engine/input";
import { audio } from "../engine/audio";
import { drawText, drawTextCentered } from "../engine/pixfont";
import type { Action } from "../engine/input";

const KEY_ROWS: { action: Action; label: string }[] = [
  { action: "up", label: "UP" },
  { action: "down", label: "DOWN" },
  { action: "left", label: "LEFT" },
  { action: "right", label: "RIGHT" },
  { action: "jump", label: "JUMP" },
  { action: "use", label: "USE ITEM" },
  { action: "cycle", label: "NEXT ITEM" },
  { action: "confirm", label: "CONFIRM" },
  { action: "pause", label: "PAUSE" },
  { action: "mute", label: "MUTE" },
  { action: "map", label: "MAP" },
];

export class Title {
  private mode: "press" | "menu" | "keys" = "press";
  private sel = 0;
  private keySel = 0;
  private capturing = false;
  private t = 0;
  private introT = 1; // 进标题的过场 0→1（press-any-key 后起播）；1 = 完全呈现

  constructor(
    private input: Input,
    private cb: { onNew(): void; onContinue(): void },
    private hasSave: () => boolean,
  ) {}

  reset(): void {
    this.mode = "menu";
    this.introT = 1; // 从游戏退回：不再重走过场
    this.sel = 0;
  }

  /** 开机门：任意键/点击 = 起播标题曲并播过场进菜单（main.ts 在手势里调用）。 */
  anyKey(): void {
    if (this.mode === "press") {
      this.mode = "menu";
      this.introT = 0;
    }
  }

  private menuItems(): string[] {
    return this.hasSave() ? [ "CONTINUE","NEW GAME", "KEYS"] : ["NEW GAME", "KEYS"];
  }

  update(): void {
    this.t += 1 / 60;
    const input = this.input;

    if (this.mode === "press") return; // 等任意键（输入全部吞掉）
    this.introT = Math.min(1, this.introT + 1 / 60);

    // 过场前 0.6s 吞掉输入：触发过场的那次按键不会顺手点中菜单项
    if (this.introT < 0.6) return;

    if (this.mode === "menu") {
      const items = this.menuItems();
      if (input.pressed("up")) this.sel = (this.sel + items.length - 1) % items.length;
      if (input.pressed("down")) this.sel = (this.sel + 1) % items.length;
      if (input.pressed("confirm")) {
        const it = items[this.sel];
        if (it === "NEW GAME") this.cb.onNew();
        else if (it === "CONTINUE") this.cb.onContinue();
        else this.mode = "keys";
      }
    } else if (!this.capturing) {
      // 最后一行是音量：左右调节
      const volRow = this.keySel === KEY_ROWS.length;
      if (input.pressed("up")) this.keySel = (this.keySel + KEY_ROWS.length) % (KEY_ROWS.length + 1);
      if (input.pressed("down")) this.keySel = (this.keySel + 1) % (KEY_ROWS.length + 1);
      if (volRow) {
        const v = audio.getVolume();
        if (input.held("left") && this.t % 0.06 < 1 / 60) audio.setVolume(v - 0.02);
        if (input.held("right") && this.t % 0.06 < 1 / 60) audio.setVolume(v + 0.02);
      }
      if (input.pressed("confirm") && !volRow) {
        this.capturing = true;
        this.input.captureNext((code) => {
          this.capturing = false;
          if (code !== "Escape") this.input.rebind(KEY_ROWS[this.keySel].action, code);
        });
      }
      if (input.pressed("pause")) this.mode = "menu";
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, 180);
    sky.addColorStop(0, "#0e1a12");
    sky.addColorStop(0.45, "#060a08");
    sky.addColorStop(1, "#030605");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 320, 180);

    const wellRings = () => {
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const y = 10 + i * 22;
        ctx.strokeStyle = `rgba(50, 80, 58, ${(0.16 - i * 0.014).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(160, y, 58 + i * 14, 7 + i * 2.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 井壁苔藓剪影
      ctx.fillStyle = "rgba(40, 80, 44, 0.35)";
      ctx.fillRect(28, 40, 18, 140);
      ctx.fillRect(274, 50, 18, 130);
      ctx.fillStyle = "rgba(90, 170, 70, 0.18)";
      for (let i = 0; i < 9; i++) {
        ctx.fillRect(30 + (i % 3) * 5, 48 + i * 14, 4, 2);
        ctx.fillRect(278 + (i % 2) * 4, 56 + i * 13, 3, 2);
      }
    };

    // 开机门：PRESS ANY KEY——任意键起播标题曲、播过场进菜单
    if (this.mode === "press") {
      wellRings();
      const beam = Math.sin(this.t * 0.7) * 0.02;
      ctx.fillStyle = `rgba(180, 240, 160, ${(0.06 + beam).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(148, 0);
      ctx.lineTo(172, 0);
      ctx.lineTo(186, 70);
      ctx.lineTo(134, 70);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 18; i++) {
        const h = (i * 2654435761) >>> 0;
        const x = h % 320;
        const y = (h % 180 + this.t * (2 + (h % 5))) % 180;
        const glow = (h >> 12) % 5 === 0;
        ctx.fillStyle = glow
          ? `rgba(200, 255, 120, ${0.14 + ((h >> 8) % 8) * 0.03})`
          : `rgba(140, 190, 150, ${0.07 + ((h >> 8) % 8) * 0.014})`;
        ctx.fillRect(x, Math.round(y), glow ? 2 : 1, glow ? 2 : 1);
      }
      if (Math.sin(this.t * 3) > -0.25) {
        drawTextCentered(ctx, "PRESS ANY KEY", 160, 86, 1, "#8fa3ad");
      }
      return;
    }

    // 过场：0→1 渐显 + 标题从下方 8px 浮起
    const ip = 1 - Math.pow(1 - this.introT, 3);
    const rise = Math.round((1 - ip) * 8);
    ctx.globalAlpha = ip;

    wellRings();
    // 天光
    const beam = Math.sin(this.t * 0.7) * 0.02;
    ctx.fillStyle = `rgba(180, 240, 160, ${(0.07 + beam).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(146, 0);
    ctx.lineTo(174, 0);
    ctx.lineTo(190, 78);
    ctx.lineTo(130, 78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(210, 255, 180, ${(0.04 + beam).toFixed(3)})`;
    ctx.fillRect(154, 0, 12, 56);

    // 飘尘 + 萤火
    for (let i = 0; i < 22; i++) {
      const h = (i * 2654435761) >>> 0;
      const x = h % 320;
      const y = (h % 180 + this.t * (2 + (h % 5))) % 180;
      const glow = (h >> 12) % 5 === 0;
      ctx.fillStyle = glow
        ? `rgba(200, 255, 120, ${0.12 + ((h >> 8) % 8) * 0.03})`
        : `rgba(140, 190, 150, ${0.06 + ((h >> 8) % 8) * 0.012})`;
      ctx.fillRect(x, Math.round(y), glow ? 2 : 1, glow ? 2 : 1);
    }

    // 贴地雾
    const fog = ctx.createLinearGradient(0, 130, 0, 180);
    fog.addColorStop(0, "rgba(90,140,70,0)");
    fog.addColorStop(1, "rgba(90,140,70,0.12)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 130, 320, 50);

    // 标题
    const bob = Math.round(Math.sin(this.t * 1.4));
    drawTextCentered(ctx, "PLANT", 160, 40 + bob + rise, 3, "#cfe8d8");
    drawTextCentered(ctx, "WELL", 160, 60 + bob + rise, 3, "#9fd4b0");
    // 标题上的一片小嫩叶
    ctx.fillStyle = "#7fd4a0";
    ctx.fillRect(158 + bob, 30 + rise, 1, 4);
    ctx.fillRect(159 + bob, 28 + rise, 3, 1);

    if (this.mode === "menu") {
      const items = this.menuItems();
      const y0 = 104;
      items.forEach((it, i) => {
        const sel = i === this.sel;
        const color = sel ? "#e8f4ea" : "#5a7268";
        if (sel) {
          const blink = Math.sin(this.t * 6) > -0.3;
          if (blink) drawText(ctx, ">", 132, y0 + i * 13, 1, "#7fd4a0");
        }
        drawTextCentered(ctx, it, 164, y0 + i * 13, 1, color);
      });
    } else {
      ctx.fillStyle = "rgba(4, 8, 11, 0.92)";
      ctx.fillRect(0, 0, 320, 180);
      drawTextCentered(ctx, "KEYS", 160, 10, 2, "#cfe8d8");
      KEY_ROWS.forEach((row, i) => {
        const y = 28 + i * 11;
        const sel = i === this.keySel;
        const color = sel ? "#e8f4ea" : "#5a7268";
        drawText(ctx, row.label, 70, y, 1, color);
        if (sel && this.capturing) {
          const blink = Math.sin(this.t * 10) > 0;
          if (blink) drawText(ctx, "PRESS KEY", 190, y, 1, "#ffe9a8");
        } else {
          const keys = this.input.getBindings()[row.action].map(keyLabel).join(" / ");
          drawText(ctx, keys, 190, y, 1, sel ? "#aef0b8" : "#8fa3ad");
        }
      });
      // 音量行
      const vy = 28 + KEY_ROWS.length * 11;
      const volSel = this.keySel === KEY_ROWS.length;
      drawText(ctx, "VOLUME", 70, vy, 1, volSel ? "#e8f4ea" : "#5a7268");
      const vol = Math.round(audio.getVolume() * 10);
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < vol ? "#aef0b8" : "#2a3a42";
        ctx.fillRect(190 + i * 6, vy, 4, 5);
      }
      if (volSel) drawTextCentered(ctx, "< > ADJUST", 160, vy + 9, 1, "#8fa3ad");
      drawTextCentered(ctx, "ENTER REBIND . ESC BACK", 160, 166, 1, "#5a7268");
    }

    // 底部操作提示（跟随当前绑定）
    const b = this.input.getBindings();
    const k = (codes: readonly string[]) => keyLabel(codes[0] ?? "?");
    const hint = [
      `MOVE ${k(b.left)}${k(b.down)}${k(b.up)}${k(b.right)}`,
      `JUMP ${k(b.jump)}`,
      `USE ${k(b.use)}`,
      `ITEM ${k(b.cycle)}`,
      `MUTE ${k(b.mute)}`,
    ].join(" . ");
    drawTextCentered(ctx, hint, 160, 168, 1, "#3d5260");
    ctx.globalAlpha = 1;
  }
}
