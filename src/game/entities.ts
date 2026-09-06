// 房间内的一切可交互物。每类实体实现 update/draw，可选 solidRect / lights / flute。
// 谜题状态全部落在 world.flags（字符串集合）里，实体自身不持有存档态——
// 这样"读档重放"只是按 flags 重建房间，不存在第二份需要同步的状态。
import type { World } from "./world";
import type { Player } from "./player";
import {
  BEAN_GROW_INTERVAL,
  BEAN_LIFE,
  BEAN_MAX_TILES,
  BOUNCE_VEL,
  BUBBLE_LIFE,
  BUBBLE_RISE,
  CRUMBLE_REGROW_TIME,
  CRUMBLE_SHAKE_TIME,
  FLUTE_RADIUS,
  ROOM_H,
  ROOM_W,
  TILE,
} from "./constants";
import { audio } from "../engine/audio";
import { paletteFor } from "./decor";
import type { Light } from "../engine/light";
import { mat, rgbOf, shade } from "../data/materials";
import { propById, type PropDef } from "../data/props";
import { ROOM_POS, BINDING_KIND, type ObjDef, type ObjPos } from "../data/maps";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 单向平台：只挡下落，可以从下方跳穿、不挡横向移动。 */
  oneWay?: boolean;
}

export interface Entity {
  x: number;
  y: number;
  dead: boolean;
  /** 视觉缩放（loadRoom 从 ObjDef.scale/scaleJit 计算）：draw 前由 world 统一施加变换。 */
  scale?: number;
  /** 所属物件类型键：世界层"基础微光"按它取材质。 */
  matKey?: string;
  /** 电梯等载具的所属房间键（跨房投递用）。 */
  homeId?: string;
  update(w: World): void;
  draw(ctx: CanvasRenderingContext2D, w: World): void;
  solidRect?(w: World): Rect | null;
  lights?(w: World): Light[];
  flute?(w: World): void;
  /** 会刺破漂浮泡泡的物体返回其判定矩形（藤蔓丛/小树/蹦菇帽）。 */
  popsBubbles?(): Rect | Rect[] | null;
}

export type ItemId = "whip" | "bubble" | "flute" | "bean";
export const ITEM_ORDER: ItemId[] = ["whip", "bubble", "flute", "bean"];

// ---- 拾取物：道具 / 源种 ----

// ---- 实体基类：所有房间物的公共父类 ----
// 公共字段（位置/存活/缩放/材质键/相位）与抽象 update/draw 收在这里；
// 分类次级基类（LightSource/TriggerSource/MoverPlatform）承载一类物品的共同行为，
// 具体物品类再从次级基类继承——新增物品 = 写一个类 + ENTITY_TYPES 注册一行。

export abstract class BaseEntity implements Entity {
  x = 0;
  y = 0;
  dead = false;
  /** 视觉缩放（loadRoom 按 ObjDef.scale/scaleJit 计算）。 */
  scale?: number;
  /** 所属物件类型键：世界层"基础微光"按它取材质。 */
  matKey?: string;
  /** 载具的所属房间键（跨房投递用）。 */
  homeId?: string;
  /** 环境相位：摇曳/闪烁/脉动的错相种子（需要确定性的子类可覆盖为 0）。 */
  protected t = Math.random() * 10;
  abstract update(w: World): void;
  abstract draw(ctx: CanvasRenderingContext2D, w: World): void;
}

// ---- 次级基类：光源类（蜡烛/吊灯/晶石/萤火虫）——自带光源，radius/intensity 来自数据 ----

export abstract class LightSource extends BaseEntity {
  protected lum: { r: number; k: number };
  protected constructor(defaultR: number, opts: { radius?: number; intensity?: number } = {}, defaultK = 1) {
    super();
    this.lum = { r: Math.max(2, opts.radius ?? defaultR), k: Math.max(0, opts.intensity ?? defaultK) };
  }
}

// ---- 次级基类：开关类（开关/压力板）——自身 id + controls 列表 + 触发方式共享 ----
// 多对多：controls=会被触发的被控物件 id 列表（门/电梯/睡莲的 id），
// 由 world.fireControls 统一分派（门走 flag/TTL、载具走边沿脉冲）。
// 自身 id 同时充当一次性开关的存档 flag 键（switch:<id> / plate:<id>）——列表重排也不会错位。

export abstract class TriggerSource extends BaseEntity {
  readonly id: string;
  readonly controls: string[];
  readonly reset?: number;
  readonly kind: "door" | "mover";
  private readonly flagPrefix: string;
  constructor(
    x: number,
    y: number,
    id: string,
    controls: string[],
    kind: "door" | "mover",
    flagPrefix: string,
    reset?: number,
  ) {
    super();
    this.id = id;
    this.controls = controls;
    this.kind = kind;
    this.flagPrefix = flagPrefix;
    this.reset = reset;
    this.x = x * TILE + TILE / 2;
    this.y = y * TILE + TILE / 2;
  }
  /** 当前是否处于触发态（点亮/按压的视觉与"已触发过"的守卫）：
   *  瞬时开关=触发总线任一目标还活着；一次性=本开关已记档。 */
  on(w: World): boolean {
    return this.reset != null
      ? this.controls.some((cid) => w.triggerActive(cid))
      : w.flags.has(`${this.flagPrefix}:${this.id}`);
  }
  /** 触发一次：一次性开关记自己的档（防同一步重复触发）+ 往 controls 分派。 */
  protected fire(w: World, burstN: number, burstSpeed: number): void {
    audio.switchClick();
    w.particles.burst(this.x, this.y - 2, burstN, { speed: burstSpeed, color: "#e0cc96", life: 0.4 });
    if (this.reset == null) w.flags.add(`${this.flagPrefix}:${this.id}`);
    w.fireControls(this.controls, this.kind, this.reset);
  }
}

// ---- 次级基类：移动平台类（睡莲/电梯）——位移向量 + 匀速趋近 + 搬运角色 ----

export abstract class MoverPlatform extends BaseEntity {
  /** 当前离基准点的位移（px）。 */
  protected off = { x: 0, y: 0 };
  /** 以 speed 匀速趋近目标点，返回剩余距离。 */
  protected moveToward(target: { x: number; y: number }, speed: number, dt: number): number {
    const dx = target.x - this.off.x;
    const dy = target.y - this.off.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return dist;
    const step = Math.min(dist, speed * dt);
    this.off.x += (dx / dist) * step;
    this.off.y += (dy / dist) * step;
    return dist;
  }
  /** 把站在平台顶面的角色一起搬（下落/起跳瞬间不拽）。 */
  protected carry(w: World, dx: number, dy: number, plat: Rect): void {
    if (dx === 0 && dy === 0) return;
    if (standingOn(w, plat, false) && w.player.vy >= -10) {
      w.player.x += dx;
      w.player.y += dy;
    }
  }
}

