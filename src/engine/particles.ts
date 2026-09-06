// 轻量粒子池。全部世界坐标，绘制夹在瓦片之后、光照之前。
// 上限截断：溢出时覆盖最老的，保证最坏情况帧率稳定。
interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  grav: number;
  drag: number;
}

const MAX = 320;

export class Particles {
  private list: P[] = [];

  spawn(o: {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    life?: number;
    size?: number;
    color?: string;
    grav?: number;
    drag?: number;
  }): void {
    const p: P = {
      x: o.x,
      y: o.y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      life: o.life ?? 0.5,
      maxLife: o.life ?? 0.5,
      size: o.size ?? 1,
      color: o.color ?? "#9fe8ff",
      grav: o.grav ?? 0,
      drag: o.drag ?? 0,
    };
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
  }

  burst(
    x: number,
    y: number,
    n: number,
    o: { speed?: number; color?: string; life?: number; size?: number; grav?: number; dir?: number; spread?: number } = {},
  ): void {
    const speed = o.speed ?? 40;
    const spread = o.spread ?? Math.PI * 2;
    const dir = o.dir ?? 0;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: (o.life ?? 0.5) * (0.6 + Math.random() * 0.8),
        size: o.size ?? 1,
        color: o.color ?? "#9fe8ff",
        grav: o.grav ?? 0,
      });
    }
  }

  update(): void {
    const dt = 1 / 60;
    for (const p of this.list) {
      p.life -= dt;
      p.vy += p.grav * dt;
      if (p.drag) {
        p.vx *= 1 - p.drag * dt;
        p.vy *= 1 - p.drag * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const a = Math.min(1, p.life / p.maxLife + 0.2);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size;
      const x = Math.round(p.x - s / 2);
      const y = Math.round(p.y - s / 2);
      ctx.fillRect(x, y, s, s);
      if (s >= 2) {
        ctx.globalAlpha = a * 0.35;
        ctx.fillRect(x - 1, y, s + 2, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.list.length = 0;
  }
}
