// 编辑器画布：瓦片/物件的示意图形 + 邻室淡显 + 边缘洞口配对标记。
// 全部矢量绘制（非像素画），缩放自由。
// 自定义物件直接复用游戏侧 drawPropShape——编辑器里看到的就是游戏里跑的。
import { ROOM_COLS, ROOM_ROWS, TILE } from "../game/constants";
import { drawPropShape } from "../game/entities";
import { footprint, num, objSpec, defaultsFor, objPos, TILES, type ObjRec } from "./palette";
import { matOf, shade, propByIdDoc } from "./mats";
import type { EditorDoc } from "./doc";
import type { PropDef } from "../data/props";

export interface UIState {
  key: string;
  tool: string;
  brushTile: string;
  placeType: string;
  /** 当前调色板选中项：瓦片画笔时预览要画瓦片，而不是上一个物件 */
  palSel: { kind: "tile" | "obj"; ch?: string; type?: string };
  selection: number | null;
  hover: { x: number; y: number } | null;
  /** hover 命中的房间键（跨房编辑时 hover 可能落在邻房） */
  hoverKey: string | null;
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 选择工具的框选拖拽矩形（世界格，跨房覆盖）。 */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** 框选集合：物件定位键 "房键#序号"。 */
  multiSel: Set<string>;
  placeCtx: { nextDoorId: string; nextSeedId: number; propId: string; roomId: string };
}

const ZOOMS = [10, 12, 14, 16, 18, 20, 24, 28, 32];

