// 动态光照：一张与屏幕等大的离屏画布。
// 1) 铺满带生物群系色偏的"黑暗色"（随井深加重；基础暗度已调低——无光源时物件仍可辨认）
// 2) destination-out 抠出每个光源的径向渐变洞（核心更亮、边缘更软）
// 3) 整张叠到场景上
// 4) 主画布上再用 lighter 叠一层有色光晕——Animal Well 那种"光会染上颜色"
//
// 历史：曾实验过 raycast 阴影（逐光源 96 向投射可见性多边形）——2D 横版的小分辨率下
// 楔形伪影/互叠过黑/嵌墙自遮挡三类问题都不干净，且 2D 平台光照"绕过墙角"本就符合直觉，
// 已回退为纯径向模型。git 历史里可找到该实验实现。
export interface Light {
  x: number; // 世界坐标
  y: number;
  r: number;
  /** Additive tint as "r,g,b". Visual only. */
  tint?: string;
  /** Per-light intensity 0..1+. Visual only. */
  strength?: number;
}

export class LightPass {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.ctx = this.canvas.getContext("2d")!;
  }

  render(
    main: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    darkness: string,
    lights: Light[],
  ): void {
    const c = this.ctx;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, 320, 180);
    c.fillStyle = darkness;
    c.fillRect(0, 0, 320, 180);

    c.globalCompositeOperation = "destination-out";
    for (const l of lights) {
      const sx = l.x - camX;
      const sy = l.y - camY;
      if (sx < -l.r || sy < -l.r || sx > 320 + l.r || sy > 180 + l.r) continue;
      const s = l.strength ?? 1;
      const g = c.createRadialGradient(sx, sy, 0, sx, sy, l.r);
      // 脚边掏得干净，好读碰撞沿；圈外很快沉回阴翳
      g.addColorStop(0, `rgba(0,0,0,${(0.99 * s).toFixed(3)})`);
      g.addColorStop(0.22, `rgba(0,0,0,${(0.88 * s).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(0,0,0,${(0.52 * s).toFixed(3)})`);
      g.addColorStop(0.78, `rgba(0,0,0,${(0.16 * s).toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(sx - l.r, sy - l.r, l.r * 2, l.r * 2);
    }

    c.globalCompositeOperation = "source-over";
    main.drawImage(this.canvas, 0, 0);

    // 有色光晕：让光源把附近像素染成金/青/紫，而不是只"擦掉黑暗"
    // 大半径（井口天光）压低强度，避免整屏被洗白
    main.save();
    main.globalCompositeOperation = "lighter";
    for (const l of lights) {
      const sx = l.x - camX;
      const sy = l.y - camY;
      if (sx < -l.r || sy < -l.r || sx > 320 + l.r || sy > 180 + l.r) continue;
      const tint = l.tint ?? "255,214,150";
      const k = Math.min(1, 62 / Math.max(8, l.r));
      const s = l.strength ?? 1;
      const g = main.createRadialGradient(sx, sy, 0, sx, sy, l.r * 0.85);
      g.addColorStop(0, `rgba(${tint},${(0.20 * k * s).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(${tint},${(0.075 * k * s).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(${tint},${(0.022 * k * s).toFixed(3)})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      main.fillStyle = g;
      main.fillRect(sx - l.r, sy - l.r, l.r * 2, l.r * 2);
    }
    main.restore();
  }
}
