// 动态光照：一张与屏幕等大的离屏画布 + 遮挡投射。
//
// 「真光源」三要素（区别于单纯的径向光晕）：
// 1) 传播：黑暗底 + destination-out 径向抠洞（半径/强度/软边）；
// 2) 遮挡：光被实心瓦片挡住——对每个光源做 360° raycast 得到可见距离，
//    "第一面墙以外"的区域在光照层重新填回黑暗。墙后真的是黑的，光不穿墙；
// 3) 染色：lighter 有色染色直接画在光照层（同样按可见距离裁成楔形扇区），
//    随整层一起压到场景上——颜色只落在被照亮的地方。
// 合成顺序（全部在光照层内完成，最后一次性上屏）：
//   黑暗 → destination-out 抠洞 → source-over 阴影楔 → lighter 染色楔 → drawImage 上屏。
export interface Light {
  x: number; // 世界坐标
  y: number;
  r: number;
  /** Additive tint as "r,g,b". Visual only. */
  tint?: string;
  /** Per-light intensity 0..1+. Visual only. */
  strength?: number;
}

/** 遮挡查询：世界坐标 → 是否实心（挡光）。由 World 提供瓦片级判定。 */
export type Occluder = (x: number, y: number) => boolean;

/** 每光源射线数：96 条在 320×180 下足够平滑；光源通常 <30 个，成本可控。 */
const RAYS = 96;
const STEP = 5; // 射线步进（世界 px）：10px 瓦片下不会漏穿墙

export class LightPass {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.ctx = this.canvas.getContext("2d")!;
  }

  /** 单光源的每方向自由距离（到第一面墙为止）。返回 RAYS 个距离值。
   *  光源嵌在墙里（贴墙烛台/玩家贴墙）时：起点先跳出自身格再采样，且每方向至少保留 8px 透光。 */
  private visibility(l: Light, occludes: Occluder): number[] {
    const out: number[] = new Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      const ang = (i / RAYS) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      let free = l.r;
      let started = false; // 跳过光源自身所在的实心（第一段实心不算墙）
      for (let d = STEP; d <= l.r; d += STEP) {
        if (!occludes(l.x + dx * d, l.y + dy * d)) {
          started = true;
          continue;
        }
        if (!started) continue; // 还没离开光源自身格：这面"墙"就是光源的容身处，忽略
        free = Math.max(8, d - STEP * 0.5); // 稍微盖到墙面上；至少 8px 透光避免全黑
        break;
      }
      out[i] = free;
    }
    return out;
  }

  render(
    main: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    darkness: string,
    lights: Light[],
    occludes: Occluder | null,
  ): void {
    const c = this.ctx;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, 320, 180);
    c.fillStyle = darkness;
    c.fillRect(0, 0, 320, 180);

    // 1) 传播：径向抠洞
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

    // 2) 遮挡 + 3) 染色：都只对"大光源"做（r ≥ 24——物件基础微光不投影，避免墙边小光斑被自己吃掉），
    //    且都按同一份可见距离裁剪。
    const onScreen = lights.filter(
      (l) => l.x - camX > -l.r && l.y - camY > -l.r && l.x - camX < 320 + l.r && l.y - camY < 180 + l.r,
    );
    const shadowed = occludes ? onScreen.filter((l) => l.r >= 24) : [];
    const vis = shadowed.length ? shadowed.map((l) => this.visibility(l, occludes!)) : [];

    // 2) 阴影：自由距离之外填回黑暗（强度=光强：光弱则墙后本来就近似黑）。
    //    楔宽翻倍互相重叠，消除射线扇形间的放射条纹。只处理 shadowed（大光源）。
    c.globalCompositeOperation = "source-over";
    const stepAng = (Math.PI * 2) / RAYS;
    shadowed.forEach((l, li) => {
      const a = Math.min(0.96, l.strength ?? 1);
      if (a < 0.05) return;
      const sx = l.x - camX;
      const sy = l.y - camY;
      c.fillStyle = `rgba(0,0,0,${a})`;
      for (let i = 0; i < RAYS; i++) {
        const free = vis[li][i];
        if (free >= l.r) continue;
        const ang = (i / RAYS) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        c.beginPath();
        c.moveTo(sx + dx * free, sy + dy * free);
        c.arc(sx, sy, l.r + 4, ang - stepAng, ang + stepAng); // 楔宽翻倍：相邻楔重叠，无放射缝
        c.closePath();
        c.fill();
      }
    });

    // 3) 染色：lighter 有色渐变，画在光照层随整层上屏；大光源裁剪到可见距离内
    c.globalCompositeOperation = "lighter";
    onScreen.forEach((l) => {
      const sx = l.x - camX;
      const sy = l.y - camY;
      const tint = l.tint ?? "255,214,150";
      const k = Math.min(1, 62 / Math.max(8, l.r));
      const s = l.strength ?? 1;
      const reach = l.r * 0.85;
      const grad = () => {
        const g = c.createRadialGradient(sx, sy, 0, sx, sy, reach);
        g.addColorStop(0, `rgba(${tint},${(0.20 * k * s).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(${tint},${(0.075 * k * s).toFixed(3)})`);
        g.addColorStop(0.7, `rgba(${tint},${(0.022 * k * s).toFixed(3)})`);
        g.addColorStop(1, `rgba(${tint},0)`);
        return g;
      };
      const si = shadowed.indexOf(l);
      if (si < 0) {
        c.fillStyle = grad();
        c.fillRect(sx - reach, sy - reach, reach * 2, reach * 2);
        return;
      }
      // 逐扇区裁剪：楔宽翻倍互相重叠（与阴影同法），避免放射条纹
      c.fillStyle = grad();
      for (let i = 0; i < RAYS; i++) {
        const free = Math.min(vis[si][i], reach);
        if (free <= 1) continue;
        const ang = (i / RAYS) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        c.beginPath();
        c.moveTo(sx + dx * 1.5, sy + dy * 1.5);
        c.arc(sx, sy, free, ang - stepAng, ang + stepAng);
        c.closePath();
        c.fill();
      }
    });
    c.globalCompositeOperation = "source-over";

    main.drawImage(this.canvas, 0, 0);
  }
}