/** hex → rgba() 字符串。 */
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class EditorRenderer {
  private ctx: CanvasRenderingContext2D;
  ts = 20;
  /** 视口偏移（px）：世界原点 (0,0) 是 (minCx,minCy) 房间的左上角。 */
  camX = 0;
  camY = 0;
  private zoomIdx: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** 屏幕中心对齐到世界 px 坐标（当前房居中）。 */
  centerOn(wx: number, wy: number): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camX = wx - w / 2;
    this.camY = wy - h / 2;
  }

  pan(dx: number, dy: number): void {
    this.camX += dx;
    this.camY += dy;
  }

  /** 屏幕坐标 → 世界 px。 */
  private s2w(mx: number, my: number): { x: number; y: number } {
    return { x: mx + this.camX, y: my + this.camY };
  }

  fit(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w < 10 || h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ts =
      this.zoomIdx != null
        ? ZOOMS[this.zoomIdx]
        : Math.max(10, Math.min(32, Math.floor(Math.min((w - 30) / ROOM_COLS, (h - 30) / ROOM_ROWS))));
  }

  zoom(dir: -1 | 1): void {
    if (this.zoomIdx == null) {
      let best = 0;
      for (let i = 0; i < ZOOMS.length; i++) {
        if (Math.abs(ZOOMS[i] - this.ts) < Math.abs(ZOOMS[best] - this.ts)) best = i;
      }
      this.zoomIdx = best;
    }
    this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIdx + dir));
    this.fit();
  }

  /** 以鼠标位置为锚缩放：滚轮下的世界点缩放前后保持不动（地图不因缩放平移）。 */
  zoomAt(mx: number, my: number, dir: -1 | 1): void {
    const before = this.ts;
    this.zoom(dir);
    if (this.ts === before) return;
    this.camX += (mx * (this.ts - before)) / before;
    this.camY += (my * (this.ts - before)) / before;
  }

  /** 屏幕坐标 → 世界格 { roomId, x, y }（命中 doc 里哪个房间；画布范围外返回 null）。 */
  toWorldTile(doc: EditorDoc, mx: number, my: number): { roomId: string; x: number; y: number } | null {
    const wp = this.s2w(mx, my);
    const rx = Math.floor(wp.x / (ROOM_COLS * this.ts));
    const ry = Math.floor(wp.y / (ROOM_ROWS * this.ts));
    for (const k of doc.idOrder) {
      const r = doc.rooms[k];
      if (!r || r.x !== rx || r.y !== ry) continue;
      const x = Math.floor((wp.x - rx * ROOM_COLS * this.ts) / this.ts);
      const y = Math.floor((wp.y - ry * ROOM_ROWS * this.ts) / this.ts);
      if (x >= 0 && y >= 0 && x < ROOM_COLS && y < ROOM_ROWS) return { roomId: k, x, y };
    }
    return null;
  }

  /** 房间本地格 → 该房间原点的屏幕 px（render 已把房间原点 translate 到屏幕）。 */
  private px(x: number, y: number): { x: number; y: number } {
    return { x: x * this.ts, y: y * this.ts };
  }

  /** 世界 px → 该房间本地 px（判断某房间是否在屏幕内）。 */
  private roomScreenRect(roomCx: number, roomCy: number): { x: number; y: number } {
    const x = roomCx * ROOM_COLS * this.ts - this.camX;
    const y = roomCy * ROOM_ROWS * this.ts - this.camY;
    return { x, y };
  }

  render(doc: EditorDoc, ui: UIState, t: number): void {
    const c = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    c.fillStyle = "#0b0e13";
    c.fillRect(0, 0, w, h);

    // 视口可见的房间范围：把 (camX,camY) 映射到房间格子
    const c0 = Math.floor(this.camX / (ROOM_COLS * this.ts));
    const r0 = Math.floor(this.camY / (ROOM_ROWS * this.ts));
    const c1 = Math.floor((this.camX + w) / (ROOM_COLS * this.ts));
    const r1 = Math.floor((this.camY + h) / (ROOM_ROWS * this.ts));
    // 网格坐标 → 房间 id：房间数据以 id 为键，坐标在 rec.x/rec.y 上
    const byPos = new Map<string, string>();
    for (const [rid, r] of Object.entries(doc.rooms)) byPos.set(`${r.x},${r.y}`, rid);

    // 先画非当前房（暗），再画当前房（亮）盖在上面
    const roomsToDraw: { key: string; cx: number; cy: number; active: boolean }[] = [];
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const rid = byPos.get(`${cx},${cy}`);
        if (!rid) continue;
        roomsToDraw.push({ key: rid, cx, cy, active: rid === ui.key });
      }
    }
    roomsToDraw.sort((a, b) => Number(a.active) - Number(b.active));
    for (const rr of roomsToDraw) {
      const r = doc.rooms[rr.key];
      if (!r) continue;
      c.save();
      c.translate(this.roomScreenRect(rr.cx, rr.cy).x, this.roomScreenRect(rr.cx, rr.cy).y);
      c.globalAlpha = rr.active ? 1 : 0.34;
      this.drawTiles(c, r.map);
      c.globalAlpha = rr.active ? 1 : 0.3;
      this.drawLights(c, r.lights ?? []);
      this.drawEdgeBadges(c, doc, rr.key);
      r.objects.forEach((o, i) => {
        const picked = rr.active && (i === ui.selection || ui.multiSel.has(`${rr.key}#${i}`));
        this.drawObj(c, o, picked, t, i, { doc, roomId: rr.key });
      });
      this.drawSpawn(c, doc, rr.key);
      if (rr.active) {
        c.globalAlpha = 1;
        this.drawGrid(c);
      }
      c.restore();
    }
    if (!roomsToDraw.some((r2) => r2.active)) return;

    // ---- 覆盖层：房间边框 + 本房的 hover/rect/ghost（都在该房间的 translate 内画）----
    for (const rr of roomsToDraw) {
      const p0 = this.roomScreenRect(rr.cx, rr.cy);
      c.save();
      c.translate(p0.x, p0.y);
      c.strokeStyle = rr.active ? "rgba(127,212,160,0.85)" : "rgba(255,255,255,0.16)";
      c.lineWidth = rr.active ? 1.5 : 1;
      c.strokeRect(0.5, 0.5, ROOM_COLS * this.ts - 1, ROOM_ROWS * this.ts - 1);

      const isHoverRoom = ui.hover != null && ui.hoverKey === rr.key;
      // hover 高亮：当前房间亮白框，其他房间暗一点（跨房也能看出落在哪格）
      if (isHoverRoom) {
        const p = this.px(ui.hover!.x, ui.hover!.y);
        c.strokeStyle = rr.active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)";
        c.lineWidth = 1;
        c.strokeRect(p.x + 0.5, p.y + 0.5, this.ts - 1, this.ts - 1);
      }
      if (rr.active && ui.rect) {
        const x0 = Math.min(ui.rect.x0, ui.rect.x1);
        const x1 = Math.max(ui.rect.x0, ui.rect.x1);
        const y0 = Math.min(ui.rect.y0, ui.rect.y1);
        const y1 = Math.max(ui.rect.y0, ui.rect.y1);
        const p = this.px(x0, y0);
        c.fillStyle = "rgba(127,212,160,0.16)";
        c.fillRect(p.x, p.y, (x1 - x0 + 1) * this.ts, (y1 - y0 + 1) * this.ts);
        c.strokeStyle = "rgba(127,212,160,0.7)";
        c.setLineDash([4, 3]);
        c.strokeRect(p.x + 0.5, p.y + 0.5, (x1 - x0 + 1) * this.ts - 1, (y1 - y0 + 1) * this.ts - 1);
        c.setLineDash([]);
      }
      // 框选拖拽矩形：跨房显示（虚线框+浅填充），终点格跟随鼠标
      if (rr.active && ui.marquee) {
        const x0 = Math.min(ui.marquee.x0, ui.marquee.x1);
        const x1 = Math.max(ui.marquee.x0, ui.marquee.x1);
        const y0 = Math.min(ui.marquee.y0, ui.marquee.y1);
        const y1 = Math.max(ui.marquee.y0, ui.marquee.y1);
        const p = this.px(x0, y0);
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.fillRect(p.x, p.y, (x1 - x0 + 1) * this.ts, (y1 - y0 + 1) * this.ts);
        c.strokeStyle = "rgba(255,255,255,0.75)";
        c.setLineDash([3, 2]);
        c.strokeRect(p.x + 0.5, p.y + 0.5, (x1 - x0 + 1) * this.ts - 1, (y1 - y0 + 1) * this.ts - 1);
        c.setLineDash([]);
      }
      // 放置 ghost：落到哪房画哪房（物件）；瓦片只画当前房
      if (ui.tool === "place" && isHoverRoom && ui.palSel?.kind === "obj") {
        const ghost = defaultsFor(objSpec(ui.placeType), ui.hover!.x, ui.hover!.y, {
          ...ui.placeCtx,
          roomId: rr.key,
        });
        c.globalAlpha = 0.55;
        this.drawObj(c, ghost, false, t);
        c.globalAlpha = 1;
      } else if (ui.tool === "place" && isHoverRoom && rr.active && ui.palSel?.kind === "tile") {
        const col = TILES.find((t2) => t2.ch === ui.palSel.ch)?.color ?? "#454f5e";
        const p = this.px(ui.hover!.x, ui.hover!.y);
        c.globalAlpha = 0.55;
        c.fillStyle = col;
        c.fillRect(p.x, p.y, this.ts, this.ts);
        c.globalAlpha = 1;
      }
      c.restore();
    }
  }

  // ---- 瓦片 ----

  private drawTiles(c: CanvasRenderingContext2D, map: string[]): void {
    const ts = this.ts;
    for (let y = 0; y < ROOM_ROWS; y++) {
      const row = map[y] ?? "";
      for (let x = 0; x < ROOM_COLS; x++) {
        const ch = row[x] ?? ".";
        const p = this.px(x, y);
        if (ch === "@") {
          // 黑幕：灰色半透明遮罩（无碰撞，游戏里按连通区域涂黑）
          c.fillStyle = "rgba(96,106,120,0.45)";
          c.fillRect(p.x, p.y, ts, ts);
        } else if (ch === "*") {
          c.fillStyle = "#9fd0e8";
          c.fillRect(p.x, p.y, ts, ts);
          c.fillStyle = "rgba(255,255,255,0.5)";
          c.fillRect(p.x, p.y, ts, Math.max(1, ts / 6));
        } else if (ch === "#") {
          c.fillStyle = "#3d4653";
          c.fillRect(p.x, p.y, ts, ts);
          if ((map[y - 1]?.[x] ?? ".") !== "#") {
            c.fillStyle = "rgba(255,255,255,0.10)";
            c.fillRect(p.x, p.y, ts, Math.max(1, ts / 8));
          }
          if ((row[x - 1] ?? ".") !== "#") {
            c.fillStyle = "rgba(255,255,255,0.05)";
            c.fillRect(p.x, p.y, Math.max(1, ts / 8), ts);
          }
        } else {
          c.fillStyle = "#14181f";
          c.fillRect(p.x, p.y, ts, ts);
        }
      }
    }
  }

  private drawGrid(c: CanvasRenderingContext2D): void {
    const ts = this.ts;
    const wpx = ROOM_COLS * ts;
    const hpx = ROOM_ROWS * ts;
    c.strokeStyle = "rgba(255,255,255,0.045)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= ROOM_COLS; x++) {
      const sx = x * ts + 0.5;
      c.moveTo(sx, 0);
      c.lineTo(sx, hpx);
    }
    for (let y = 0; y <= ROOM_ROWS; y++) {
      const sy = y * ts + 0.5;
      c.moveTo(0, sy);
      c.lineTo(wpx, sy);
    }
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.strokeRect(0.5, 0.5, wpx - 1, hpx - 1);
  }

  private drawLights(c: CanvasRenderingContext2D, lights: { x: number; y: number; r: number }[]): void {
    c.setLineDash([5, 4]);
    for (const l of lights) {
      const p = this.px(l.x / TILE, l.y / TILE);
      const r = (l.r / TILE) * this.ts;
      c.strokeStyle = "rgba(255,214,140,0.55)";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "rgba(255,214,140,0.85)";
      c.beginPath();
      c.arc(p.x, p.y, 3, 0, Math.PI * 2);
      c.fill();
    }
    c.setLineDash([]);
  }

  /** 边缘洞口标记：绿=贯通到邻房洞口，灰=被邻房岩壁封住（等于墙，合法），红=无邻房（会漏出世界）。 */
  private drawEdgeBadges(c: CanvasRenderingContext2D, doc: EditorDoc, key: string): void {
    const room = doc.rooms[key];
    if (!room) return;
    const ts = this.ts;
    const wpx = ROOM_COLS * ts;
    const hpx = ROOM_ROWS * ts;
    const sides: [string, number, number][] = [
      ["left", -1, 0],
      ["right", 1, 0],
      ["top", 0, -1],
      ["bottom", 0, 1],
    ];
    for (const [side, dx, dy] of sides) {
      const nb = doc.roomAt(doc.curMap(), room.x + dx, room.y + dy);
      const mine = doc.openings(room.map, side as "left" | "right" | "top" | "bottom");
      const theirs = nb
        ? doc.openings(nb.map, side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top")
        : null;
      for (const i of mine) {
        const ok = theirs ? theirs.includes(i) : false;
        c.fillStyle = !nb ? "rgba(224,90,90,0.95)" : ok ? "rgba(70,212,122,0.9)" : "rgba(120,132,148,0.8)";
        if (side === "left") c.fillRect(-3, i * ts, 3, ts);
        else if (side === "right") c.fillRect(wpx, i * ts, 3, ts);
        else if (side === "top") c.fillRect(i * ts, -3, ts, 3);
        else c.fillRect(i * ts, hpx, ts, 3);
      }
    }
  }

  private drawSpawn(c: CanvasRenderingContext2D, doc: EditorDoc, key: string): void {
    const sp = doc.spawn();
    if (sp.room !== key) return;
    const p = this.px(sp.x / TILE, sp.y / TILE);
    c.fillStyle = "rgba(70,212,122,0.9)";
    c.beginPath();
    c.arc(p.x, p.y, this.ts * 0.3, 0, Math.PI * 2);
    c.fill();
    this.tag(c, p.x + this.ts * 0.4, p.y + 4, "出生点", "#8fe0a8");
  }

  // ---- 物件 ----

  private drawObj(
    c: CanvasRenderingContext2D,
    o: ObjRec,
    selected: boolean,
    t: number,
    index?: number,
    ctx?: { doc: EditorDoc; roomId: string },
  ): void {
    const fp = footprint(o);
    const p = this.px(fp.x, fp.y);
    const w = fp.w * this.ts;
    const h = fp.h * this.ts;
    const ts = this.ts;
    const spec = objSpec(o.type);
    c.save();
    // 缩放预览：围绕 footprint 中心变换（游戏侧锚点为实体 x,y，视觉语义一致）
    const sk = num(o, "scale", 1);
    if (sk !== 1) {
      const cx0 = p.x + w / 2;
      const cy0 = p.y + h / 2;
      c.translate(cx0, cy0);
      c.scale(sk, sk);
      c.translate(-cx0, -cy0);
    }
    switch (o.type) {
      case "door": {
        const m = matOf("door");
        c.fillStyle = `rgba(${shade(m.base, 0.5).slice(1).match(/../g)!.map((h) => parseInt(h, 16)).join(",")},0.25)`;
        c.fillRect(p.x, p.y, w, h);
        c.strokeStyle = m.base;
        c.lineWidth = 1.5;
        c.strokeRect(p.x + 0.75, p.y + 0.75, w - 1.5, h - 1.5);
        c.beginPath();
        for (let i = -Math.ceil(h / 6); i * 6 < w; i++) {
          c.moveTo(p.x + i * 6, p.y + h);
          c.lineTo(p.x + i * 6 + h, p.y);
        }
        c.globalAlpha = 0.4;
        c.stroke();
        c.globalAlpha = 1;
        c.fillStyle = m.accent;
        for (let i = 3; i < w - 2; i += 7) {
          c.fillRect(p.x + i, p.y + ((i * 7) % Math.max(1, h - 2)) + 1, 2, 2);
        }
        // 脆弱侧：暗色缺口带
        if (o.fragile) {
          c.fillStyle = "rgba(200,180,120,0.5)";
          if (o.fragile === "right") c.fillRect(p.x + w - 3, p.y, 3, h);
          else c.fillRect(p.x, p.y, 3, h);
        }
        // 收缩方向：v=向下箭头，h=朝近侧墙箭头
        c.strokeStyle = "rgba(255,255,255,0.6)";
        c.lineWidth = 1;
        c.beginPath();
        const midX = p.x + w / 2;
        if ((o.dir ?? "v") === "v") {
          c.moveTo(midX, p.y + h * 0.35);
          c.lineTo(midX, p.y + h * 0.8);
          c.lineTo(midX - 3, p.y + h * 0.8 - 3);
          c.moveTo(midX, p.y + h * 0.8);
          c.lineTo(midX + 3, p.y + h * 0.8 - 3);
        } else {
          // 横收门：与游戏同规则——门体中心在右半场就缩向右侧
          const toRight = p.x + w / 2 >= (ROOM_COLS * TILE) / 2;
          const dir = toRight ? 1 : -1;
          const tip = dir > 0 ? p.x + w * 0.7 : p.x + w * 0.3;
          const tail = dir > 0 ? p.x + w * 0.3 : p.x + w * 0.7;
          c.moveTo(tail, p.y + h / 2);
          c.lineTo(tip - dir * 3, p.y + h / 2);
          c.lineTo(tip - dir * 3, p.y + h / 2 - 3);
          c.moveTo(tip - dir * 3, p.y + h / 2);
          c.lineTo(tip - dir * 3, p.y + h / 2 + 3);
        }
        c.stroke();
        this.tag(c, p.x + 2, p.y - 3, `${o.id ?? "?"}${o.fragile ? ` · 脆:${o.fragile === "right" ? "右" : "左"}` : ""}${o.dir ? ` · ${o.dir === "h" ? "横收" : "沉地"}` : ""}`);
        break;
      }
      case "plate": {
        const pm = matOf("plate");
        c.fillStyle = pm.base;
        c.fillRect(p.x + 1, p.y + ts * 0.72, w - 2, ts * 0.22);
        c.fillStyle = pm.accent;
        c.fillRect(p.x + 2, p.y + ts * 0.6, w - 4, ts * 0.12);
        {
          const cs = Array.isArray(o.controls) ? (o.controls as string[]).filter((x) => typeof x === "string") : [];
          if (cs.length) this.tag(c, p.x + w + 3, p.y + ts, `→ ${cs.join(" ")}${num(o, "reset") > 0 ? ` (${num(o, "reset")}s)` : ""}`);
        }
        break;
      }
      case "tree": {
        // 位置=树根：fp 底边即根，树干从根向上、冠在顶
        c.fillStyle = "#7a5b3a";
        c.fillRect(p.x + ts * 0.38, p.y + ts * 0.2, ts * 0.24, h - ts * 0.2);
        c.fillStyle = "#3a2d1c";
        c.fillRect(p.x + ts * 0.3, h + p.y - ts * 0.22, ts * 0.4, ts * 0.12);
        const tm = matOf("tree");
        c.fillStyle = shade(tm.base, 1.5);
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.35, ts * 0.85, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = tm.base;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.45, ts * 0.75, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = tm.accent;
        c.beginPath();
        c.arc(p.x + ts * 0.24, p.y + ts * 0.18, ts * 0.28, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "vinebud": {
        const vb = matOf("vinebud");
        c.strokeStyle = vb.base;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.x + ts * 0.5, p.y);
        c.lineTo(p.x + ts * 0.5, p.y + h);
        c.stroke();
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i < fp.h; i++) {
          const yy = p.y + i * ts + ts * 0.5;
          c.moveTo(p.x + ts * 0.5, yy);
          c.lineTo(p.x + ts * 0.15, yy - ts * 0.3);
          c.moveTo(p.x + ts * 0.5, yy);
          c.lineTo(p.x + ts * 0.85, yy - ts * 0.3);
        }
        c.stroke();
        c.fillStyle = vb.accent;
        for (let i = 1; i < fp.h; i += 2) c.fillRect(p.x + ts * 0.62, p.y + i * ts, 2, 2);
        break;
      }
      case "bud": {
        const bm = matOf("bud");
        c.strokeStyle = "#7c5a4a";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(p.x + ts * 0.5, p.y + ts);
        c.lineTo(p.x + ts * 0.5, p.y + ts * 0.45);
        c.stroke();
        c.fillStyle = bm.base;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.35, ts * 0.32, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = bm.accent;
        c.beginPath();
        c.arc(p.x + ts * 0.42, p.y + ts * 0.27, ts * 0.1, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "spores": {
        const sm = matOf("spores");
        c.fillStyle = hexA(sm.base, 0.18);
        c.fillRect(p.x, p.y, w, h);
        c.strokeStyle = sm.base;
        c.setLineDash([4, 3]);
        c.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);
        c.setLineDash([]);
        c.fillStyle = hexA(sm.accent, 0.8);
        for (let i = 0; i < fp.w * fp.h; i++) {
          const sx = p.x + ((i * 37) % Math.max(1, w - 4)) + 2;
          const sy = p.y + ((i * 53) % Math.max(1, h - 4)) + 2;
          c.fillRect(sx, sy, 2, 2);
        }
        break;
      }
      case "wisp": {
        const wm = matOf("wisp");
        const pulse = 0.75 + 0.25 * Math.sin(t / 300 + fp.x);
        c.strokeStyle = wm.base;
        c.globalAlpha = pulse;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.5, ts * 0.42, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = wm.accent;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.5, ts * 0.16, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        break;
      }
      case "savepoint": {
        const sm = matOf("savepoint");
        const sx = p.x + ts * 0.5;
        const sy = p.y + ts * 0.55;
        // 石座 + 茎
        c.fillStyle = "rgba(44,58,66,0.9)";
        c.fillRect(sx - ts * 0.3, sy + ts * 0.18, ts * 0.6, ts * 0.16);
        c.strokeStyle = sm.base;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(sx, sy + ts * 0.18);
        c.lineTo(sx, sy - ts * 0.1);
        c.stroke();
        // 五瓣呼吸花（编辑器里常开示意激活形态）
        const bloom = 0.7 + 0.3 * Math.sin(t / 400);
        c.fillStyle = sm.base;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          c.beginPath();
          c.arc(sx + Math.cos(a) * ts * 0.17 * bloom, sy - ts * 0.18 + Math.sin(a) * ts * 0.17 * bloom, ts * 0.09, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = sm.accent;
        c.beginPath();
        c.arc(sx, sy - ts * 0.18, ts * 0.08, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "ledge": {
        const lm = matOf("ledge");
        c.fillStyle = lm.base;
        c.fillRect(p.x, p.y + ts * 0.7, w, ts * 0.3);
        c.fillStyle = lm.accent;
        c.fillRect(p.x, p.y + ts * 0.7, w, ts * 0.1);
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.lineWidth = 1;
        for (let i = 0; i < fp.w; i++) {
          const xx = p.x + i * ts + ts * 0.5;
          c.beginPath();
          c.moveTo(xx - 3, p.y + ts * 0.55);
          c.lineTo(xx, p.y + ts * 0.35);
          c.lineTo(xx + 3, p.y + ts * 0.55);
          c.stroke();
        }
        break;
      }
      case "flower": {
        const fm = matOf("flower");
        c.fillStyle = fm.base;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + t / 4000;
          c.beginPath();
          c.arc(p.x + ts * 0.5 + Math.cos(a) * ts * 0.3, p.y + ts * 0.4 + Math.sin(a) * ts * 0.3, ts * 0.22, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = fm.accent;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.4, ts * 0.18, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "vine": {
        // 逐根可视化：lens 条数=根数，0/-1=随机（虚线+中值实长的半透明）
        const vm = matOf("vine");
        const lensArr = Array.isArray(o.lens) ? (o.lens as unknown[]).filter((v): v is number => typeof v === "number") : null;
        const hMaxT = num(o, "h", 3);
        const hMinT = num(o, "hMin", Math.max(1, Math.round(hMaxT * 0.55)));
        const strands = lensArr && lensArr.length ? lensArr : [-1, -1];
        const n = Math.min(6, strands.length);
        // 锚杆
        c.fillStyle = "#0c100c";
        c.fillRect(p.x - 1, p.y - 1, 2 * ts + 2, 2);
        c.fillStyle = vm.accent;
        c.fillRect(p.x, p.y, 2 * ts, 1);
        c.lineWidth = 1.5;
        for (let i = 0; i < n; i++) {
          const v = strands[i] ?? -1;
          const rand = v <= 0;
          const tilesLen = rand
            ? hMinT + (hMaxT - hMinT) / 2
            : Math.max(1, v); // lens 显式值即实际长度（可超过上限 h）
          const lenPx = Math.max(ts * 0.6, tilesLen * ts);
          const sx = p.x + (n === 1 ? ts : 2 + (i / (n - 1)) * (2 * ts - 4));
          c.strokeStyle = vm.base;
          if (rand) c.setLineDash([3, 2]);
          c.beginPath();
          c.moveTo(sx, p.y);
          c.lineTo(sx, p.y + lenPx);
          c.stroke();
          c.setLineDash([]);
          // 尖端：随机=空心圈（示"未定"），显式=实心点
          if (rand) {
            c.strokeStyle = vm.accent;
            c.beginPath();
            c.arc(sx, p.y + lenPx + 1, 1.8, 0, Math.PI * 2);
            c.stroke();
          } else {
            c.fillStyle = vm.accent;
            c.fillRect(sx - 1, p.y + lenPx, 2, 2);
          }
        }
        // 长度范围标尺（右侧）：min~max
        c.strokeStyle = "rgba(255,255,255,0.3)";
        c.setLineDash([2, 2]);
        c.beginPath();
        c.moveTo(p.x + 2 * ts + 2, p.y + hMinT * ts);
        c.lineTo(p.x + 2 * ts + 2, p.y + hMaxT * ts);
        c.stroke();
        c.setLineDash([]);
        break;
      }
      case "shroom": {
        const hm = matOf("shroom");
        c.fillStyle = "#d8cfc0";
        c.fillRect(p.x + ts * 0.35, p.y + ts * 0.55, ts * 0.3, ts * 0.45);
        c.fillStyle = hm.base;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.62, ts * 0.48, Math.PI, 0);
        c.fill();
        c.fillStyle = hm.accent;
        c.beginPath();
        c.arc(p.x + ts * 0.38, p.y + ts * 0.42, ts * 0.1, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case "ring": {
        const rm = matOf("ring");
        c.strokeStyle = rm.base;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.5, ts * 0.34, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = rm.accent;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(p.x + ts * 0.5, p.y + ts * 0.5, ts * 0.34, -0.6, 0.6);
        c.stroke();
        c.fillStyle = rm.accent;
        c.fillRect(p.x + ts * 0.5 - 1, p.y - ts * 0.15, 2, ts * 0.3);
        break;
      }
      case "seed": {
        c.fillStyle = matOf("seed").base;
        const cx0 = p.x + ts * 0.5;
        const cy0 = p.y + ts * 0.5;
        c.beginPath();
        c.moveTo(cx0, cy0 - ts * 0.38);
        c.lineTo(cx0 + ts * 0.12, cy0 - ts * 0.12);
        c.lineTo(cx0 + ts * 0.38, cy0);
        c.lineTo(cx0 + ts * 0.12, cy0 + ts * 0.12);
        c.lineTo(cx0, cy0 + ts * 0.38);
        c.lineTo(cx0 - ts * 0.12, cy0 + ts * 0.12);
        c.lineTo(cx0 - ts * 0.38, cy0);
        c.lineTo(cx0 - ts * 0.12, cy0 - ts * 0.12);
        c.closePath();
        c.fill();
        this.tag(c, p.x + 2, p.y - 3, `种${o.id ?? "?"}`, spec.color);
        break;
      }
      case "item": {
        const cx0 = p.x + ts * 0.5;
        const cy0 = p.y + ts * 0.5;
        if (num(o, "r") > 0) {
          c.strokeStyle = "rgba(255,255,255,0.3)";
          c.setLineDash([2, 2]);
          c.lineWidth = 1;
          c.beginPath();
          c.arc(cx0, cy0, (num(o, "r") / 10) * ts, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
        }
        c.fillStyle = spec.color;
        c.beginPath();
        c.moveTo(cx0, cy0 - ts * 0.36);
        c.lineTo(cx0 + ts * 0.32, cy0);
        c.lineTo(cx0, cy0 + ts * 0.36);
        c.lineTo(cx0 - ts * 0.32, cy0);
        c.closePath();
        c.fill();
        c.fillStyle = "#2a2016";
        c.font = `bold ${Math.max(8, ts * 0.42)}px ui-monospace, monospace`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        const letter = { whip: "W", bubble: "B", flute: "F", bean: "L" }[String(o.item)] ?? "?";
        c.fillText(letter, cx0, cy0 + 1);
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
        break;
      }
      case "spike": {
        c.fillStyle = "#c05555";
        for (let i = 0; i < fp.w; i++) {
          for (let k = 0; k < 3; k++) {
            const sx = p.x + i * ts + k * (ts / 3) + 1;
            c.beginPath();
            c.moveTo(sx - 1.5, p.y + ts);
            c.lineTo(sx, p.y + ts * 0.35);
            c.lineTo(sx + 1.5, p.y + ts);
            c.closePath();
            c.fill();
          }
        }
        break;
      }
      case "elevator": {
        const em = matOf("lilypad");
        // 笼身 1×2 + 笼口
        c.fillStyle = shade(em.base, 0.55);
        c.fillRect(p.x + ts * 0.15, p.y + ts * 0.9, ts * 0.7, ts * 0.95);
        c.fillStyle = em.base;
        c.fillRect(p.x + ts * 0.22, p.y + ts * 0.95, ts * 0.56, ts * 0.85);
        c.fillStyle = shade(em.base, 1.35);
        c.fillRect(p.x + ts * 0.15, p.y + ts * 0.8, ts * 0.7, ts * 0.22);
        c.fillStyle = "#1a2416";
        c.fillRect(p.x + ts * 0.25, p.y + ts * 0.85, ts * 0.5, ts * 0.12);
        c.fillStyle = em.accent;
        c.fillRect(p.x + ts * 0.3, p.y + ts * 0.62 + Math.sin(t / 300) * 1.5, ts * 0.4, ts * 0.14);
        // 行程虚线：起点笼口 → 终点笼口（终点改动实时跟随）。
        // 跨房：end.room_id 定位目标房网格，虚线越过房间边界画进邻房（世界直线，画布不裁剪）
        const endPos = objPos(o, "end");
        let exRel = endPos.x - fp.x;
        let eyRel = endPos.y - fp.y;
        if (ctx) {
          const target = ctx.doc.rooms[endPos.room_id];
          const home = ctx.doc.rooms[ctx.roomId];
          if (target && home) {
            exRel += (target.x - home.x) * ROOM_COLS;
            eyRel += (target.y - home.y) * ROOM_ROWS;
          }
        }
        const ep = { x: p.x + exRel * ts, y: p.y + eyRel * ts };
        c.strokeStyle = "rgba(255,255,255,0.45)";
        c.setLineDash([3, 3]);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(p.x + ts / 2, p.y + ts * 2);
        c.lineTo(ep.x + ts / 2, ep.y + ts * 2);
        c.stroke();
        c.setLineDash([]);
        // 终点落位框：笼口对齐 end 格（笼身 1×2 向下），与起点笼同一姿态
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.strokeRect(ep.x + 0.5, ep.y + 0.5, ts - 1, ts * 2 - 1);
        const tags = [
          `⚡ ${String(o.id ?? "")}`,
          `${num(o, "speed", 40)}px/s`,
          endPos.room_id && endPos.room_id !== objPos(o).room_id ? `→ ${endPos.room_id}` : "",
        ].filter((x) => x.length > 2);
        this.tag(c, p.x + ts + 4, p.y + ts, tags.join(" "));
        break;
      }
      case "switch": {
        const m = matOf("switch");
        c.fillStyle = "#2a3238";
        c.fillRect(p.x + ts * 0.2, p.y + ts * 0.82, ts * 0.6, ts * 0.16);
        c.fillStyle = "#6a625a";
        c.fillRect(p.x + ts * 0.44, p.y + ts * 0.5, ts * 0.12, ts * 0.34);
        c.fillStyle = m.base;
        c.fillRect(p.x + ts * 0.4, p.y + ts * 0.22, ts * 0.2, ts * 0.3);
        c.fillStyle = m.accent;
        c.fillRect(p.x + ts * 0.44, p.y + ts * 0.26, ts * 0.08, ts * 0.1);
        {
          const cs = Array.isArray(o.controls) ? (o.controls as string[]).filter((x) => typeof x === "string") : [];
          if (cs.length) this.tag(c, p.x + ts + 3, p.y + ts, `→ ${cs.join(" ")}${num(o, "reset") > 0 ? ` (${num(o, "reset")}s)` : ""}`);
        }
        break;
      }
      case "crumble": {
        // 一格一荚：轻微错落的独立泡荚，提示"逐格独立碎"
        const cm = matOf("crumble");
        for (let i = 0; i < fp.w; i++) {
          const cx0 = p.x + i * ts + ts / 2;
          const jy = ((i * 37) % 3) - 1;
          c.fillStyle = cm.base;
          c.beginPath();
          c.arc(cx0, p.y + ts * 0.5 + jy * 0.8, ts * 0.34, Math.PI, 0);
          c.closePath();
          c.fill();
          c.fillRect(cx0 - ts * 0.34, p.y + ts * 0.44 + jy * 0.8, ts * 0.68, 2);
          c.fillStyle = cm.accent;
          c.fillRect(cx0 - 2, p.y + ts * 0.24 + jy * 0.8, 4, 1);
          c.fillRect(cx0 + 2, p.y + ts * 0.4 + jy * 0.8, 1, 1);
        }
        break;
      }
      case "lilypad": {
        const lm = matOf("lilypad");
        const mode = String(o.mode ?? "patrol");
        // 叶盘
        c.fillStyle = lm.base;
        c.beginPath();
        c.ellipse(p.x + w / 2, p.y + ts * 0.4, w / 2 - 1, ts * 0.3, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = lm.accent;
        c.fillRect(p.x + 2, p.y + ts * 0.24, w - 4, 1);
        c.beginPath();
        c.arc(p.x + w / 2, p.y + ts * 0.42, 1.5, 0, Math.PI * 2);
        c.fill();
        // 运动提示：起点 → 终点的虚线 + 终点落位框（终点改动实时跟随）
        const endPos = objPos(o, "end");
        const tx = p.x + (endPos.x - fp.x) * ts;
        const ty = p.y + (endPos.y - fp.y) * ts;
        c.strokeStyle = "rgba(255,255,255,0.5)";
        c.setLineDash([3, 3]);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(p.x + w / 2, p.y + ts * 0.4);
        c.lineTo(tx + w / 2, ty + ts * 0.4);
        c.stroke();
        c.setLineDash([]);
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.strokeRect(tx + 0.5, ty + 0.5, w - 1, ts - 1);
        if (mode === "switch") this.tag(c, tx + 2, ty - 3, `⚡ ${String(o.id ?? "?")}`);
        c.setLineDash([]);
        break;
      }
      case "prop": {
        const pd = propByIdDoc(String(o.id ?? "")) as PropDef | undefined;
        if (pd) {
          drawPropShape(c, pd, { x: p.x, y: p.y, w: fp.w * ts, h: fp.h * ts }, t / 1000);
        } else {
          c.strokeStyle = "#e05a5a";
          c.setLineDash([3, 2]);
          c.strokeRect(p.x + 1, p.y + 1, w - 2, h - 2);
          c.setLineDash([]);
          this.tag(c, p.x + 2, p.y - 3, `未知 prop: ${o.id ?? "?"}`, "#ff8a8a");
        }
        break;
      }
      default: {
        c.strokeStyle = spec.color;
        c.setLineDash([3, 3]);
        c.strokeRect(p.x + 2, p.y + 2, w - 4, h - 4);
        c.setLineDash([]);
      }
    }
    // 缩放随机幅度：外圈虚线示最小/最大可能尺寸
    const jit = num(o, "scaleJit", 0);
    if (jit > 0) {
      const cx0 = p.x + w / 2;
      const cy0 = p.y + h / 2;
      c.strokeStyle = "rgba(255,255,255,0.28)";
      c.lineWidth = 1;
      c.setLineDash([2, 3]);
      for (const f of [1 - jit, 1 + jit]) {
        const ww = w * sk * f;
        const hh = h * sk * f;
        c.strokeRect(cx0 - ww / 2, cy0 - hh / 2, ww, hh);
      }
      c.setLineDash([]);
    }
    if (selected) {
      c.strokeStyle = "#ffffff";
      c.lineWidth = 1;
      c.setLineDash([3, 2]);
      const ww = w * sk;
      const hh = h * sk;
      const cx0 = p.x + w / 2;
      const cy0 = p.y + h / 2;
      c.strokeRect(cx0 - ww / 2 - 2.5, cy0 - hh / 2 - 2.5, ww + 5, hh + 5);
      c.setLineDash([]);
      this.tag(c, p.x + w + 4, p.y + 4, index != null ? `${spec.label} #${index}` : spec.label, "#ffffff");
    }
    c.restore();
  }

  private tag(c: CanvasRenderingContext2D, px: number, py: number, text: string, color = "#dfe6ee"): void {
    if (!text) return;
    c.font = "10px ui-monospace, monospace";
    const tw = c.measureText(text).width;
    c.fillStyle = "rgba(8,10,14,0.78)";
    c.fillRect(px, py - 9, tw + 4, 12);
    c.fillStyle = color;
    c.fillText(text, px + 2, py + 1);
  }
}