export class Pickup extends BaseEntity {
  private bob = Math.random() * Math.PI * 2;
  constructor(
    x: number,
    y: number,
    private readonly kind: { type: "item"; item: ItemId } | { type: "seed"; id: number },
    private readonly radius = 8,
  ) {
    super();
    this.x = x;
    this.y = y;
  }
  private taken(w: World): boolean {
    return this.kind.type === "seed"
      ? w.seeds.has(this.kind.id)
      : w.items.has(this.kind.item);
  }
  update(w: World): void {
    if (this.taken(w)) {
      this.dead = true;
      return;
    }
    this.bob += (1 / 60) * 2.4;
    const p = w.player;
    const dx = p.x - this.x;
    const dy = p.y - (this.y + Math.sin(this.bob) * 1.5);
    if (dx * dx + dy * dy < this.radius * this.radius) {
      if (this.kind.type === "seed") {
        w.seeds.add(this.kind.id);
        audio.seedGet();
        w.particles.burst(this.x, this.y, 14, { speed: 45, color: "#ffe9a8", life: 0.7 });
      } else {
        w.items.add(this.kind.item);
        w.activeItem = this.kind.item;
        audio.itemGet();
        w.particles.burst(this.x, this.y, 10, { speed: 40, color: "#b8f0cc", life: 0.6 });
        w.toast(this.kind.item);
      }
      w.saveGame();
      this.dead = true;
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    if (this.taken(w)) return;
    const pal = paletteFor(w.depth());
    const yy = this.y + Math.sin(this.bob) * 1.5;
    const ix = Math.round(this.x);
    if (this.kind.type === "item") {
      // 石龛：拱顶壁龛 + 苔沿，道具供在里面
      ctx.fillStyle = pal.rockDeep;
      ctx.fillRect(ix - 6, Math.round(this.y) + 5, 12, 5);
      ctx.fillStyle = pal.rock[0];
      ctx.fillRect(ix - 5, Math.round(this.y) + 4, 10, 3);
      ctx.fillStyle = pal.rock[2];
      ctx.fillRect(ix - 4, Math.round(this.y) + 3, 8, 2);
      ctx.fillStyle = pal.lip;
      ctx.fillRect(ix - 5, Math.round(this.y) + 8, 10, 1);
      ctx.fillStyle = pal.moss;
      ctx.fillRect(ix - 5, Math.round(this.y) + 5, 3, 1);
      ctx.fillRect(ix + 2, Math.round(this.y) + 6, 2, 1);
      const pr = 6.5 + Math.sin(this.bob * 0.8) * 0.9;
      ctx.strokeStyle = "rgba(190,255,215,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, yy - 1, pr, 0, Math.PI * 2);
      ctx.stroke();
      drawItemGlyph(ctx, this.kind.item, this.x - 3, yy - 4);
    } else {
      // 源种：金珠 + 双叶芽 + 呼吸光环
      const pulse = 0.38 + Math.sin(this.bob * 1.1) * 0.18;
      const r = 5.2 + Math.sin(this.bob) * 0.7;
      ctx.strokeStyle = `rgba(255,225,150,${pulse.toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, yy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#6a4a20";
      ctx.fillRect(ix - 2, Math.round(yy) - 2, 4, 4);
      ctx.fillStyle = mat("seed").base;
      ctx.fillRect(ix - 1, Math.round(yy) - 1, 3, 3);
      ctx.fillStyle = mat("seed").accent;
      ctx.fillRect(ix - 1, Math.round(yy) - 1, 1, 1);
      ctx.fillStyle = "#c9a05a";
      ctx.fillRect(ix + 1, Math.round(yy) + 1, 1, 1);
      ctx.fillStyle = "#3a4a28";
      ctx.fillRect(ix, Math.round(yy) - 4, 1, 2);
      ctx.fillStyle = "#8a9a48";
      ctx.fillRect(ix - 1, Math.round(yy) - 5, 2, 1);
      ctx.fillRect(ix + 1, Math.round(yy) - 4, 2, 1);
      if (Math.random() < 0.06) {
        w.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 4,
          y: yy + (Math.random() - 0.5) * 4,
          vy: -6,
          life: 0.5,
          color: "#ffe9a8",
        });
      }
    }
  }
  lights(w: World): Light[] {
    if (this.taken(w)) return [];
    return this.kind.type === "seed"
      ? [{ x: this.x, y: this.y, r: 10, tint: mat("seed").glow }]
      : [{ x: this.x, y: this.y, r: 13, tint: "170,255,200" }];
  }
}

export function drawItemGlyph(ctx: CanvasRenderingContext2D, item: ItemId, x: number, y: number): void {
  ctx.lineWidth = 1; // HUD 每帧最后画：笔宽显式归一，不吃场景遗留
  if (item === "whip") {
    ctx.fillStyle = "#6a4a28";
    ctx.fillRect(x, y + 5, 2, 2);
    ctx.strokeStyle = "#3a5234";
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 5);
    ctx.quadraticCurveTo(x + 6, y + 4, x + 5, y);
    ctx.stroke();
    ctx.strokeStyle = mat("item").accent;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 4);
    ctx.quadraticCurveTo(x + 5, y + 3, x + 5, y + 1);
    ctx.stroke();
    ctx.fillStyle = "#d8ffe8";
    ctx.fillRect(x + 5, y, 2, 1);
  } else if (item === "bubble") {
    ctx.strokeStyle = "#4a7a98";
    ctx.beginPath();
    ctx.arc(x + 3.5, y + 3.5, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#9fdcff";
    ctx.beginPath();
    ctx.arc(x + 3.5, y + 3.5, 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d8f2ff";
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(x + 5, y + 4, 1, 1);
  } else if (item === "bean") {
    ctx.fillStyle = "#3a2410";
    ctx.fillRect(x + 1, y + 3, 5, 3);
    ctx.fillStyle = mat("item").base;
    ctx.fillRect(x + 2, y + 3, 4, 3);
    ctx.fillStyle = "#8a6030";
    ctx.fillRect(x + 4, y + 4, 1, 1);
    ctx.fillStyle = "#e8c878";
    ctx.fillRect(x + 2, y + 3, 1, 1);
    ctx.fillStyle = "#3a4a28";
    ctx.fillRect(x + 3, y + 1, 1, 2);
    ctx.fillStyle = "#8a9a48";
    ctx.fillRect(x + 4, y, 2, 1);
  } else {
    ctx.fillStyle = "#4a3014";
    ctx.fillRect(x + 2, y, 3, 7);
    ctx.fillStyle = mat("item").base;
    ctx.fillRect(x + 3, y, 2, 7);
    ctx.fillStyle = "#e8c878";
    ctx.fillRect(x + 3, y, 1, 7);
    ctx.fillStyle = "#2a2010";
    ctx.fillRect(x + 3, y + 2, 1, 1);
    ctx.fillRect(x + 3, y + 4, 1, 1);
    ctx.fillStyle = mat("item").accent;
    ctx.fillRect(x + 4, y + 6, 1, 1);
  }
}

// ---- 钩环 ----

export class Ring extends BaseEntity {
  constructor(x: number, y: number) {
    super();
    this.x = x * TILE + TILE / 2;
    this.y = y * TILE + TILE / 2;
  }
  update(_w: World): void { }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const m = mat("ring");
    ctx.fillStyle = "#120e08";
    ctx.fillRect(this.x - 1, this.y - 6, 2, 3);
    ctx.fillStyle = "#3a2a18";
    ctx.fillRect(this.x - 2, this.y - 6, 4, 2);
    ctx.fillStyle = m.accent;
    ctx.fillRect(this.x - 1, this.y - 6, 2, 1);
    ctx.strokeStyle = "#1a1208";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(this.x, this.y + 1, 3.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = m.base;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y + 1, 3.2, 0, Math.PI * 2);
    ctx.stroke();
    const a0 = w.time * 1.6 + this.x * 0.05;
    ctx.strokeStyle = m.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y + 1, 3.2, a0, a0 + 1.05);
    ctx.stroke();
    ctx.fillStyle = "#f0e0b0";
    ctx.fillRect(this.x - 3, this.y - 1, 1, 1);
  }
}

// ---- 鞭击机关 ----

export class Switch extends TriggerSource {
  /** reset 见 TriggerSource：配了=瞬时触发（到时自动复位）；不配=一次性。 */
  constructor(x: number, y: number, id: string, controls: string[], kind: "door" | "mover", reset?: number) {
    super(x, y, id, controls, kind, "switch", reset);
  }
  update(w: World): void {
    if (this.on(w)) return;
    if (w.player.whipHeld && !w.playerWhipConsumed(this) && w.whipHits({ x: this.x - 3, y: this.y - 4, w: 6, h: 8 })) {
      w.markWhipHit(this);
      this.fire(w, 6, 24);
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const lit = this.on(w);
    const pal = paletteFor(w.depth());
    const m = mat("switch");
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    ctx.fillStyle = pal.rockDeep;
    ctx.fillRect(x - 5, y + 3, 10, 3);
    ctx.fillStyle = pal.rock[1];
    ctx.fillRect(x - 4, y + 2, 8, 2);
    ctx.fillStyle = pal.lip;
    ctx.fillRect(x - 4, y + 2, 8, 1);
    ctx.fillStyle = pal.moss;
    ctx.fillRect(x - 4, y + 4, 2, 1);
    ctx.fillStyle = "#3a3834";
    ctx.fillRect(x - 1, y - 1, 2, 4);
    ctx.fillStyle = "#6a625a";
    ctx.fillRect(x - 1, y - 1, 1, 4);
    ctx.fillStyle = lit ? m.accent : m.base;
    ctx.fillRect(x - 2, y - 5, 4, 4);
    ctx.fillStyle = lit ? "#e6ffe9" : "#8a6a3a";
    ctx.fillRect(x - 1, y - 5, 2, 2);
    if (lit) {
      const pulse = 4.8 + Math.sin(w.time * 3) * 0.9;
      ctx.strokeStyle = `rgba(170,240,185,${(0.3 + Math.sin(w.time * 3) * 0.12).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 3, pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  lights(w: World): Light[] {
    return this.on(w) ? [{ x: this.x, y: this.y, r: 8, tint: mat("switch").glow, strength: 1 }] : [];
  }
}

// ---- 荆棘门 ----

export class Door extends BaseEntity {
  readonly rect: Rect;
  private openT = 0; // 收门动画 0→1：整扇门沉入下方地面（竖门像闸门落下，横门像活板下沉）
  constructor(
    x: number,
    y: number,
    readonly tw: number,
    readonly th: number,
    readonly id: string,
    /** 脆弱侧：鞭子从这一侧抽到门上才能击破；另一侧敲上去只有火星。 */
    readonly fragile?: "left" | "right",
    /** 退出方向：v=整扇沉入地底（默认）；h=缩向较近的侧墙里。 */
    readonly dir: "v" | "h" = "v",
    /** 进房时门就已经是开的：直接呈现收起完成态，不重播开电动画。 */
    openAtLoad = false,
  ) {
    super();
    this.rect = { x: x * TILE, y: y * TILE, w: tw * TILE, h: th * TILE };
    this.x = this.rect.x + this.rect.w / 2;
    this.y = this.rect.y + this.rect.h / 2;
    if (openAtLoad) {
      this.openT = 1;
      this.dead = true;
    }
  }
  private open(w: World): boolean {
    // 永久 flag（鞭破/一次性开关）或瞬时触发激活中（reset 开关/压力板）都算开；
    // 触发到期 → 门自动重新闭合（开关复位=门复位，只对门有这层额外语义）
    return w.flags.has(`door:${this.id}`) || w.triggerActive(this.id);
  }
  update(w: World): void {
    if (this.open(w)) {
      if (this.openT === 0) {
        w.particles.burst(this.rect.x + this.rect.w / 2, this.rect.y + this.rect.h / 2, 12, {
          speed: 30,
          color: "#7fae8c",
          life: 0.5,
          grav: 80,
        });
      }
      if (this.openT < 1) {
        this.openT = Math.min(1, this.openT + 1 / 60 / 0.45);
        // 永久 flag 的门收干净后即可从场景移除；触发驱动的门留着（复位要长回来）
        if (this.openT >= 1 && w.flags.has(`door:${this.id}`)) this.dead = true;
      }
      return;
    }
    if (this.openT > 0) {
      // 复位：门重新长回原位（动画与收门对称）
      this.openT = Math.max(0, this.openT - 1 / 60 / 0.45);
      return;
    }
    // 脆弱门可被鞭子击破——只认脆弱侧；另一侧免疫（藤条从那边长死的，结构吃力）
    if (this.fragile && w.player.whipHeld && !w.playerWhipConsumed(this) && w.whipHits(this.rect)) {
      w.markWhipHit(this);
      const fromFragile =
        this.fragile === "right" ? w.player.x > this.rect.x + this.rect.w : w.player.x < this.rect.x;
      if (fromFragile) {
        w.openDoor(this.id); // 音效/存档/收门动画都从这里走
        w.saveGame();
      } else {
        // 免疫反馈：火星四溅，纹丝不动
        audio.switchClick();
        const hx = this.fragile === "right" ? this.rect.x : this.rect.x + this.rect.w;
        w.particles.burst(hx, w.player.y, 6, { speed: 40, color: "#c8b890", life: 0.3, grav: 160 });
      }
    }
  }
  solidRect(): Rect | null {
    return this.openT > 0 ? null : this.rect; // 开始下沉即可通行（视觉在收，判定先让路）
  }
  private drawBody(ctx: CanvasRenderingContext2D, r: Rect, w: World): void {
    const t = w.time;
    const m = mat("door");
    // 暗藤底
    ctx.fillStyle = shade(m.base, 0.5);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 编织藤浪：竖向波浪线，缓慢呼吸
    ctx.strokeStyle = m.base;
    ctx.lineWidth = 1;
    for (let i = 2; i < r.w - 1; i += 4) {
      ctx.beginPath();
      for (let y = r.y; y <= r.y + r.h; y += 3) {
        const wx = r.x + i + Math.sin(y * 0.5 + t * 1.3 + i) * 1.2;
        if (y === r.y) ctx.moveTo(wx, y);
        else ctx.lineTo(wx, y);
      }
      ctx.stroke();
    }
    // 亮刺钉：沿长度散布的荆棘眼
    ctx.fillStyle = m.accent;
    for (let i = 1; i < r.w - 1; i += 5) {
      ctx.fillRect(r.x + i, r.y + ((i * 7 + Math.floor(t * 2)) % Math.max(1, r.h - 1)), 1, 1);
    }
    ctx.fillStyle = shade(m.base, 0.3);
    ctx.fillRect(r.x, r.y, 1, r.h);
    ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    ctx.fillStyle = shade(m.accent, 0.85);
    for (let i = 3; i < r.h - 2; i += 7) {
      ctx.fillRect(r.x + 1, r.y + i, 2, 1);
      ctx.fillRect(r.x + r.w - 3, r.y + i + 2, 2, 1);
    }
    // 脆弱侧外观：枯色 + 裂纹 + 缺口——看上去一抽就断
    if (this.fragile) {
      const fx = this.fragile === "right" ? r.x + r.w - 4 : r.x + 1;
      ctx.fillStyle = "#4e6a44";
      ctx.fillRect(fx, r.y, 3, r.h);
      ctx.strokeStyle = "#8fae7a";
      for (let i = 2; i < r.h - 1; i += 5) {
        const inward = this.fragile === "right" ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(fx + (this.fragile === "right" ? 3 : 0), r.y + i);
        ctx.lineTo(fx + inward * 2, r.y + i + 2);
        ctx.lineTo(fx + inward * 1, r.y + i + 4);
        ctx.stroke();
      }
      ctx.fillStyle = "#0b1410";
      const chipX = this.fragile === "right" ? r.x + r.w - 2 : r.x;
      ctx.fillRect(chipX, r.y + 2, 2, 3);
      ctx.fillRect(chipX, r.y + r.h - 6, 2, 2);
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    if (this.dead) return;
    if (!this.open(w)) {
      this.drawBody(ctx, this.rect, w);
      return;
    }
    // 收门中：按退出方向缩没——v 整扇向下降入地底；h 缩向较近的侧墙
    const t = this.openT;
    let vis: Rect;
    if (this.dir === "h") {
      // 缩向较近的侧墙：门在右半场就缩向右、在左半场缩向左
      const slideRight = this.rect.x + this.rect.w / 2 >= ROOM_W / 2;
      vis = slideRight
        ? { x: this.rect.x + this.rect.w * t, y: this.rect.y, w: this.rect.w * (1 - t), h: this.rect.h }
        : { x: this.rect.x, y: this.rect.y, w: this.rect.w * (1 - t), h: this.rect.h };
    } else {
      vis = { x: this.rect.x, y: this.rect.y + this.rect.h * t, w: this.rect.w, h: this.rect.h * (1 - t) };
    }
    if (vis.w >= 1 && vis.h >= 1) this.drawBody(ctx, vis, w);
  }
}

// ---- 压力板：踩上触发，收进目标门。默认永久（存档持久）；配 reset 秒则为瞬时触发（喂触发总线，可复位） ----

export class PressurePlate extends TriggerSource {
  private pressed = false; // 上一帧是否被踩住（刚踩上时播一次音效/粒子）
  constructor(tx: number, ty: number, id: string, controls: string[], kind: "door" | "mover", reset?: number) {
    super(tx, ty, id, controls, kind, "plate", reset);
    // 板面贴地：y = 脚下地面顶（与开关的格中心不同）
    this.x = tx * TILE + TILE / 2;
    this.y = (ty + 1) * TILE;
  }
  private standing(p: Player): boolean {
    return p.deadT <= 0 && p.grounded && Math.abs(p.x - this.x) < 7 && Math.abs(p.y + 4 - this.y) < 4;
  }
  update(w: World): void {
    this.t += 1 / 60;
    const p = w.player;
    if (this.reset != null) {
      // 可复位压力板：踩着就一直压住（触发 TTL 每帧续期），**离开板面才开始计时**
      const on = this.standing(p);
      if (on && !this.pressed) {
        audio.switchClick();
        w.particles.burst(this.x, this.y - 2, 8, { speed: 22, color: "#e0cc96", life: 0.4 });
      }
      this.pressed = on;
      if (on) w.fireControls(this.controls, this.kind, this.reset);
      return;
    }
    if (this.on(w)) return;
    if (p.deadT > 0 || !p.grounded) return;
    // 一次性板：站上即触发（永久）
    if (Math.abs(p.x - this.x) < 7 && Math.abs(p.y + 4 - this.y) < 4) {
      this.fire(w, 8, 22);
    }
  }
  lights(w: World): Light[] {
    return this.on(w) ? [{ x: this.x, y: this.y - 2, r: 9, tint: mat("plate").glow, strength: 0.9 }] : [];
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const on = this.on(w);
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const lift = on ? 0 : 2;
    const pal = paletteFor(w.depth());
    ctx.fillStyle = pal.rockDeep;
    ctx.fillRect(x - 6, y - 2, 12, 3);
    ctx.fillStyle = pal.rock[1];
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillStyle = shade(mat("plate").base, 0.75);
    ctx.fillRect(x - 4, y - 1 - lift, 8, 1 + lift);
    ctx.fillStyle = on ? mat("plate").accent : mat("plate").base;
    ctx.fillRect(x - 4, y - 1 - lift, 8, 1);
    ctx.fillStyle = pal.lip;
    ctx.fillRect(x - 4, y - 1 - lift, 8, 1);
    ctx.fillStyle = pal.rockDeep;
    ctx.fillRect(x - 6, y - 1, 1, 2);
    ctx.fillRect(x + 5, y - 1, 1, 2);
    if (on) {
      ctx.fillStyle = mat("plate").accent;
      ctx.fillRect(x - 1, y - 4, 2, 1);
    } else {
      ctx.fillStyle = pal.moss;
      ctx.fillRect(x - 3, y - 1 - lift, 2, 1);
    }
  }
}

// ---- 藤蔓墙（藤鞭可砍） ----

export class VineBud extends BaseEntity {
  readonly rect: Rect;
  constructor(
    x: number,
    y: number,
    readonly th: number,
    readonly key: string,
  ) {
    super();
    this.rect = { x: x * TILE, y: y * TILE, w: TILE, h: th * TILE };
  }
  private cut(w: World): boolean {
    return w.flags.has(`vinebud:${this.key}`);
  }
  update(w: World): void {
    if (this.cut(w)) {
      this.dead = true;
      return;
    }
    if (w.player.whipHeld && !w.playerWhipConsumed(this) && w.whipHits(this.rect)) {
      w.markWhipHit(this);
      w.flags.add(`vinebud:${this.key}`);
      audio.whip();
      audio.bubblePop();
      w.particles.burst(this.rect.x + 5, this.rect.y + this.rect.h / 2, 18, {
        speed: 55,
        color: "#7fd4a0",
        life: 0.7,
        grav: 120,
      });
      w.saveGame();
      this.dead = true;
    }
  }
  solidRect(w: World): Rect | null {
    return this.cut(w) ? null : this.rect;
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    if (this.cut(w)) return;
    const r = this.rect;
    const t = w.time;
    const m = mat("bud");
    ctx.fillStyle = shade(m.base, 0.5);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 横向藤浪：整面墙在缓慢呼吸
    ctx.strokeStyle = m.base;
    ctx.lineWidth = 1;
    for (let i = 0; i < r.h; i += 3) {
      const sway = Math.sin(i * 1.7 + t * 1.2) * 1.5;
      ctx.beginPath();
      ctx.moveTo(r.x + 1 + sway, r.y + i);
      ctx.quadraticCurveTo(r.x + 5 + sway, r.y + i + 2, r.x + r.w - 1 - sway, r.y + i + 3);
      ctx.stroke();
    }
    // 中央活脉 + 荆棘眼
    ctx.fillStyle = shade(m.base, 1.25);
    ctx.fillRect(r.x + 3, r.y + 1, 1, r.h - 2);
    ctx.fillStyle = m.accent;
    for (let i = 2; i < r.h; i += 4) {
      ctx.fillRect(r.x + 6, r.y + i, 1, 1);
      if (Math.sin(t * 2 + i) > 0.6) ctx.fillRect(r.x + 2, r.y + i + 2, 1, 1);
    }
    ctx.fillStyle = shade(m.base, 0.3);
    ctx.fillRect(r.x, r.y, 1, r.h);
    ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    ctx.fillStyle = "#2a3a22";
    ctx.fillRect(r.x + 1, r.y, r.w - 2, 1);
    ctx.fillRect(r.x + 1, r.y + r.h - 1, r.w - 2, 1);
  }
}

// ---- 休眠花苞（孢子笛吹开成平台） ----

export class Bud extends BaseEntity {
  private bloomT = 0; // 开花动画 0→1
  constructor(
    readonly tx: number,
    readonly ty: number,
    readonly key: string,
    /** 进房时就已经开过：直接盛开态，不重播开花动画。 */
    bloomAtLoad = false,
  ) {
    super();
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE + TILE / 2;
    if (bloomAtLoad) this.bloomT = 1;
  }
  private bloomed(w: World): boolean {
    return w.flags.has(`bud:${this.key}`);
  }
  update(w: World): void {
    if (this.bloomed(w)) this.bloomT = Math.min(1, this.bloomT + 1 / 60 / 0.4);
  }
  flute(w: World): void {
    if (this.bloomed(w)) return;
    const dx = w.player.x - this.x;
    const dy = w.player.y - this.y;
    if (dx * dx + dy * dy < FLUTE_RADIUS * FLUTE_RADIUS) {
      w.flags.add(`bud:${this.key}`);
      audio.bloom();
      w.particles.burst(this.x, this.y, 14, {
        speed: 35,
        color: "#cfe8d8",
        life: 0.9,
        grav: -20,
      });
      w.saveGame();
    }
  }
  solidRect(w: World): Rect | null {
    return this.bloomed(w) ? { x: this.x - 12, y: this.y - 2, w: 24, h: 5, oneWay: true } : null;
  }
  lights(w: World): Light[] {
    // 多态发光：休眠=微弱内辉，盛开=明亮唤目（颜色都走材质）
    return this.bloomed(w)
      ? [{ x: this.x, y: this.y - 2, r: 15, tint: mat("bud").glow, strength: 1 }]
      : [{ x: this.x, y: this.y, r: 7, tint: mat("bud").glow, strength: 0.3 }];
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    if (this.bloomed(w)) {
      const t = this.bloomT;
      ctx.strokeStyle = "#2a4a32";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + 5);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.strokeStyle = "#4c8a5e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + 5);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      // 开花后花瓣铺满整个花台（判定 24px 宽）：左右两瓣顶到台缘，看得见站得下
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * (Math.PI / 4.2) * t;
        const px = this.x + Math.cos(a) * 10.5 * t;
        const py = this.y - 1 + Math.sin(a) * 7 * t;
        ctx.fillStyle = shade(mat("bud").base, 0.7);
        ctx.fillRect(Math.round(px) - 2, Math.round(py) - 1, 4, 2);
        ctx.fillStyle = mat("bud").accent;
        ctx.fillRect(Math.round(px) - 1, Math.round(py), 3, 1);
      }
      ctx.fillStyle = "#fff3cf";
      ctx.fillRect(Math.round(this.x) - 2, Math.round(this.y) - 3, 4, 3);
      ctx.fillStyle = "#ffe9a8";
      ctx.fillRect(Math.round(this.x) - 1, Math.round(this.y) - 3, 1, 1);
    } else {
      const sq = Math.sin(this.y + w.time * 2) * 0.5;
      const glow = 0.32 + Math.sin(w.time * 2.2 + this.y) * 0.22;
      ctx.strokeStyle = `rgba(140,235,220,${glow.toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y + sq, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#1a2a22";
      ctx.fillRect(Math.round(this.x) - 3, Math.round(this.y - 1 + sq), 6, 6);
      ctx.fillStyle = mat("bud").base;
      ctx.fillRect(Math.round(this.x) - 2, Math.round(this.y - 1 + sq), 4, 5);
      ctx.fillStyle = shade(mat("bud").base, 1.3);
      ctx.fillRect(Math.round(this.x) - 1, Math.round(this.y - 4 + sq), 2, 4);
      ctx.fillStyle = mat("bud").accent;
      ctx.fillRect(Math.round(this.x) - 1, Math.round(this.y + sq), 1, 2);
      ctx.strokeStyle = "#4c8a5e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + 5);
      ctx.lineTo(this.x, this.y + 7);
      ctx.stroke();
    }
  }
}

// ---- 毒孢子云 ----

export class SporeCloud extends BaseEntity {
  readonly rect: Rect;
  constructor(
    tx: number,
    ty: number,
    readonly tw: number,
    readonly th: number,
  ) {
    super();
    this.rect = { x: tx * TILE, y: ty * TILE, w: tw * TILE, h: th * TILE };
    this.x = this.rect.x + this.rect.w / 2;
    this.y = this.rect.y + this.rect.h / 2;
  }
  update(w: World): void {
    this.t += 1 / 60;
    if (Math.random() < 0.3) {
      w.particles.spawn({
        x: this.rect.x + Math.random() * this.rect.w,
        y: this.rect.y + Math.random() * this.rect.h,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 3,
        life: 0.9,
        color: "#8fe8a8",
        size: 1,
      });
    }
  }
  // 毒雾自发光：能杀角色的东西不许藏进黑暗里
  lights(): Light[] {
    const r = this.rect;
    return [{ x: r.x + r.w / 2, y: r.y + r.h / 2, r: Math.max(r.w, r.h) * 0.85, tint: mat("spores").glow, strength: 0.8 }];
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    const pulse = 0.17 + Math.sin(this.t * 1.4) * 0.05;
    const core = rgbOf(mat("spores").base);
    const deep = rgbOf(shade(mat("spores").base, 0.55));
    const dot = rgbOf(mat("spores").accent);
    const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 2, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.7);
    g.addColorStop(0, `rgba(${core}, ${(pulse * 1.6).toFixed(3)})`);
    g.addColorStop(1, `rgba(${deep}, ${(pulse * 0.8).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = `rgba(${dot}, ${(pulse * 1.5).toFixed(3)})`;
    for (let i = 0; i < r.w; i += 3) {
      const yy = r.y + 2 + ((Math.sin(i * 3.1 + this.t * 2) + 1) / 2) * (r.h - 4);
      ctx.fillRect(r.x + i, Math.round(yy), 2, 1);
    }
  }
}

// ---- 孢子游魂 ----

export class Wisp extends BaseEntity {
  private pacifyT = 0;
  constructor(
    readonly ax: number,
    readonly ay: number,
  ) {
    super();
    this.x = ax * TILE + TILE / 2;
    this.y = ay * TILE + TILE / 2;
  }
  update(w: World): void {
    const dt = 1 / 60;
    this.t += dt;
    this.pacifyT = Math.max(0, this.pacifyT - dt);
    const p = w.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d2 = dx * dx + dy * dy;

    if (this.pacifyT > 0) {
      // 被安抚：慢悠悠漂回锚点
      this.x += (this.axPx + Math.cos(this.t * 0.7) * 10 - this.x) * dt * 0.8;
      this.y += (this.ayPx + Math.sin(this.t * 0.9) * 8 - this.y) * dt * 0.8;
    } else if (d2 < 48 * 48 && p.deadT <= 0 && !w.locked) {
      const d = Math.sqrt(d2) || 1;
      const sp = 27;
      this.x += (dx / d) * sp * dt;
      this.y += (dy / d) * sp * dt;
    } else {
      this.x += (this.axPx + Math.cos(this.t * 0.5) * 12 - this.x) * dt;
      this.y += (this.ayPx + Math.sin(this.t * 0.8) * 10 - this.y) * dt;
    }

    if (this.pacifyT <= 0 && d2 < 49 && p.deadT <= 0 && p.invuln <= 0) {
      // 未安抚的游魂碰身：掉 1 血 + 闪烁无敌 + 击退（血尽回存档花），不再送回入口
      w.wispTouch(this);
    }
  }
  get axPx(): number {
    return this.ax * TILE + TILE / 2;
  }
  get ayPx(): number {
    return this.ay * TILE + TILE / 2;
  }
  flute(w: World): void {
    const dx = w.player.x - this.x;
    const dy = w.player.y - this.y;
    if (dx * dx + dy * dy < FLUTE_RADIUS * FLUTE_RADIUS) {
      this.pacifyT = 8;
      audio.pacify();
      w.particles.burst(this.x, this.y, 8, { speed: 22, color: "#aef0b8", life: 0.8, grav: -14 });
    }
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const calm = this.pacifyT > 0;
    const wob = Math.sin(this.t * 6) * 0.8;
    const jit = calm ? 0 : Math.sin(this.t * 21) * 0.6;
    const x = Math.round(this.x + jit);
    const y = Math.round(this.y + wob);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = calm ? mat("wisp").base : "#6a3a30";
    ctx.fillRect(x - 3 - Math.round(Math.sin(this.t * 9) * 1.5), y + 4, 6, 4);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x - 2 - Math.round(Math.sin(this.t * 7) * 1), y + 2, 5, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0c1216";
    ctx.fillRect(x - 3, y - 4, 7, 8);
    ctx.fillRect(x - 4, y - 2, 9, 5);
    ctx.fillStyle = calm ? shade(mat("wisp").base, 0.55) : "#3a201c";
    ctx.fillRect(x - 2, y - 3, 5, 6);
    ctx.fillStyle = calm ? shade(mat("wisp").base, 0.8) : "#5a3028";
    ctx.fillRect(x - 1, y - 2, 3, 4);
    ctx.fillStyle = calm ? mat("wisp").accent : "#ff9a76";
    ctx.fillRect(x - 2, y - 1, 2, 2);
    ctx.fillRect(x + 1, y - 1, 2, 2);
    ctx.fillStyle = "#fff3cf";
    ctx.fillRect(x - 2, y - 1, 1, 1);
    ctx.fillRect(x + 1, y - 1, 1, 1);
    if (!calm && Math.floor(this.t * 8) % 3 === 0) {
      ctx.fillStyle = "#ffd0a8";
      ctx.fillRect(x - 2, y - 1, 2, 1);
      ctx.fillRect(x + 1, y - 1, 2, 1);
      ctx.fillStyle = "#6a3a2a";
      ctx.fillRect(x - 1, y + 1, 3, 1);
    }
    if (calm) {
      ctx.fillStyle = mat("wisp").accent;
      ctx.fillRect(x - 1, y - 5, 1, 2);
      ctx.fillRect(x + 2, y - 6, 1, 1);
    }
  }
  lights(): Light[] {
    return [{ x: this.x, y: this.y, r: this.pacifyT > 0 ? 9 : 7, tint: this.pacifyT > 0 ? mat("wisp").glow : "255,130,80" }];
  }
}

// ---- 根台：竖井壁上伸出的根须平台，防止"掉下去就回不来" ----

export class Ledge extends BaseEntity {
  readonly rect: Rect;
  constructor(
    tx: number,
    ty: number,
    readonly tw: number,
  ) {
    super();
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.rect = { x: this.x, y: this.y, w: tw * TILE, h: 6 };
  }
  update(_w: World): void { }
  solidRect(_w: World): Rect | null {
    return { ...this.rect, oneWay: true }; // 根台是单向平台：从下方可跳穿
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    const m = mat("ledge");
    ctx.fillStyle = "#0a0806";
    ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.fillStyle = shade(m.base, 0.7);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = m.base;
    ctx.fillRect(r.x, r.y + 1, r.w, r.h - 2);
    ctx.fillStyle = shade(m.base, 1.45);
    ctx.fillRect(r.x, r.y, r.w, 2);
    ctx.fillStyle = m.accent;
    ctx.fillRect(r.x, r.y, r.w, 1);
    ctx.fillStyle = "#2a2218";
    for (let i = 3; i < r.w - 2; i += 6) {
      ctx.fillRect(r.x + i, r.y + 3, 2, 1);
    }
    ctx.strokeStyle = "#2a2218";
    ctx.lineWidth = 1;
    for (let i = 2; i < r.w; i += 5) {
      ctx.beginPath();
      ctx.moveTo(r.x + i, r.y + r.h);
      ctx.quadraticCurveTo(r.x + i + 1, r.y + r.h + 4, r.x + i - 2, r.y + r.h + 8);
      ctx.stroke();
    }
  }
}

// ---- 蹦菇：踩上去会被弹起的巨型蘑菇帽（弹高≈5.5 格，比跳高两格多） ----

export class BounceShroom extends BaseEntity {
  private squash = 0;
  constructor(tx: number, ty: number) {
    super();
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE + TILE; // 基部（脚下瓦片底）
  }
  get capTop(): number {
    return this.y - 6;
  }
  update(w: World): void {
    this.t += 1 / 60;
    this.squash = Math.max(0, this.squash - 1 / 60 * 3);
    const p = w.player;
    if (p.deadT > 0 || p.shieldT > 0 || p.climb) return;
    // 帽子不做实心：下落中脚穿过帽顶平面 → 拍住弹起；地面行走（vy≈0）径直穿过互不干扰
    if (
      !p.swing &&
      p.vy > 60 &&
      Math.abs(p.x - this.x) < 14 &&
      p.y + 4 >= this.capTop - 6 &&
      p.y + 4 <= this.capTop + 8
    ) {
      p.y = this.capTop - 4;
      p.vy = -BOUNCE_VEL;
      p.jumpCutting = false; // 弹跳是完整冲量
      p.grounded = false;
      this.squash = 1;
      audio.bounce();
      w.particles.burst(this.x, this.capTop, 6, { speed: 32, color: "#b8f0cc", life: 0.4, grav: 220 });
    }
  }
  solidRect(): Rect | null {
    return null; // 不做实心：帽顶判定在 update 里（下落穿过即弹），侧面/下方可自由穿过
  }
  popsBubbles(): Rect {
    // 菇帽也是脆的：漂浮的泡泡蹭到就破
    return { x: this.x - 8, y: this.capTop - 3, w: 16, h: 10 };
  }
  lights(): Light[] {
    return [{ x: this.x, y: this.y - 8, r: 9, tint: "110,255,180" }];
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const sq = this.squash;
    const capW = Math.round(16 + sq * 5);
    const capH = Math.max(2, Math.round(6 - sq * 3));
    const cx = Math.round(this.x);
    const top = Math.round(this.capTop + sq * 3);
    const m = mat("shroom");
    ctx.fillStyle = "#2a3228";
    ctx.fillRect(cx - 2, this.y - 6, 4, 6);
    ctx.fillStyle = "#4a5a48";
    ctx.fillRect(cx - 1, this.y - 6, 2, 6);
    ctx.strokeStyle = "#2a3a28";
    ctx.lineWidth = 1;
    for (const dx of [-5, 4]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx, this.y);
      ctx.quadraticCurveTo(cx + dx + 1, this.y + 4, cx + dx - 1, this.y + 8);
      ctx.stroke();
    }
    ctx.fillStyle = "#0a100c";
    ctx.fillRect(cx - capW / 2 - 1, top - 1, capW + 2, capH + 3);
    ctx.fillStyle = shade(m.base, 0.7);
    ctx.fillRect(cx - capW / 2, top + 1, capW, capH);
    ctx.fillStyle = m.base;
    ctx.beginPath();
    ctx.ellipse(cx, top + capH * 0.45, capW / 2, capH * 0.75, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = shade(m.base, 1.25);
    ctx.fillRect(cx - capW / 2 + 2, top, capW - 4, 1);
    ctx.fillStyle = shade(m.base, 0.55);
    for (let i = -capW / 2 + 3; i < capW / 2 - 2; i += 4) {
      ctx.fillRect(cx + i, top + 2 + (Math.floor(this.t + i) % 2), 2, 1);
    }
    ctx.fillStyle = m.accent;
    ctx.fillRect(cx - 2, top, 4, 1);
  }
}

// ---- 蔓豆茎：长按使用键扎根于脚下，按住使用键才生长的可攀爬藤茎 ----
// 链条结构：从根节起每格一格向四向延伸，总长 BEAN_MAX_TILES 格；
// growing（生长窗口）由 world 每帧按"使用键是否按住"刷新：按住才生长、松手即可走动、再按整根取消。

export class VineStalk extends BaseEntity {
  readonly chain: { x: number; y: number }[] = [];
  growing = true; // 生长窗口：world 每帧按"使用键是否按住"刷新；true 时方向键才生长
  private life = BEAN_LIFE;
  protected t = 0;
  private holdT = 0; // 连续按住方向键的累计时长（每 BEAN_GROW_INTERVAL 长一格）
  private lastDirKey = "";
  constructor(tx: number, tyGround: number) {
    super();
    this.x = tx * TILE + TILE / 2;
    this.y = tyGround * TILE; // 地表：茎从这里钻出
    this.chain.push({ x: tx, y: tyGround - 1 }); // 根节 = 脚下地表上方的空气格
  }
  /** 寿命回满（跨房停泊返回时调用：5s 内回来=茎完好如初）。 */
  refresh(): void {
    this.life = BEAN_LIFE;
  }

  update(w: World): void {
    const dt = 1 / 60;
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
      w.particles.burst(this.x, this.y - 16, 10, { speed: 25, color: "#7fd4a0", life: 0.5, grav: 90 });
    }
  }
  /** 生长输入（world 每步调用）。edge = 本步刚按下方向键：立刻长一格，长按则每 0.5s 一格。 */
  growStep(w: World, dir: { x: number; y: number }, edge: boolean): void {
    if (!this.growing || this.dead) return;
    const key = `${dir.x},${dir.y}`;
    if (dir.x === 0 && dir.y === 0) {
      this.holdT = 0;
      this.lastDirKey = "";
      return;
    }
    if (edge || key !== this.lastDirKey) {
      this.lastDirKey = key;
      this.holdT = 0;
      this.extend(w, dir.x, dir.y);
      return;
    }
    this.holdT += 1 / 60;
    if (this.holdT >= BEAN_GROW_INTERVAL) {
      this.holdT -= BEAN_GROW_INTERVAL;
      this.extend(w, dir.x, dir.y);
    }
  }
  private extend(w: World, dx: number, dy: number): void {
    if (this.chain.length >= BEAN_MAX_TILES) {
      this.growing = false; // 长满，自动收工
      return;
    }
    const tip = this.chain[this.chain.length - 1];
    const nx = tip.x + dx;
    const ny = tip.y + dy;
    const blocked =
      nx < 0 || ny < 0 || nx > 31 || ny > 17 ||
      w.room.tiles.get(nx, ny) !== 0 || // 岩壁/尖刺都不穿（原生藤蔓不是瓦片：茎与藤互不干扰）
      this.chain.some((t) => t.x === nx && t.y === ny);
    if (blocked) {
      w.dust(tip.x * 10 + 5, tip.y * 10 + 5, 2); // 顶到东西：抖两粒屑，不耗长度
      return;
    }
    this.chain.push({ x: nx, y: ny });
    audio.plant();
    w.particles.burst(nx * 10 + 5, ny * 10 + 5, 4, { speed: 14, color: "#7fd4a0", life: 0.3 });
    if (this.chain.length >= BEAN_MAX_TILES) this.growing = false;
  }
  /** 点按使用键：整根枯萎回收。 */
  cancel(w: World): void {
    if (this.dead) return;
    this.dead = true;
    this.growing = false;
    audio.plant();
    w.particles.burst(this.x, this.y - 14, 12, { speed: 30, color: "#7fd4a0", life: 0.5, grav: 140 });
  }
  /** 玩家身体是否在这根茎的可攀爬范围内（链条任一格附近）。 */
  holds(px: number, py: number): boolean {
    if (this.dead) return false;
    for (const t of this.chain) {
      if (Math.abs(px - (t.x * 10 + 5)) < 7 && Math.abs(py - (t.y * 10 + 5)) < 8) return true;
    }
    return false;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const sway = Math.sin(this.t * 2.2) * 1;
    // 主蔓：沿链条折线，越靠尖端摆得越多
    ctx.strokeStyle = "#1a2418";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    this.chain.forEach((t, i) => {
      const k = (i + 1) / this.chain.length;
      ctx.lineTo(t.x * 10 + 5 + sway * k, t.y * 10 + 5);
    });
    ctx.stroke();
    ctx.strokeStyle = "#4a7a52";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    this.chain.forEach((t, i) => {
      const k = (i + 1) / this.chain.length;
      ctx.lineTo(t.x * 10 + 5 + sway * k, t.y * 10 + 5);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    // 叶对：逐节左右交替
    ctx.fillStyle = "#6a8a58";
    this.chain.forEach((t, i) => {
      if (i === 0) return;
      const cx = t.x * 10 + 5;
      const cy = t.y * 10 + 5;
      const side = i % 2 === 0 ? 1 : -1;
      ctx.fillRect(cx + (side > 0 ? 1 : -4), cy - 1, 3, 1);
      ctx.fillRect(cx + (side > 0 ? 1 : -4), cy + 1, 3, 1);
    });
    // 顶芽：生长中会呼吸发亮——告诉你"它还活着，还能长"
    const tip = this.chain[this.chain.length - 1];
    ctx.fillStyle = this.growing && Math.sin(this.t * 5) > 0 ? "#eafff0" : "#cfe8d8";
    ctx.fillRect(tip.x * 10 + 4 + Math.round(sway), tip.y * 10 + 4, 3, 2);
    // 茎节：每格一对小瘤，藤的关节读法
    ctx.fillStyle = "#3a7a4e";
    this.chain.forEach((t2, i) => {
      if (i === 0) return;
      ctx.fillRect(t2.x * 10 + 4, t2.y * 10 + 7, 1, 1);
    });
    // 生长中：根须埋在地表里
    if (this.growing) {
      ctx.fillStyle = "#7fd4a0";
      ctx.fillRect(this.x - 4, this.y - 1, 2, 1);
      ctx.fillRect(this.x + 2, this.y - 1, 2, 1);
    }
    // 枯萎临近：逐格变暗闪烁
    if (this.life < 2.5) {
      ctx.globalAlpha = 0.35 + Math.sin(this.t * 12) * 0.2;
      ctx.fillStyle = "#16222c";
      for (const t of this.chain) ctx.fillRect(t.x * 10, t.y * 10, 10, 10);
      ctx.globalAlpha = 1;
    }
  }
}

// ---- 天花板垂下的藤蔓丛：路过惊动摇摆的纯氛围物，但护罩是肥皂泡——蹭到就破 ----
// 数据规则：{x,y} 是悬挂起始空气格（上一行必须实心），宽 2 格、h 格长。
// 关卡铁律：只能靠护罩飞过的路线附近不放藤蔓，或垂得够短（尖端离飞行线 ≥40px）。

export class HangingVine extends BaseEntity {
  readonly rect: Rect; // 覆盖矩形仅作编辑器/锚点参考；实际判定逐条藤蔓（见 popRects）
  // 每条藤蔓：ox 横向锚点、len 实际长度、angle/angVel 钟摆状态、ph 环境风相位
  private strands: { ox: number; len: number; ph: number; angle: number; angVel: number }[] = [];
  constructor(tx: number, ty: number, readonly th: number, lens?: number[], hMin?: number) {
    super();
    this.x = tx * TILE;
    this.y = ty * TILE;
    this.rect = { x: this.x + 2, y: this.y, w: 2 * TILE - 4, h: th * TILE };
    // 以锚点坐标做种子的确定性形态——同一丛每次长一样
    let s = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    if (lens && lens.length) {
      // 数据显式指定：条数=根数（最多 6），0 或 -1=该条在 [hMin,h] 内随机，其余按数值取长
      const lo = Math.max(1, hMin ?? Math.max(1, Math.round(th * 0.55)));
      const n = Math.min(6, lens.length);
      for (let i = 0; i < n; i++) {
        const v = lens[i] ?? -1;
        // lens 显式给正值时按数组实际长度（忽略上限 h）；0/-1 在 [hMin,h] 内随机
        const tilesLen = v <= 0 ? lo + rnd() * Math.max(0, th - lo) : Math.max(1, v);
        this.strands.push({
          ox: 2 + (n === 1 ? 0.5 : i / (n - 1)) * (2 * TILE - 6) + (rnd() - 0.5) * 2,
          len: tilesLen * TILE,
          ph: rnd() * 6.28,
          angle: 0,
          angVel: 0,
        });
      }
    } else {
      const n = 4 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        this.strands.push({
          ox: 2 + (i / (n - 1)) * (2 * TILE - 6) + (rnd() - 0.5) * 2,
          len: th * TILE * (0.55 + rnd() * 0.45),
          ph: rnd() * 6.28,
          angle: 0,
          angVel: 0,
        });
      }
    }
  }
  update(w: World): void {
    const dt = 1 / 60;
    const b = w.player.box;
    for (const st of this.strands) {
      // 单摆积分：重力回复 + 阻尼 + 环境微风；长藤周期长，摆起来更"沉"
      const acc = -13 * Math.sin(st.angle) - 2.2 * st.angVel + Math.sin(w.time * 0.9 + st.ph) * 0.085;
      st.angVel += acc * dt;
      st.angle += st.angVel * dt;
      // 玩家贴近这一条 → 拨到：冲量只与横向速度成正比（站着不动=零冲量，藤靠阻尼自己停稳）；
      // 旧的"方向常量项"会在玩家干站着的每一帧持续充能，藤永远停不下来还打满幅度上限
      const sx = this.x + st.ox;
      const tip = this.tipX(st);
      const x0 = Math.min(sx, tip) - 5;
      const x1 = Math.max(sx, tip) + 5;
      const y1 = this.y + st.len + 6;
      if (b.x0 < x1 && b.x1 > x0 && b.y0 - 6 < y1 && b.y1 > this.y - 4) {
        st.angVel += (w.player.vx * 0.026) / Math.max(26, st.len);
        st.angVel = Math.max(-2.1, Math.min(2.1, st.angVel));
      }
      // 护罩破裂：罩身与这一条的实际区段相交 → 就地爆掉（毒雾里爆掉会顺势受伤）
      if (w.player.shieldT > 0 && rectHit(w.player.box, this.strandRect(st))) {
        w.player.shieldT = 0;
        audio.bubblePop();
        w.particles.burst(w.player.x, w.player.y, 10, { speed: 40, color: "#9fdcff", life: 0.5 });
        w.checkPlayerHazards();
      }
    }
  }
  private tipX(st: { ox: number; len: number; angle: number }): number {
    return this.x + st.ox + Math.sin(st.angle) * st.len * 0.72; // 藤身弯曲：尖端水平位移打折
  }
  /** 单条藤蔓的实际判定区（跟随当前摆动），泡泡/护罩判定都用它。 */
  private strandRect(st: { ox: number; len: number; angle: number }): Rect {
    const sx = this.x + st.ox;
    const tip = this.tipX(st);
    return { x: Math.min(sx, tip) - 2, y: this.y, w: Math.abs(tip - sx) + 4, h: st.len };
  }
  /** 藤蔓丛的刺泡判定区：逐条返回（与护罩破裂共用）。 */
  popsBubbles(): Rect[] {
    return this.strands.map((st) => this.strandRect(st));
  }
  draw(ctx: CanvasRenderingContext2D, _w: World): void {
    ctx.fillStyle = "#0c100c";
    ctx.fillRect(this.x - 1, this.y - 2, 2 * TILE + 2, 3);
    ctx.fillStyle = "#2a3a28";
    ctx.fillRect(this.x, this.y - 1, 2 * TILE, 2);
    ctx.fillStyle = "#4a5a40";
    ctx.fillRect(this.x + 1, this.y - 1, 2 * TILE - 2, 1);
    for (const st of this.strands) {
      const sx = this.x + st.ox;
      const tipX = this.tipX(st);
      const tipY = this.y + Math.cos(st.angle) * st.len;
      const midX = sx + Math.sin(st.angle) * st.len * 0.32;
      const midY = this.y + st.len * 0.52;
      ctx.strokeStyle = shade(mat("vine").base, 0.35);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, this.y);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
      ctx.strokeStyle = mat("vine").base;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, this.y);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = shade(mat("vine").base, 0.7);
      for (let k = 0.22; k < 0.88; k += 0.22) {
        const lx = sx + Math.sin(st.angle) * st.len * k * 0.72;
        const ly = this.y + st.len * k;
        const side = k * 10 % 2 < 1 ? 1 : -1;
        ctx.fillRect(Math.round(lx) + (side > 0 ? 1 : -3), Math.round(ly), 3, 2);
      }
      ctx.fillStyle = mat("vine").accent;
      ctx.fillRect(Math.round(tipX) - 1, Math.round(tipY), 3, 2);
      if (Math.abs(st.angVel) > 1.4) {
        ctx.globalAlpha = Math.min(0.6, (Math.abs(st.angVel) - 1.4) * 0.3);
        ctx.fillStyle = "#cfeecf";
        ctx.fillRect(Math.round(tipX), Math.round(tipY) + 1, 1, 1);
        ctx.globalAlpha = 1;
      }
    }
    ctx.lineWidth = 1;
  }
}

// ---- 井底小树：暗处挣扎着活下来的矮树。藤蔓与它同宗——泡泡蹭到就破；----
// 但它对蔓豆茎毫无妨碍：茎可以贴着它长、穿过它爬，互不相扰。

export class SmallTree extends BaseEntity {
  readonly ht: number; // 树高（格，2~5）：按坐标做种子的确定性随机——同一棵树每次长一样
  readonly rect: Rect; // 树冠+树干的接触区
  constructor(tx: number, ty: number, h?: number) {
    super();
    // (tx,ty)=树基所在空气格，下一格须实心——树从那里站上地面。
    // 高度：数据可显式指定 h（钳在 2~10）；缺省按坐标种子确定性随机 2~5——同一棵树每次长一样
    this.x = tx * TILE + TILE / 2;
    this.y = (ty + 1) * TILE;
    const seed = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    this.ht = Math.max(2, Math.min(10, h ?? 2 + (seed % 4)));
    const cw = 15 + this.ht * 2;
    const top = this.y - (this.ht - 1) * TILE;
    this.rect = { x: this.x - cw / 2 - 1, y: top - 13, w: cw + 2, h: this.y - top + 13 };
  }
  update(w: World): void {
    this.t += 1 / 60;
    // 护罩是肥皂泡：蹭到树冠就地爆掉（与藤蔓丛一致；毒雾里爆掉会顺势受伤）
    if (w.player.shieldT > 0 && rectHit(w.player.box, this.rect)) {
      w.player.shieldT = 0;
      audio.bubblePop();
      w.particles.burst(w.player.x, w.player.y, 10, { speed: 40, color: "#9fdcff", life: 0.5 });
      w.checkPlayerHazards();
    }
    // 偶尔落一片败叶
    if (Math.random() < 0.008) {
      w.particles.spawn({
        x: this.x + (Math.random() - 0.5) * 12,
        y: this.y - (this.ht - 1) * TILE - 8,
        vy: 9,
        vx: (Math.random() - 0.5) * 6,
        life: 1.4,
        color: "#315437",
      });
    }
  }
  popsBubbles(): Rect {
    return this.rect;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const sway = Math.round(Math.sin(this.t * 1.1 + this.x) * 0.8);
    const x = Math.round(this.x);
    const base = Math.round(this.y);
    const h = this.ht;
    const trunkH = (h - 1) * TILE - 1; // 冠占顶上一格，其余是干
    const top = base - trunkH;
    // 根裙
    ctx.fillStyle = "#0c0a08";
    ctx.fillRect(x - 5, base - 3, 11, 3);
    // 干（高树加粗一格）
    const tw = h >= 4 ? 4 : 3;
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(x - 2, top, tw + 2, trunkH);
    ctx.fillStyle = "#3a2d1c";
    ctx.fillRect(x - 1, top, tw, trunkH);
    ctx.fillStyle = "#5a4a30";
    ctx.fillRect(x - 1, top, 1, trunkH);
    // 冠：实心剪影 + 深描边，和背景草分开
    const cw = 15 + h * 2;
    const crownDrop = h > 3 ? 1 : 0;
    ctx.fillStyle = shade(mat("tree").base, 0.35);
    ctx.fillRect(x - cw / 2 - 1, top - 12 - crownDrop, cw + 2, 16);
    ctx.fillStyle = mat("tree").base;
    ctx.beginPath();
    ctx.ellipse(x, top - 4, cw / 2 - 1, 7 + crownDrop, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(mat("tree").base, 1.15);
    ctx.beginPath();
    ctx.ellipse(x - 2 + sway, top - 7, cw * 0.28, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(mat("tree").base, 0.7);
    ctx.fillRect(x - cw / 2 + 2, top - 2, cw - 4, 2);
    ctx.fillStyle = mat("tree").accent;
    ctx.fillRect(x - cw / 2 + 3 + sway, top - 8, Math.round(cw * 0.4), 1);
    ctx.fillStyle = "#2a3a2c";
    for (let k = 1; k < h - 1; k++) {
      ctx.fillRect(x + (k % 2 === 0 ? 0 : tw - 1), top + k * 7, 1, 2);
    }
  }
}

// ---- 井底巨花 ----

export class Flower extends BaseEntity {
  protected t = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x * TILE + TILE / 2;
    this.y = y * TILE + TILE / 2;
  }
  update(w: World): void {
    this.t += 1 / 60;
    if (w.ending || w.epilogue) return;
    const p = w.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    if (w.seeds.size >= 10 && dx * dx + dy * dy < 18 * 18) {
      w.startEnding();
    } else if (dx * dx + dy * dy < 60 * 60 && Math.random() < 0.12) {
      w.particles.spawn({
        x: this.x + (Math.random() - 0.5) * 20,
        y: this.y + 10 - Math.random() * 10,
        vy: -8 - Math.random() * 6,
        life: 1.2,
        color: w.seeds.size >= 10 ? "#ffe9a8" : "#7fd4a0",
      });
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const breath = Math.sin(this.t * 1.6) * 1;
    const x = Math.round(this.x);
    const baseY = Math.round(this.y + 14); // 花萼底部（站在平台上）
    // 茎
    ctx.strokeStyle = "#3f6a4c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + 2, baseY - 10, x, baseY - 18);
    ctx.stroke();
    // 叶
    ctx.fillStyle = "#4c8a5e";
    ctx.fillRect(x - 6, baseY - 8, 5, 2);
    ctx.fillRect(x + 2, baseY - 12, 5, 2);
    // 花体（闭合泪滴）
    const ready = w.seeds.size >= 10;
    const bodyY = baseY - 34 + breath;
    ctx.fillStyle = "#1a2018";
    ctx.fillRect(x - 8, bodyY + 7, 16, 20);
    ctx.fillStyle = ready ? "#c9a86a" : mat("flower").base;
    ctx.fillRect(x - 7, bodyY + 8, 14, 18);
    ctx.fillRect(x - 5, bodyY + 4, 10, 6);
    ctx.fillRect(x - 3, bodyY + 1, 6, 4);
    ctx.fillStyle = ready ? "#e8c887" : shade(mat("flower").base, 1.25);
    ctx.fillRect(x - 4, bodyY + 6, 8, 14);
    ctx.fillRect(x - 2, bodyY + 2, 4, 6);
    ctx.fillStyle = ready ? "#fff3cf" : mat("flower").accent;
    ctx.fillRect(x - 2, bodyY + 8, 4, 8);
    ctx.fillStyle = ready ? "#a8874e" : shade(mat("flower").base, 0.75);
    ctx.fillRect(x - 6, bodyY + 12, 12, 1);
    ctx.fillRect(x - 4, bodyY + 7, 8, 1);
    ctx.fillRect(x - 2, bodyY + 3, 4, 1);
    ctx.fillStyle = ready ? "#fff3cf" : mat("flower").accent;
    ctx.fillRect(x - 1, bodyY + 1, 2, 1);
    // 10 个源种凹槽：收集几个亮几个——不用文字告诉玩家差多少
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * (0.15 + (i / 9) * 0.7);
      const px = x + Math.cos(Math.PI - a) * 12;
      const py = bodyY + 26 - Math.sin(a) * 6;
      const lit2 = i < w.seeds.size;
      if (lit2) {
        ctx.fillStyle = "rgba(255,220,140,0.35)";
        ctx.fillRect(Math.round(px) - 2, Math.round(py) - 1, 4, 4); // 亮槽有微光晕
      }
      ctx.fillStyle = lit2 ? "#ffe9a8" : "#243642";
      ctx.fillRect(Math.round(px) - 1, Math.round(py), 2, 2);
    }
  }
  lights(w: World): Light[] {
    const ready = w.seeds.size >= 10;
    const breath = Math.sin(this.t * (ready ? 4 : 1.6));
    return [{ x: this.x, y: this.y - 8, r: (ready ? 40 : 26) + breath * 3, tint: ready ? "255,220,140" : mat("flower").glow }];
  }
}

// ---- 泡泡：静止漂浮，可踩（踩住才上升）、可被藤鞭打中转化成护罩 ----

export class Bubble extends BaseEntity {
  private life = BUBBLE_LIFE;
  private carrying = false;
  doom = 0; // 被新泡泡顶替后的破裂倒计时（world 在召唤时设置；>0 时闪烁示警）
  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
  }
  /** 玩家是否正站在这颗泡泡上（跨房时 world 据此把它随身携带）。 */
  get riding(): boolean {
    return this.carrying;
  }
  update(w: World): void {
    const dt = 1 / 60;
    this.t += dt;
    // 顶替破裂：宽限一过就爆——骑在上面也照破，来得及跳走
    if (this.doom > 0) {
      this.doom -= dt;
      if (this.doom <= 0) {
        this.pop(w);
        return;
      }
    }
    this.life -= dt;
    if (this.life <= 0) {
      this.pop(w);
      return;
    }
    // 只有被踩着才上升；平时原地轻晃
    if (this.carrying) {
      const ny = this.y - BUBBLE_RISE * dt;
      // 顶着玩家上升前先探头部空间：玩家站泡顶时头部在 y-13。
      // 不做这一步，玩家会被直接写进天花板瓦片，下一步碰撞把人弹到天花板上方=房间外。
      const headY = ny - 13;
      if (!w.solidAtPx(this.x - 2, headY) && !w.solidAtPx(this.x, headY) && !w.solidAtPx(this.x + 2, headY)) {
        this.y = ny;
      }
      // 被天花板卡停时保持载着：玩家可以继续站着，或跳下去
    }
    // 上升/晃动中顶到实心或尖刺 → 爆
    for (const [dx, dy] of [
      [4, 0],
      [-4, 0],
      [0, -4],
      [0, 4],
    ]) {
      if (w.solidAtPx(this.x + dx, this.y + dy) || w.spikeAtPx(this.x + dx, this.y + dy)) {
        this.pop(w);
        return;
      }
    }
    // 场景刺破：藤蔓丛 / 小树 / 蹦菇帽，蹭到就破
    const box = { x0: this.x - 5, y0: this.y - 5, x1: this.x + 5, y1: this.y + 5 };
    for (const e of w.room.entities) {
      const pr = e.popsBubbles?.();
      if (!pr) continue;
      if (Array.isArray(pr) ? pr.some((r) => rectHit(box, r)) : rectHit(box, pr)) {
        this.pop(w);
        return;
      }
    }
    // 骑乘：下落中的玩家脚部落进泡顶一带 → 站上去，被泡泡带着上升
    const p = w.player;
    const top = this.y - 5;
    const feet = p.y + 4;
    const headY = top - 8; // 站上泡顶后玩家的头部高度
    const headroom =
      !w.solidAtPx(this.x - 2, headY) && !w.solidAtPx(this.x, headY) && !w.solidAtPx(this.x + 2, headY);
    if (
      !p.swing &&
      p.deadT <= 0 &&
      p.shieldT <= 0 &&
      p.vy >= -1 &&
      headroom &&
      Math.abs(p.x - this.x) < 7 &&
      feet >= top - 3 &&
      feet <= top + 5
    ) {
      this.carrying = true;
      p.x += (this.x - p.x) * 0.4;
      p.y = top - 4;
      p.vy = 0;
      p.grounded = true;
    } else if (this.carrying) {
      this.carrying = false; // 玩家离开：泡泡停在原地
    }
    // 藤鞭击打 → 泡泡罩到玩家身上，变成护罩
    if (w.player.whipHeld && !w.playerWhipConsumed(this) && w.whipHits({ x: this.x - 7, y: this.y - 7, w: 14, h: 14 })) {
      w.markWhipHit(this);
      this.dead = true;
      audio.bubblePop();
      w.player.startShield();
      w.particles.burst(this.x, this.y, 10, { speed: 36, color: "#9fdcff", life: 0.5 });
    }
  }
  pop(w: World): void {
    if (this.dead) return;
    this.dead = true;
    audio.bubblePop();
    w.particles.burst(this.x, this.y, 8, { speed: 32, color: "#9fdcff", life: 0.4 });
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const warn = this.life < 1.5 || this.doom > 0;
    const r = 5 + Math.sin(this.t * (warn ? 18 : 9)) * (warn ? 0.9 : 0.4);
    ctx.fillStyle = `rgba(140, 210, 240, ${warn ? 0.10 : 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(80, 140, 180, ${warn ? 0.45 : 0.7})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(159, 220, 255, ${warn ? 0.5 : 0.9})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    const hue = Math.floor((this.t * 40) % 360);
    ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 0.45)`;
    const a0 = this.t * 2.4;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.6, a0, a0 + 1.4);
    ctx.stroke();
    ctx.fillStyle = "rgba(216, 242, 255, 0.95)";
    ctx.fillRect(x - 2, y - 3, 1, 1);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x + 2, y + 1, 1, 1);
  }
  lights(): Light[] {
    return [{ x: this.x, y: this.y, r: 9, tint: "140,220,255" }];
  }
}

export function rectHit(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: Rect,
): boolean {
  return a.x0 < b.x + b.w && a.x1 > b.x && a.y0 < b.y + b.h && a.y1 > b.y;
}

/** 线段到点的最短距离。 */
export function segPointDist(
  seg: { x0: number; y0: number; x1: number; y1: number },
  px: number,
  py: number,
): number {
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - seg.x0) * dx + (py - seg.y0) * dy) / len2));
  return Math.hypot(px - (seg.x0 + dx * t), py - (seg.y0 + dy * t));
}

/** 线段与矩形是否相交（端点入矩形，或与任一边相割）。 */
export function segRectHit(
  seg: { x0: number; y0: number; x1: number; y1: number },
  r: Rect,
): boolean {
  const inside = (x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(seg.x0, seg.y0) || inside(seg.x1, seg.y1)) return true;
  const edges: [number, number, number, number][] = [
    [r.x, r.y, r.x + r.w, r.y],
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x + r.w, r.y + r.h, r.x, r.y + r.h],
    [r.x, r.y + r.h, r.x, r.y],
  ];
  for (const [ax, ay, bx, by] of edges) {
    if (segSegHit(seg.x0, seg.y0, seg.x1, seg.y1, ax, ay, bx, by)) return true;
  }
  return false;
}

function segSegHit(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// ---- 自定义物件：「新物品工坊」里创造的数据驱动实体（形状/材质/碰撞/发光全在 propData.ts） ----

export class CustomProp extends BaseEntity {
  readonly rect: Rect;
  constructor(
    tx: number,
    ty: number,
    readonly def: PropDef,
  ) {
    super();
    this.rect = { x: tx * TILE, y: ty * TILE, w: def.w * TILE, h: def.h * TILE };
    this.x = this.rect.x + this.rect.w / 2;
    this.y = this.rect.y + this.rect.h / 2;
  }
  update(_w: World): void {
    this.t += 1 / 60;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    drawPropShape(ctx, this.def, this.rect, this.t);
  }
  solidRect(): Rect | null {
    return this.def.solid ? this.rect : null;
  }
  popsBubbles(): Rect | null {
    return this.def.solid ? this.rect : null;
  }
  lights(): Light[] {
    const l = this.def.light;
    if (l) {
      return [{ x: this.x, y: this.y, r: l.r, tint: this.def.material.glow, strength: l.strength }];
    }
    // 无光源定义也保留一点基础微光
    return [{ x: this.x, y: this.y, r: 10, tint: this.def.material.glow, strength: 0.15 }];
  }
}

/** 自定义物件的参数化形状（编辑器示意图也用这一份逻辑的同款构图）。 */
export function drawPropShape(ctx: CanvasRenderingContext2D, def: PropDef, r: Rect, t: number): void {
  const m = def.material;
  const deep = shade(m.base, 0.55);
  const lite = shade(m.base, 1.35);
  ctx.save();
  switch (def.shape) {
    case "tree": {
      ctx.fillStyle = "#3a2d1c";
      ctx.fillRect(r.x + r.w * 0.4, r.y + r.h * 0.5, Math.max(2, r.w * 0.2), r.h * 0.5);
      ctx.fillStyle = deep;
      ctx.fillRect(r.x, r.y + r.h * 0.3, r.w, r.h * 0.45);
      ctx.fillStyle = m.base;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h * 0.38, Math.min(r.w, r.h) * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lite;
      ctx.beginPath();
      ctx.arc(r.x + r.w * 0.36, r.y + r.h * 0.28, Math.min(r.w, r.h) * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "crystal": {
      const pulse = 0.6 + Math.sin(t * 2.2) * 0.4;
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.5, r.y);
      ctx.lineTo(r.x + r.w * 0.88, r.y + r.h * 0.42);
      ctx.lineTo(r.x + r.w * 0.7, r.y + r.h);
      ctx.lineTo(r.x + r.w * 0.3, r.y + r.h);
      ctx.lineTo(r.x + r.w * 0.12, r.y + r.h * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = m.base;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.5, r.y + r.h * 0.12);
      ctx.lineTo(r.x + r.w * 0.72, r.y + r.h * 0.46);
      ctx.lineTo(r.x + r.w * 0.5, r.y + r.h * 0.92);
      ctx.lineTo(r.x + r.w * 0.3, r.y + r.h * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.55 * pulse;
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.5, r.y + r.h * 0.2);
      ctx.lineTo(r.x + r.w * 0.62, r.y + r.h * 0.46);
      ctx.lineTo(r.x + r.w * 0.5, r.y + r.h * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case "mushroom": {
      ctx.fillStyle = lite;
      ctx.fillRect(r.x + r.w * 0.38, r.y + r.h * 0.45, Math.max(2, r.w * 0.24), r.h * 0.55);
      ctx.fillStyle = deep;
      ctx.fillRect(r.x + r.w * 0.06, r.y + r.h * 0.36, r.w * 0.88, r.h * 0.22);
      ctx.fillStyle = m.base;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h * 0.48, Math.min(r.w * 0.46, r.h * 0.4), Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = m.accent;
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(r.x + r.w * (0.28 + i * 0.2), r.y + r.h * (0.3 + (i % 2) * 0.08), 2, 1);
      }
      break;
    }
    case "rock": {
      ctx.fillStyle = deep;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.1, r.y + r.h);
      ctx.lineTo(r.x + r.w * 0.05, r.y + r.h * 0.5);
      ctx.lineTo(r.x + r.w * 0.35, r.y + r.h * 0.12);
      ctx.lineTo(r.x + r.w * 0.75, r.y + r.h * 0.08);
      ctx.lineTo(r.x + r.w * 0.95, r.y + r.h * 0.55);
      ctx.lineTo(r.x + r.w * 0.85, r.y + r.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = m.base;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.18, r.y + r.h * 0.92);
      ctx.lineTo(r.x + r.w * 0.16, r.y + r.h * 0.5);
      ctx.lineTo(r.x + r.w * 0.4, r.y + r.h * 0.22);
      ctx.lineTo(r.x + r.w * 0.7, r.y + r.h * 0.2);
      ctx.lineTo(r.x + r.w * 0.82, r.y + r.h * 0.55);
      ctx.lineTo(r.x + r.w * 0.74, r.y + r.h * 0.92);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = m.accent;
      ctx.fillRect(r.x + r.w * 0.4, r.y + r.h * 0.24, r.w * 0.24, 1);
      break;
    }
    case "flower": {
      const spin = t * 0.6;
      ctx.fillStyle = "#3a2d1c";
      ctx.fillRect(r.x + r.w * 0.46, r.y + r.h * 0.5, Math.max(1, r.w * 0.08), r.h * 0.5);
      ctx.fillStyle = m.base;
      for (let i = 0; i < 6; i++) {
        const a = spin + (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2 + Math.cos(a) * r.w * 0.28, r.y + r.h * 0.38 + Math.sin(a) * r.h * 0.2, Math.min(r.w, r.h) * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h * 0.38, Math.min(r.w, r.h) * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "torch": {
      const flick = Math.sin(t * 9) * 0.5 + Math.sin(t * 23) * 0.3;
      ctx.fillStyle = "#3a2d1c";
      ctx.fillRect(r.x + r.w * 0.42, r.y + r.h * 0.35, Math.max(2, r.w * 0.16), r.h * 0.65);
      ctx.fillStyle = m.base;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h * 0.3, r.w * 0.2 + flick * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h * 0.26, r.w * 0.1 + flick * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "block":
    default: {
      ctx.fillStyle = deep;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = m.base;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.fillStyle = lite;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 1);
      ctx.fillStyle = m.accent;
      ctx.fillRect(r.x + 2, r.y + r.h - 3, r.w - 4, 1);
      break;
    }
  }
  ctx.restore();
}

// ---- 悬浮荚（悬浮块）：1×w 的脆平台，逐格独立——踩上哪格 1s 后哪格碎、3s 后独立重生 ----
// 孢子荚形象：鼓胀的荚泡，踩上开始颤动泄漏，碎成一蓬孢子，再生时从小芽重新鼓起来。
// 状态不入存档（纯房间瞬时态），重进房间即复原。

export class CrumblePod extends BaseEntity {
  readonly rect: Rect;
  private state: "idle" | "shake" | "gone" = "idle";
  private timer = 0;
  private regrow = 0; // 重生弹出的生长动画剩余时长
  constructor(tx: number, ty: number) {
    super();
    this.rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: 6, oneWay: true };
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE;
  }
  update(w: World): void {
    const dt = 1 / 60;
    this.t += dt;
    const m = mat("crumble");
    if (this.state === "idle") {
      this.regrow = Math.max(0, this.regrow - dt);
      if (standingOn(w, this.rect, true)) {
        this.state = "shake";
        this.timer = CRUMBLE_SHAKE_TIME;
      }
    } else if (this.state === "shake") {
      this.timer -= dt;
      // 松动泄漏：越来越急的孢子屑
      if (Math.random() < 0.3) {
        w.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 8,
          y: this.y + 4,
          vx: (Math.random() - 0.5) * 8,
          vy: 10 + Math.random() * 12,
          life: 0.45,
          color: m.accent,
          size: 1,
        });
      }
      if (this.timer <= 0) {
        this.state = "gone";
        this.timer = CRUMBLE_REGROW_TIME;
        audio.bubblePop();
        w.particles.burst(this.x, this.y + 3, 14, { speed: 36, color: m.base, life: 0.7, grav: 140 });
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "idle";
        this.regrow = 0.35;
        audio.plant();
        w.particles.burst(this.x, this.y + 2, 6, { speed: 15, color: m.accent, life: 0.4, grav: -40 });
      }
    }
  }
  solidRect(): Rect | null {
    return this.state === "gone" ? null : this.rect;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.state === "gone") return;
    const m = mat("crumble");
    const grow = this.regrow > 0 ? 1 - this.regrow / 0.35 : 1;
    const breathe = this.state === "idle" ? Math.sin(this.t * 2.4) * 0.3 : 0;
    const shakeK = this.state === "shake" ? 1 - this.timer / CRUMBLE_SHAKE_TIME : 0;
    const cx = this.x + (this.state === "shake" ? Math.sin(this.t * 50) * 1.4 * shakeK : 0);
    const r = (4 + breathe) * Math.max(0.12, grow);
    // 荚体：贴着平台面的鼓泡
    ctx.fillStyle = m.base;
    ctx.beginPath();
    ctx.arc(cx, this.y + 5, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - r, this.y + 4.4, r * 2, 1.6);
    // 顶缘高光 + 气孔
    ctx.fillStyle = m.accent;
    ctx.fillRect(cx - r * 0.55, this.y + 5 - r + 0.5, Math.max(1, r), 1);
    if (grow > 0.6) {
      ctx.fillRect(cx - 2.5, this.y + 3, 1, 1);
      ctx.fillRect(cx + 1, this.y + 2, 1, 1);
    }
    // 松动警示：越接近碎裂越"涨红"
    if (shakeK > 0) {
      ctx.globalAlpha = shakeK * 0.5;
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.arc(cx, this.y + 5, r, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// ---- 睡莲平台：可站立的移动平台，搬运脚下的角色 ----
// patrol：在 range 格行程内沿 axis 以 speed px/s 三角波来回；
// switch：target 触发（开关/压力板，瞬时触发配 reset 才会复位）后延迟 delay 秒滑向 (dx,dy) 偏移处，
// 触发持续期间停在目标位，触发结束滑回原位。状态不入存档。

export class LilyPad extends MoverPlatform {
  readonly rect: Rect;
  protected t = 0; // 运动相位（patrol 用；从 0 起保证确定性，覆盖基类随机相位）
  private t2 = Math.random() * 10; // 视觉呼吸
  private state: "idle" | "delay" | "to" | "hold" | "back" = "idle";
  private timer = 0;
  readonly mode: "patrol" | "switch";
  private readonly amp: number;
  private readonly speed: number;
  readonly id: string;
  private readonly delay: number;
  private readonly to: { x: number; y: number };
  constructor(
    pos: ObjPos,
    end: ObjPos,
    o: { w?: number; mode: "patrol" | "switch"; speed?: number; delay?: number; id: string },
  ) {
    super();
    const tw = Math.max(1, Math.min(8, Math.round(o.w ?? 2)));
    this.rect = { x: pos.x * TILE, y: pos.y * TILE, w: tw * TILE, h: 6, oneWay: true };
    this.x = this.rect.x + this.rect.w / 2;
    this.y = this.rect.y;
    this.mode = o.mode ?? "patrol";
    this.speed = Math.max(4, o.speed ?? 36);
    this.id = o.id;
    this.delay = Math.max(0, o.delay ?? 0);
    // 终点位移 = 终点格 - 起点格（同房内的相对向量）
    this.to = { x: end.x * TILE - this.rect.x, y: end.y * TILE - this.rect.y };
    this.amp = Math.hypot(this.to.x, this.to.y);
  }
  update(w: World): void {
    const dt = 1 / 60;
    this.t += dt;
    this.t2 += dt;
    const prev = { ...this.off };

    if (this.mode === "patrol") {
      const span = this.amp * 2;
      if (span > 0.01) {
        const ph = (this.t * this.speed) % span;
        const d = ph <= this.amp ? ph : span - ph;
        this.off.x = (this.to.x / this.amp) * d;
        this.off.y = (this.to.y / this.amp) * d;
      }
    } else if (this.id) {
      const active = w.triggerActive(this.id);
      if (this.state === "idle") {
        if (active) {
          if (this.delay <= 0) this.state = "to";
          else {
            this.state = "delay";
            this.timer = this.delay;
          }
        }
      } else if (this.state === "delay") {
        this.timer -= dt;
        if (this.timer <= 0) this.state = "to";
        else if (!active) this.state = "idle"; // 延迟途中触发就结束了：不出发
      } else if (this.state === "to") {
        this.moveToward(this.to, this.speed, dt);
        if (this.atTarget()) this.state = "hold";
      } else if (this.state === "hold") {
        if (!active) this.state = "back";
      } else {
        // back：滑回原位；中途再触发则掉头
        if (active) {
          this.state = "to";
        } else {
          this.moveToward({ x: 0, y: 0 }, this.speed, dt);
          if (this.atTarget()) this.state = "idle";
        }
      }
    }

    this.rect.x += this.off.x - prev.x;
    this.rect.y += this.off.y - prev.y;

    // 搬运：脚站在莲面上的角色跟着走（下落/起跳瞬间不拽）
    this.carry(w, this.off.x - prev.x, this.off.y - prev.y, this.rect);
  }
  private atTarget(): boolean {
    return Math.abs(this.off.x - (this.state === "back" ? 0 : this.to.x)) < 0.01 &&
      Math.abs(this.off.y - (this.state === "back" ? 0 : this.to.y)) < 0.01;
  }
  solidRect(): Rect | null {
    return this.rect;
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const m = mat("lilypad");
    const cx = this.rect.x + this.rect.w / 2;
    const top = this.rect.y;
    const bob = this.state === "idle" || this.mode === "patrol" ? Math.sin(this.t2 * 2) * 0.4 : 0;
    // 叶盘：双椭圆叠出厚度
    ctx.fillStyle = shade(m.base, 0.6);
    ctx.beginPath();
    ctx.ellipse(cx, top + 4.2 + bob, this.rect.w / 2 - 0.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = m.base;
    ctx.beginPath();
    ctx.ellipse(cx, top + 3.2 + bob, this.rect.w / 2 - 1.2, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // 经典睡莲豁口：一条楔形暗缝
    ctx.strokeStyle = shade(m.base, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, top + 3.2 + bob);
    ctx.lineTo(cx - this.rect.w / 2 + 3, top + 1.6 + bob);
    ctx.stroke();
    // 叶缘高光 + 中心芽点
    ctx.fillStyle = m.accent;
    ctx.fillRect(cx - this.rect.w / 2 + 2, top + 1.4 + bob, this.rect.w - 4, 1);
    ctx.fillRect(cx - 1, top + 3 + bob, 2, 1);
    ctx.fillStyle = shade(m.base, 1.2);
    ctx.fillRect(cx - this.rect.w / 4, top + 2.2 + bob, 2, 1);
    ctx.fillRect(cx + this.rect.w / 5, top + 2.6 + bob, 2, 1);
    if (this.mode === "patrol" || this.state === "to" || this.state === "back") {
      if (Math.random() < 0.12) {
        w.particles.spawn({
          x: cx + (Math.random() - 0.5) * this.rect.w * 0.7,
          y: top + 6,
          vx: 0,
          vy: 6,
          life: 0.5,
          color: m.accent,
          size: 1,
        });
      }
    }
  }
}

/** 角色是否正站在矩形平台顶面上（feet 贴 top ±3px、水平有重叠）。 */
function standingOn(w: World, r: Rect, requireFalling: boolean): boolean {
  const p = w.player;
  if (p.deadT > 0 || p.swing || p.pull || p.climb) return false;
  if (requireFalling && p.vy < 0) return false;
  const b = p.box;
  return Math.abs(b.y1 - r.y) <= 3 && b.x1 > r.x + 1 && b.x0 < r.x + r.w - 1;
}

// ---- 猪笼草电梯：站上笼口自动乘坐，沿轴移到另一端后放下；开关触发可无客单程 ----
// 笼身 1×2（口在上）。乘坐时玩家被"吞"进笼里（隐藏、位置锁在笼口），到站自动吐出。
// 跨房：endOff 是"端到端世界向量"（含邻房网格偏移）——笼子会真实飞越房间边界，
// 越界瞬间由 world.handoffElevator 把笼子（和乘客）迁入目标房（adopt 重定坐标系）。

export class PitcherElevator extends MoverPlatform {
  readonly rect: Rect; // 笼身（编辑器占位参考；本体无碰撞）
  private t2 = Math.random() * 10;
  private end = 0; // 停靠端：0=基点 1=终点
  private state: "idle" | "moving" | "dwell" = "idle";
  private timer = 0; // boarding / dwell 共用
  private riding = false;
  private prevTrig = false; // 触发边沿：reset 期间不反复发车
  private awaitExit = false; // 吐客后须走出笼身才会再次载人（防原地弹跳）
  /** 空笼跨房挂载在世界级 detached 列表（玩家视野外飞行）：不检测登乘——登乘判定用的是玩家坐标，跨房间系比较无意义 */
  detached = false;
  private handedOff = false; // 跨房行程：已迁入目标房
  readonly originId: string; // 出发房网格键（返回行程的 handoff 目标）
  private returnTimer: number | null = null; // back=true：吐客后倒计时空笼返回起点
  private readonly endOff: { x: number; y: number }; // 端到端世界向量（跨房含邻房偏移）
  private readonly endShift: { x: number; y: number }; // 目标房原点相对本房的世界 px 偏移
  homeId: string;
  readonly endRoom: string; // end.room_id：终点所在房间（可跨房）
  private readonly speed: number;
  readonly id: string;
  private readonly dwell: number;
  readonly back: boolean;
  constructor(
    pos: ObjPos,
    end: ObjPos,
    o: { speed?: number; dwell?: number; id: string; back?: boolean },
    homeId = "",
    flags?: ReadonlySet<string>,
  ) {
    super();
    this.rect = { x: pos.x * TILE, y: pos.y * TILE, w: TILE, h: 2 * TILE };
    this.x = this.rect.x + TILE / 2;
    this.y = this.rect.y;
    this.homeId = homeId;
    this.originId = homeId;
    this.endRoom = end.room_id;
    this.speed = Math.max(8, o.speed ?? 40);
    this.id = o.id;
    this.dwell = Math.max(0, o.dwell ?? 0.8);
    this.back = o.back ?? false;
    this.end = flags?.has(`lift:${o.id}`) ? 1 : 0; // 到站状态持久：flag=停在中标端（默认行为）
    // 端到端世界向量：终点格（含目标房网格偏移）- 起点格。同房时就是普通向量。
    const hp = ROOM_POS[homeId] ?? { x: 0, y: 0 };
    const ep = ROOM_POS[end.room_id] ?? hp; // end.room_id 是房间 id（Rxx）
    this.endShift = { x: (ep.x - hp.x) * 32 * TILE, y: (ep.y - hp.y) * 18 * TILE };
    this.endOff = { x: end.x * TILE - this.rect.x + this.endShift.x, y: end.y * TILE - this.rect.y + this.endShift.y };
    // 持久恢复：flag=停在远端 → 以终点房形态醒来（homeId/off/handedOff 全按远端）；
    // originId 仍是数据原位，返程/触发语义不变
    if (this.end === 1) {
      this.homeId = this.endRoom;
      this.handedOff = true;
      this.off = { x: this.endOff.x - this.endShift.x, y: this.endOff.y - this.endShift.y };
      // 持久恢复=静止停在远端：不许立刻载人/发车（玩家可能出生在笼口位置），走出笼身才重新武装
      this.awaitExit = true;
    }
  }
  /** 笼口（ boarding 判定/乘客锁定点）。 */
  private mouth(): Rect {
    return { x: this.rect.x + this.offX(), y: this.rect.y + this.offY(), w: TILE, h: 6 };
  }
  /** 是否正载着乘客（跨房 handoff 用：空笼行程不动玩家）。 */
  get carrying(): boolean {
    return this.riding;
  }
  /** 是否停在中标端（跨房持久重建判定用）。 */
  get atFar(): boolean {
    return this.end === 1;
  }
  /** 当前行程段的目标（当前所在房间的坐标系）。handoff 换房后坐标系平移，同一位置的目标随之换算：
   *  去程终点在出发房系是 endOff，迁入目标房后 = endOff - endShift；
   *  返程原地是出发房系 {0,0}，还在目标房时 = -endShift。 */
  private goalNow(): { x: number; y: number } {
    if (this.end === 1) {
      return this.handedOff
        ? { x: this.endOff.x - this.endShift.x, y: this.endOff.y - this.endShift.y }
        : this.endOff;
    }
    return this.handedOff ? { x: -this.endShift.x, y: -this.endShift.y } : { x: 0, y: 0 };
  }
  private offX(): number {
    return this.off.x;
  }
  private offY(): number {
    return this.off.y;
  }
  update(w: World): void {
    const dt = 1 / 60;
    this.t2 += dt;
    const m = this.mouth();

    if (this.state === "idle") {
      // 单程语义：笼子停在哪端，玩家走进笼口就从哪端出发——没有"呼叫回航"，
      // 也没有开关触发的无客往返。要它回到另一端，要么走过去重新乘坐、要么用开关再触发一趟。
      // detached（视野外空笼）不做登乘检测：判定拿玩家坐标跨房间系比较，无意义且可能误吞。
      if (!this.riding && !this.detached) {
        const p = w.player;
        const bottom = this.rect.y + this.offY() + 2 * TILE;
        const cxL = this.rect.x + this.offX() - 2;
        const cxR = this.rect.x + this.offX() + TILE + 2;
        const inZone =
          p.deadT <= 0 && p.x > cxL && p.x < cxR && p.y + 4 > this.rect.y + this.offY() + 6 && p.y + 4 <= bottom;
        if (this.awaitExit) {
          // 吐客后：走出了笼身才重新武装
          if (!inZone) this.awaitExit = false;
          this.timer = 0;
        } else {
          const onMouth = inZone && p.grounded && p.vy >= 0;
          this.timer = onMouth ? this.timer + dt : 0;
          if (this.timer >= 0.25) {
            this.riding = true;
            this.timer = 0;
            audio.plant();
            w.particles.burst(m.x + TILE / 2, m.y, 8, { speed: 20, color: "#b8e0a0", life: 0.4, grav: -30 });
            this.depart(w);
          }
        }
      }
      // 开关触发（边沿）：无客也走一趟单程到另一端停住（不回程）；任何 idle 帧都可触发
      const trig = !!this.id && w.triggerActive(this.id);
      if (trig && !this.prevTrig && !this.riding && this.state === "idle") {
        this.depart(w);
      }
      this.prevTrig = trig;
      // back=true：空笼返回倒计时（到站停稳后才开始走）
      if (this.returnTimer != null) {
        this.returnTimer -= dt;
        if (this.returnTimer <= 0) {
          this.returnTimer = null;
          this.depart(w);
        }
      }
    } else if (this.state === "moving") {
      if (this.moveToward(this.goalNow(), this.speed, dt) < 0.5) {
        this.off = { ...this.goalNow() };
        this.state = "dwell";
        this.timer = this.dwell;
      }
      // 跨房：笼身（1×2 格，rect+off = 所在房局部坐标）完全越过当前房间边界 → 连笼带人迁入
      // 行进方向的邻房。阈值是"完全越界"（笼宽/笼高），不是目标房原点——终点再远也在邻房原点之前。
      // 迁入后坐标系换了，行程目标跟着平移（见 goalNow）；adopt 里会置 handedOff 并平移 off。
      const going = this.end === 1 ? this.endShift : { x: -this.endShift.x, y: -this.endShift.y };
      const away =
        this.end === 1
          ? !this.handedOff && this.endRoom !== this.homeId
          : this.handedOff && this.homeId !== this.originId;
      if (away) {
        const sumX = this.rect.x + this.off.x;
        const sumY = this.rect.y + this.off.y;
        const passed =
          going.x !== 0
            ? going.x < 0
              ? sumX <= -TILE
              : sumX >= ROOM_W
            : going.y < 0
              ? sumY <= -2 * TILE
              : sumY >= ROOM_H;
        if (passed) {
          const toRoom = this.end === 1 ? this.endRoom : this.originId;
          const shift = this.end === 1 ? this.endShift : { x: -this.endShift.x, y: -this.endShift.y };
          w.handoffElevator(this, toRoom, shift);
        }
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.riding) {
          // 到站吐出乘客：放到笼底。跨房已在途中 handoff 迁房——这里按新坐标系直接放笼底即可
          this.riding = false;
          this.awaitExit = true;
          const cageBottomX = this.rect.x + this.offX() + TILE / 2;
          const cageBottomY = this.rect.y + this.offY() + 2 * TILE - 4;
          w.player.x = cageBottomX;
          w.player.y = cageBottomY;
          w.player.vy = 0;
          w.player.exitJump = true; // 出舱赠跳：笼口悬空也能立刻起跳一次
          audio.plant();
          w.particles.burst(cageBottomX, cageBottomY + 4, 10, { speed: 26, color: "#b8e0a0", life: 0.5, grav: 40 });
          this.state = "idle"; // 单程：停在这一端，等玩家再上或开关再触发
          // back=true 只在"送达远端"时装填返程——回到原点(end=0)不再触发，否则无限往返
          if (this.back && this.end === 1) this.returnTimer = 1;
        } else {
          this.state = "idle";
          if (this.back && this.end === 1) this.returnTimer = 1;
        }
      }
    }

    // 乘客每帧锁在笼口（吞着走）
    if (this.riding) {
      w.hidePlayer = true;
      const p = w.player;
      p.x = this.rect.x + this.offX() + TILE / 2;
      p.y = this.rect.y + this.offY() + 2 * TILE - 4;
      p.vx = 0;
      p.vy = 0;
    }
  }
  /** 跨房 handoff：world.loadRoom 后调用——笼子换到目标房坐标系（off 平移房间差），
   *  行程目标（endOff / 0）始终是出发房坐标，故去程/返程各做一次 handoff 即可闭环。 */
  adopt(endRoom: string, shift: { x: number; y: number }, handed: boolean): void {
    this.homeId = endRoom;
    this.off.x -= shift.x;
    this.off.y -= shift.y;
    this.handedOff = handed;
  }
  private depart(w: World): void {
    this.end = this.end === 0 ? 1 : 0;
    // 到站状态持久：停在哪端写进 flags（跨房间/读档按它恢复）
    if (this.id) w.setLiftEnd(this.id, this.end === 1);
    this.state = "moving";
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const m = mat("lilypad");
    const px = Math.round(this.rect.x + this.offX());
    const py = Math.round(this.rect.y + this.offY());
    const sway = Math.sin(this.t2 * 1.4) * 0.6;
    const open = this.state === "idle" && !this.riding;
    // 笼身：瓶形（收腰 + 鼓腹）
    ctx.fillStyle = "#142018";
    ctx.fillRect(px, py + TILE - 1, TILE, TILE + 2);
    ctx.fillStyle = shade(m.base, 0.5);
    ctx.fillRect(px + 1, py + TILE, TILE - 2, TILE);
    ctx.fillStyle = m.base;
    ctx.fillRect(px + 2, py + TILE, TILE - 4, TILE - 1);
    ctx.fillRect(px + 3, py + TILE + 3, TILE - 6, TILE - 3);
    ctx.fillStyle = shade(m.base, 0.75);
    ctx.fillRect(px + 3, py + TILE + 4, 1, TILE - 5);
    ctx.fillStyle = shade(m.base, 1.2);
    ctx.fillRect(px + TILE - 4, py + TILE + 2, 1, 4);
    // 笼口：唇环 + 张开的口
    ctx.fillStyle = shade(m.base, 1.35);
    ctx.fillRect(px + 1, py + TILE - 2, TILE - 2, 3);
    ctx.fillStyle = "#1a2416";
    ctx.fillRect(px + 2, py + TILE - 1, TILE - 4, 2);
    // 盖叶：停靠时翘开（等着），载客中合上
    ctx.fillStyle = m.accent;
    const lidLift = open ? Math.round(3 + sway) : 1;
    ctx.fillRect(px + 2, py + TILE - 2 - lidLift, TILE - 4, 2);
    // 唇上糖露：引诱玩家的高光
    ctx.fillStyle = "#e8f0c0";
    ctx.fillRect(px + 3, py + TILE - 2, 2, 1);
    // 乘客在笼里时透出一点轮廓光
    if (this.riding) {
      ctx.globalAlpha = 0.35 + Math.sin(this.t2 * 6) * 0.15;
      ctx.fillStyle = m.accent;
      ctx.fillRect(px + 3, py + TILE + 1, TILE - 6, TILE - 3);
      ctx.globalAlpha = 1;
    }
    // 旅行虚线（仅编辑器画：游戏里不画路径保持神秘感）
    void w;
  }
}

// ---- 地刺排：1×w 的尖刺，物件化（不再烙进地图 ^）；判定/绘制/警示光全在自己身上 ----

export class SpikeRow extends BaseEntity {
  readonly rect: Rect;
  constructor(tx: number, ty: number, readonly tw: number) {
    super();
    this.rect = { x: tx * TILE, y: ty * TILE, w: tw * TILE, h: TILE };
    this.x = this.rect.x + this.rect.w / 2;
    this.y = this.rect.y;
  }
  update(w: World): void {
    this.t += 1 / 60;
    void w;
  }
  draw(ctx: CanvasRenderingContext2D, w: World): void {
    const pal = paletteFor(w.depth());
    const base = this.rect.y + TILE;
    // 底座
    ctx.fillStyle = pal.spikeBase;
    ctx.fillRect(this.rect.x, base - 2, this.rect.w, 2);
    // 尖刺：细长带弧的獠牙形——比瓦片 ^ 更尖更凶
    const n = this.tw * 3;
    for (let i = 0; i < n; i++) {
      const bx = this.rect.x + (i + 0.5) * (this.rect.w / n);
      const hgt = 8 + ((i * 7) % 3);
      const lean = ((i * 13) % 5) / 5 - 0.4; // 轻微歪斜，野性感
      ctx.fillStyle = pal.spike;
      ctx.beginPath();
      ctx.moveTo(bx - 1.4, base - 2);
      ctx.quadraticCurveTo(bx - 0.8 + lean, base - hgt * 0.55, bx + lean * 2, base - hgt);
      ctx.quadraticCurveTo(bx + 0.8 + lean, base - hgt * 0.55, bx + 1.4, base - 2);
      ctx.closePath();
      ctx.fill();
      // 寒光尖
      ctx.fillStyle = "rgba(255,244,230,0.55)";
      ctx.fillRect(bx + lean * 2 - 0.5, base - hgt + 1, 1, 2);
    }
  }
  lights(): Light[] {
    // 每格一点红色警示呼吸（错相）
    const out: Light[] = [];
    for (let i = 0; i < this.tw; i++) {
      out.push({
        x: this.rect.x + i * TILE + 5,
        y: this.rect.y + 6,
        r: 13,
        tint: "255,96,64",
        strength: 0.68 + Math.sin(this.t * 3.2 + i * 7) * 0.12,
      });
    }
    return out;
  }
}

// ---- 场景光物：蜡烛 / 吊灯 / 发光晶石 / 萤火虫群（都可在编辑器摆放，材质调色） ----

export class Candle extends LightSource {
  readonly rect: Rect;
  constructor(tx: number, ty: number, homeId = "", opts: { radius?: number; intensity?: number } = {}) {
    super(18, opts);
    this.rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    this.x = this.rect.x + TILE / 2;
    this.y = this.rect.y + TILE / 2;
    this.homeId = homeId;
  }
  update(_w: World): void {
    this.t += 1 / 60;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const m = mat("candle");
    const fl = Math.sin(this.t * 11) * 0.6 + Math.sin(this.t * 23) * 0.3;
    const px = this.rect.x;
    const py = this.rect.y;
    // 暖光晕：烛焰周围一圈随火苗摇曳的亮区——三格开外也能一眼看见它活着
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(px + 5, py + 4, 1, px + 5, py + 4, 9 + fl);
    halo.addColorStop(0, `rgba(${m.glow},0.30)`);
    halo.addColorStop(1, `rgba(${m.glow},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(px - 7, py - 9, 24, 24);
    ctx.restore();
    ctx.fillStyle = "#1a140c";
    ctx.fillRect(px + 1, py + 8, TILE - 2, 2);
    ctx.fillStyle = "#4a3a24";
    ctx.fillRect(px + 2, py + 8, TILE - 4, 2);
    ctx.fillStyle = shade(m.base, 0.7);
    ctx.fillRect(px + 3, py + 4, 4, 5);
    ctx.fillStyle = m.base;
    ctx.fillRect(px + 4, py + 4, 2, 5);
    ctx.fillStyle = "#fff8e0";
    ctx.fillRect(px + 4, py + 4, 1, 1);
    ctx.fillStyle = m.accent;
    ctx.fillRect(px + 4, Math.round(py + 1 + fl * 0.4), 2, 4);
    ctx.fillStyle = "rgba(255,250,220,0.95)";
    ctx.fillRect(px + 4, Math.round(py + 2 + fl * 0.5), 2, 1);
    ctx.fillStyle = "#ffdf8a";
    ctx.fillRect(px + 4, Math.round(py + 3 + fl * 0.3), 1, 1);
  }
  lights(): Light[] {
    const fl = 0.8 + Math.sin(this.t * 9) * 0.2;
    return [{ x: this.x, y: this.y - 2, r: this.lum.r, tint: mat("candle").glow, strength: 1.15 * this.lum.k * fl }];
  }
}

export class HangingLamp extends LightSource {
  readonly rect: Rect;
  constructor(tx: number, ty: number, homeId = "", opts: { radius?: number; intensity?: number } = {}) {
    super(24, opts);
    this.rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: 2 * TILE };
    this.x = this.rect.x + TILE / 2;
    this.y = this.rect.y + 2 * TILE;
    this.homeId = homeId;
  }
  update(_w: World): void {
    this.t += 1 / 60;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const m = mat("lamp");
    const sway = Math.sin(this.t * 1.2) * 0.8;
    const px = this.rect.x + sway;
    const py = this.rect.y;
    // 灯下暖光池：让"这是一盏点着的灯"远远就读得出来
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pool = ctx.createRadialGradient(px + TILE / 2, py + 13, 2, px + TILE / 2, py + 13, 13);
    pool.addColorStop(0, `rgba(${m.glow},0.32)`);
    pool.addColorStop(1, `rgba(${m.glow},0)`);
    ctx.fillStyle = pool;
    ctx.fillRect(px - 10, py + 1, 30, 26);
    ctx.restore();
    ctx.strokeStyle = "#1a2016";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + TILE / 2, py);
    ctx.lineTo(px + TILE / 2, py + 8);
    ctx.stroke();
    ctx.fillStyle = "#3a3830";
    ctx.fillRect(px + TILE / 2 - 0.5, py + 2, 1, 1);
    ctx.fillRect(px + TILE / 2 - 0.5, py + 5, 1, 1);
    ctx.fillStyle = shade(m.base, 0.45);
    ctx.fillRect(px + TILE / 2 - 4, py + 8, 8, 2);
    ctx.fillStyle = shade(m.base, 0.7);
    ctx.fillRect(px + TILE / 2 - 3, py + 10, 6, 5);
    ctx.fillStyle = m.base;
    ctx.fillRect(px + TILE / 2 - 2, py + 11, 4, 3);
    ctx.fillStyle = m.accent;
    ctx.fillRect(px + TILE / 2 - 1, py + 11, 2, 2);
    ctx.fillStyle = "#fff8d8";
    ctx.fillRect(px + TILE / 2 - 1, py + 11, 2, 1);
  }
  lights(): Light[] {
    const fl = 0.85 + Math.sin(this.t * 7.3) * 0.15;
    return [{ x: this.x, y: this.y, r: this.lum.r, tint: mat("lamp").glow, strength: 1.1 * this.lum.k * fl }];
  }
}

export class GlowStone extends LightSource {
  readonly rect: Rect;
  constructor(tx: number, ty: number, homeId = "", opts: { radius?: number; intensity?: number } = {}) {
    super(16, opts);
    this.rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    this.x = this.rect.x + TILE / 2;
    this.y = this.rect.y + TILE / 2;
    this.homeId = homeId;
  }
  update(_w: World): void {
    this.t += 1 / 60;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const m = mat("glowstone");
    const pulse = 0.65 + Math.sin(this.t * 1.4) * 0.35;
    const rx = this.rect.x;
    const ry = this.rect.y;
    // 矿簇自体光晕：脉动时整块石头"呼吸"
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(rx + 5, ry + 5, 1, rx + 5, ry + 5, 10);
    halo.addColorStop(0, `rgba(${m.glow},${(0.22 + pulse * 0.16).toFixed(3)})`);
    halo.addColorStop(1, `rgba(${m.glow},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(rx - 7, ry - 7, 24, 24);
    ctx.restore();
    ctx.fillStyle = shade(m.base, 0.4);
    ctx.beginPath();
    ctx.moveTo(rx + 1, ry + 9);
    ctx.lineTo(rx + 3, ry + 2);
    ctx.lineTo(rx + 7, ry + 4);
    ctx.lineTo(rx + 9, ry + 9);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    ctx.fillStyle = m.base;
    ctx.beginPath();
    ctx.moveTo(rx + 2, ry + 8);
    ctx.lineTo(rx + 4, ry + 3);
    ctx.lineTo(rx + 6, ry + 5);
    ctx.lineTo(rx + 8, ry + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = m.accent;
    ctx.fillRect(rx + 4, ry + 4, 2, 2);
    ctx.globalAlpha = 1;
  }
  lights(): Light[] {
    const pulse = 0.6 + Math.sin(this.t * 1.4) * 0.4;
    return [{ x: this.x, y: this.y, r: this.lum.r, tint: mat("glowstone").glow, strength: 1.0 * this.lum.k * pulse }];
  }
}

export class FireflySwarm extends LightSource {
  readonly rect: Rect;
  private flies = [0, 1, 2].map((i) => ({ ph: i * 2.1, r: 5 + i * 3, sp: 0.5 + i * 0.17 }));
  constructor(tx: number, ty: number, homeId = "", opts: { radius?: number; intensity?: number } = {}) {
    super(16, opts);
    this.rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    this.x = this.rect.x + TILE / 2;
    this.y = this.rect.y + TILE / 2;
    this.homeId = homeId;
  }
  update(_w: World): void {
    this.t += 1 / 60;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const m = mat("fireflies");
    for (const f of this.flies) {
      const x = this.x + Math.sin(this.t * f.sp + f.ph) * f.r + Math.sin(this.t * 1.7 + f.ph * 2) * 2;
      const y = this.y + Math.cos(this.t * f.sp * 0.8 + f.ph) * f.r * 0.6;
      const blink = Math.max(0, Math.sin(this.t * 2.1 + f.ph * 3));
      ctx.fillStyle = `rgba(${m.glow},${(0.4 * blink * blink).toFixed(3)})`;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = `rgba(240,255,200,${(0.9 * blink * blink).toFixed(3)})`;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    ctx.restore();
  }
  lights(): Light[] {
    return [
      { x: this.x, y: this.y, r: this.lum.r, tint: mat("fireflies").glow, strength: (0.7 + Math.sin(this.t * 1.3) * 0.25) * this.lum.k },
    ];
  }
}

// ---- 存档花：靠近按使用键 = 回满血 + 设为重生点；激活后可在各存档花之间传送 ----

export class SavePoint extends BaseEntity {
  /** 编辑器物件在该房 objects 列表里的稳定键（"房号#序号"），激活态存 flags。 */
  readonly flagKey: string;
  attuned: boolean;
  constructor(tx: number, ty: number, flagKey: string, attuned = false) {
    super();
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE + TILE / 2;
    this.flagKey = flagKey;
    this.attuned = attuned;
  }
  update(w: World): void {
    this.t += 1 / 60;
    // 光屑缓缓上升——远处一眼认出"这里是存档点"（未激活也有，弱一些：别让玩家错过它）
    if (Math.random() < (this.attuned ? 0.06 : 0.03)) {
      w.particles.spawn({
        x: this.x + (Math.random() - 0.5) * 10,
        y: this.y - 2 - Math.random() * 4,
        vx: (Math.random() - 0.5) * 4,
        vy: -8 - Math.random() * 8,
        life: 1.2,
        color: mat("savepoint").accent,
      });
    }
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const m = mat("savepoint");
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    const bloom = this.attuned ? 0.85 + Math.sin(this.t * 2.2) * 0.2 : 0.25;
    // 地面光环：未激活也有一圈呼吸微光——"这不是装饰，是可以用的东西"
    const pulse = 0.5 + Math.sin(this.t * 2.2) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y + 2, 2, x, y + 2, 14 + (this.attuned ? 5 : 0) + pulse * 2);
    halo.addColorStop(0, `rgba(${m.glow},${(this.attuned ? 0.32 : 0.14) + pulse * 0.06})`);
    halo.addColorStop(1, `rgba(${m.glow},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(x - 18, y - 16, 36, 24);
    ctx.restore();
    ctx.fillStyle = "#12181c";
    ctx.fillRect(x - 4, y + 3, 9, 3);
    ctx.fillStyle = "#2c3a42";
    ctx.fillRect(x - 3, y + 1, 7, 3);
    ctx.fillStyle = "#5a6a72";
    ctx.fillRect(x - 3, y + 1, 7, 1);
    ctx.fillStyle = shade(m.base, 0.7);
    ctx.fillRect(x, y - 4, 1, 5);
    ctx.fillStyle = m.base;
    ctx.fillRect(x, y - 3, 1, 4);
    if (this.attuned) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.sin(this.t * 1.3) * 0.12;
        const px = x + Math.cos(a) * (3 + bloom);
        const py = y - 5 + Math.sin(a) * (2.4 + bloom) * 0.85;
        ctx.fillStyle = shade(m.base, 0.75);
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
        ctx.fillStyle = m.base;
        ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
      }
      ctx.fillStyle = m.accent;
      ctx.fillRect(x - 1, y - 6, 3, 3);
      ctx.fillStyle = "#f4ffec";
      ctx.fillRect(x, y - 6, 1, 1);
    } else {
      // 未激活：暗苞 + 缓慢呼吸的亮边（比以前明显得多）
      const breathe = 0.35 + Math.sin(this.t * 2.2) * 0.25;
      ctx.fillStyle = shade(m.base, 0.55);
      ctx.fillRect(x - 2, y - 8, 5, 5);
      ctx.fillRect(x - 1, y - 9, 3, 2);
      ctx.globalAlpha = breathe + 0.3;
      ctx.fillStyle = m.accent;
      ctx.fillRect(x - 2, y - 9, 1, 1);
      ctx.fillRect(x + 1, y - 8, 1, 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = shade(m.accent, 0.5);
      ctx.fillRect(x, y - 6, 1, 2);
    }
  }
  lights(): Light[] {
    const m = mat("savepoint");
    if (this.attuned) {
      const pulse = 0.85 + Math.sin(this.t * 2.2) * 0.15;
      return [{ x: this.x, y: this.y - 4, r: 18, tint: m.glow, strength: 0.95 * pulse }];
    }
    const pulse = 0.5 + Math.sin(this.t * 2.2) * 0.5;
    return [{ x: this.x, y: this.y - 4, r: 11, tint: m.glow, strength: 0.55 * pulse }];
  }
}

// ---- 物件类型注册表：数据 ObjDef → 实体实例 ----
// 新增物品 = 写一个类 + 在这里挂一行（编辑器侧字段表在 editor/palette.ts 的 OBJ_SPECS）。
// room_id（"R07"）在此统一解析成游戏内部使用的网格键；返回数组 = 一个物件格子生成多个实体。
// ObjOf 把每条工厂的参数收窄成对应的具体 ObjDef 成员（判别联合按 type 取）。
type ObjOf<T extends ObjDef["type"]> = Extract<ObjDef, { type: T }>;
// key = 存档 flag 键（"房#序号"）；homeId = 网格键（载具所属房间）——两个用途别混：
// 电梯拿 homeId 和 end.room_id 比较判断是否跨房，传成 flag 键会让同房电梯到站也"跨房投递"
type AnyEntityFactory = (o: never, key: string, flags: ReadonlySet<string>, homeId: string) => BaseEntity | BaseEntity[];
export const ENTITY_TYPES = {
  item: (o: ObjOf<"item">) => new Pickup(o.location.x * 10 + 5, o.location.y * 10 + 5, { type: "item", item: o.item }, o.r),
  seed: (o: ObjOf<"seed">) => new Pickup(o.location.x * 10 + 5, o.location.y * 10 + 5, { type: "seed", id: o.id }),
  ring: (o: ObjOf<"ring">) => new Ring(o.location.x, o.location.y),
  switch: (o: ObjOf<"switch">) =>
    new Switch(o.location.x, o.location.y, o.id, o.controls, BINDING_KIND[o.controls[0]] ?? "door", o.reset),
  plate: (o: ObjOf<"plate">) =>
    new PressurePlate(o.location.x, o.location.y, o.id, o.controls, BINDING_KIND[o.controls[0]] ?? "door", o.reset),
  door: (o: ObjOf<"door">, _key: string, flags: ReadonlySet<string>) =>
    new Door(o.location.x, o.location.y, o.w, o.h, o.id, o.fragile, o.dir, flags.has(`door:${o.id}`)),
  vinebud: (o: ObjOf<"vinebud">, key: string) => new VineBud(o.location.x, o.location.y, o.h, key),
  bud: (o: ObjOf<"bud">, key: string, flags: ReadonlySet<string>) =>
    new Bud(o.location.x, o.location.y, key, flags.has(`bud:${key}`)),
  spores: (o: ObjOf<"spores">) => new SporeCloud(o.location.x, o.location.y, o.w, o.h),
  wisp: (o: ObjOf<"wisp">) => new Wisp(o.location.x, o.location.y),
  flower: (o: ObjOf<"flower">) => new Flower(o.location.x, o.location.y),
  ledge: (o: ObjOf<"ledge">) => new Ledge(o.location.x, o.location.y, o.w),
  shroom: (o: ObjOf<"shroom">) => new BounceShroom(o.location.x, o.location.y),
  vine: (o: ObjOf<"vine">) => new HangingVine(o.location.x, o.location.y, o.h, o.lens, o.hMin),
  tree: (o: ObjOf<"tree">) => new SmallTree(o.location.x, o.location.y, o.h),
  prop: (o: ObjOf<"prop">) => {
    const pd = propById(o.id);
    return pd ? new CustomProp(o.location.x, o.location.y, pd) : [];
  },
  crumble: (o: ObjOf<"crumble">) =>
    Array.from({ length: o.w }, (_, i) => new CrumblePod(o.location.x + i, o.location.y)),
  lilypad: (o: ObjOf<"lilypad">) => new LilyPad(o.location, o.end, o),
  spike: (o: ObjOf<"spike">) => new SpikeRow(o.location.x, o.location.y, Math.max(1, o.w ?? 1)),
  candle: (o: ObjOf<"candle">, _key: string, _flags: ReadonlySet<string>, homeId: string) =>
    new Candle(o.location.x, o.location.y, homeId, o),
  lamp: (o: ObjOf<"lamp">, _key: string, _flags: ReadonlySet<string>, homeId: string) =>
    new HangingLamp(o.location.x, o.location.y, homeId, o),
  glowstone: (o: ObjOf<"glowstone">, _key: string, _flags: ReadonlySet<string>, homeId: string) =>
    new GlowStone(o.location.x, o.location.y, homeId, o),
  fireflies: (o: ObjOf<"fireflies">, _key: string, _flags: ReadonlySet<string>, homeId: string) =>
    new FireflySwarm(o.location.x, o.location.y, homeId, o),
  elevator: (o: ObjOf<"elevator">, _key: string, _flags: ReadonlySet<string>, homeId: string) =>
    new PitcherElevator(o.location, o.end, o, homeId),
  savepoint: (o: ObjOf<"savepoint">, key: string, flags: ReadonlySet<string>) =>
    new SavePoint(o.location.x, o.location.y, key, flags.has(`sp:${key}`)),
} satisfies Record<string, AnyEntityFactory>;
