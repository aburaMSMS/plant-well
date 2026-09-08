// 房间装饰层：视差背景、草簇、根须、裂缝、背景植物、环境粒子、雾与天光。
// 全部由房间键做种子的确定性生成——同一房间每次进入长得一模一样，
// 但运行时的摆动/粒子用真实随机，保持活性。
// 装饰不参与碰撞：几何与机关仍完全由瓦片和实体决定。
import { TILE, ROOM_W, ROOM_H } from "./constants";
import { Tile, Tilemap } from "../engine/tiles";
import type { Light } from "../engine/light";
import type { Particles } from "../engine/particles";
import { ROOMS } from "../data/maps";

export interface Palette {
  bgBase: string;
  bgTop: string;
  rock: [string, string, string];
  rockDeep: string;
  rockEdge: string;
  lip: string; // 可站立岩沿：矿物质浅边，和装饰草分开
  wet: string;
  moss: string;
  grass: string;
  grassDim: string;
  root: string;
  flora: string;
  floraGlow: string;
  spore: string;
  bgFar: string;
  bgMid: string;
  bgNear: string;
  fog: string;
  glow: string; // "r,g,b" for additive lights
  dark: string; // "r,g,b" for darkness overlay
  shaft: string;
  spike: string;
  spikeBase: string;
  grade: string;
}

// 三个深度生物群系：上层苔井 → 中层菌廊 → 深层幽底。
// 视觉分层：碰撞岩=不透明矿石 + 浅色沿；装饰植被=暗、半透明、无高光。
export const PALETTES: Palette[] = [
  {
    bgBase: "#050b08",
    bgTop: "#0a140e",
    rock: ["#4a5450", "#3e4642", "#5a645c"],
    rockDeep: "#202624",
    rockEdge: "#6e7a70",
    lip: "#a4b0a2",
    wet: "#3a423c",
    moss: "#3a5828",
    grass: "#47682f",
    grassDim: "#2c451f",
    root: "#2a2418",
    flora: "#466130",
    floraGlow: "#547238",
    spore: "#2e3e30",
    bgFar: "#04070a",
    bgMid: "#081009",
    bgNear: "#0e1710",
    fog: "16,28,20",
    glow: "70,100,55",
    dark: "12,18,15",
    shaft: "70,95,65",
    spike: "#c6bfb1",
    spikeBase: "#585046",
    grade: "6,12,8",
  },
  {
    bgBase: "#050c10",
    bgTop: "#0c1a24",
    rock: ["#405460", "#354650", "#4e646e"],
    rockDeep: "#1c262c",
    rockEdge: "#627884",
    lip: "#92aab4",
    wet: "#2a3a40",
    moss: "#265248",
    grass: "#2e5c52",
    grassDim: "#1f423a",
    root: "#1e2a26",
    flora: "#32645c",
    floraGlow: "#3c746c",
    spore: "#243e3c",
    bgFar: "#04080b",
    bgMid: "#071219",
    bgNear: "#0c1d25",
    fog: "12,32,40",
    glow: "40,110,120",
    dark: "10,20,26",
    shaft: "50,100,110",
    spike: "#b4cad1",
    spikeBase: "#485960",
    grade: "4,16,22",
  },
  {
    bgBase: "#070510",
    bgTop: "#110d20",
    rock: ["#4c4686", "#403a6e", "#5852a0"],
    rockDeep: "#221e34",
    rockEdge: "#716aa8",
    lip: "#a49ec0",
    wet: "#322e44",
    moss: "#3e2c5c",
    grass: "#4a3872",
    grassDim: "#322452",
    root: "#241c30",
    flora: "#563f78",
    floraGlow: "#654c8c",
    spore: "#322848",
    bgFar: "#050410",
    bgMid: "#0e0b18",
    bgNear: "#151020",
    fog: "28,16,48",
    glow: "90,60,140",
    dark: "20,15,32",
    shaft: "80,55,120",
    spike: "#c1b8da",
    spikeBase: "#57506e",
    grade: "12,6,22",
  },
];

export function paletteFor(depth: number): Palette {
  return PALETTES[Math.max(0, Math.min(2, Math.floor(depth * 3)))];
}

/** 第四深度层（depth=1，井底档）— 全局光照亮度基准，不随房间深浅变化。 */
export const GLOBAL_LIGHT_DEPTH = 1;

function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "r,g,b" 或 "#rrggbb" → rgba() 可用的 rgb 分量串。 */
function rgbParts(color: string): string {
  if (color.includes(",")) return color;
  const h = color.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

interface Tuft {
  x: number;
  y: number;
  h: number;
  ph: number;
  dim: boolean;
  blades: number;
  swayT: number;
}
interface Sprout {
  x: number;
  y: number;
  h: number;
  ph: number;
  curl: number;
  kind: number;
}
interface Bush {
  x: number;
  y: number;
  n: number;
  h: number;
  ph: number;
  swayT: number;
}
interface Root {
  x: number;
  y: number;
  len: number;
  ph: number;
  thick: boolean;
}
interface Crack {
  pts: [number, number][];
}
interface Flora {
  x: number;
  y: number;
  kind: number;
  s: number;
  ph: number;
}
interface MossPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  side: -1 | 1 | 0; // -1 left face, 1 right, 0 top
}
interface Lichen {
  x: number;
  y: number;
  glow: boolean;
}
interface ShelfFungus {
  x: number;
  y: number;
  w: number;
  ph: number;
}
interface HangMoss {
  x: number;
  y: number;
  len: number;
  ph: number;
  n: number;
}
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  ph: number;
  glow: boolean;
}
interface BgLayer {
  floor: number[];
  ceil: number[];
  stal: { x: number; w: number; len: number }[];
  cols: { x: number; w: number; y: number; h: number }[];
  plants: { x: number; y: number; h: number; k: number }[];
  hangs: { x: number; w: number; len: number }[];
  specks: { x: number; y: number }[];
}

export class RoomDecor {
  readonly palette: Palette;
  readonly lights: Light[] = [];
  private grass: Tuft[] = [];
  private bushes: Bush[] = [];
  private sprouts: Sprout[] = [];
  private pebbles: { x: number; y: number; w: number }[] = [];
  private roots: Root[] = [];
  private cracks: Crack[] = [];
  private flora: Flora[] = [];
  private moss: MossPatch[] = [];
  private lichen: Lichen[] = [];
  private shelves: ShelfFungus[] = [];
  private hangMoss: HangMoss[] = [];
  private ceilingTips: { x: number; y: number }[] = [];
  private motes: Mote[] = [];
  private shafts: { x: number; w: number; h: number }[] = [];
  private bgFar: BgLayer = { floor: [], ceil: [], stal: [], cols: [], plants: [], hangs: [], specks: [] };
  private bgMid: BgLayer = { floor: [], ceil: [], stal: [], cols: [], plants: [], hangs: [], specks: [] };
  private bgNear: BgLayer = { floor: [], ceil: [], stal: [], cols: [], plants: [], hangs: [], specks: [] };
  private ambientT = 0.35;
  private dripT = 1.4;
  // 自发光点缀：发光苔藓（贴岩壁，程序生成）。萤火虫/蜡烛/晶石/吊灯等光源小物
  // 一律由编辑器以「光源类」物件摆放——场景不再凭空长出光源。
  private glowMoss: { x: number; y: number; s: number; ph: number }[] = [];
  private mossColor: string;
  private glowLayer: HTMLCanvasElement | null = null;

  constructor(key: string, tiles: Tilemap, depth: number, seamSolid?: (cx: number, cy: number) => boolean) {
    this.palette = paletteFor(depth);
    const rng = mulberry32(hashKey(key));
    const p = this.palette;

    // 苔藓色：房间数据可显式指定（moss: "#hex"），缺省按生物群系底色 + 房间种子微调
    const defMoss = ROOMS[key]?.roomColor;
    this.mossColor = defMoss ? hexToRgb(defMoss) : defaultMoss(depth, rng);

    // 暴露面判定（苔藓/草/藤都长在"朝空气的面上"）：
    // - 本房越界 → 翻邻房（缝合）：邻房贴着岩壁的面不算暴露，不长苔藓；无邻房=朝世界外，照旧算暴露
    // - 邻格是冰块（实心但非岩壁）不算暴露——草/苔藓不从冰块底下长出来
    const open = (cx: number, cy: number): boolean => {
      if (cx >= 0 && cy >= 0 && cx < 32 && cy < 18) return tiles.get(cx, cy) === Tile.Air;
      return seamSolid ? !seamSolid(cx, cy) : true;
    };

    for (let cy = 0; cy < 18; cy++) {
      for (let cx = 0; cx < 32; cx++) {
        const solid = tiles.get(cx, cy) === Tile.Solid;
        const airAbove = open(cx, cy - 1);
        const airBelow = open(cx, cy + 1);
        const airLeft = open(cx - 1, cy);
        const airRight = open(cx + 1, cy);

        if (solid && airAbove) {
          // 发光苔藓：贴岩壁顶沿，星散分布
          if (rng() < 0.15 && this.glowMoss.length < 44) {
            this.glowMoss.push({ x: cx * TILE + 1 + rng() * 7, y: cy * TILE, s: rng() < 0.3 ? 2 : 1, ph: rng() * 6.28 });
          }
          if (rng() < 0.78) {
            this.grass.push({
              x: cx * TILE + 1 + rng() * 6,
              y: cy * TILE,
              h: 2 + rng() * 5,
              ph: rng() * 6.28,
              dim: rng() < 0.35,
              blades: 2 + Math.floor(rng() * 3),
              swayT: 0,
            });
          }
          if (rng() < 0.26) {
            this.sprouts.push({
              x: cx * TILE + 1 + rng() * 7,
              y: cy * TILE,
              h: 4 + rng() * 6,
              ph: rng() * 6.28,
              curl: rng() < 0.5 ? 1 : -1,
              kind: Math.floor(rng() * 3),
            });
          }
          if (rng() < 0.3) {
            this.bushes.push({
              x: cx * TILE + 2 + rng() * 5,
              y: cy * TILE,
              n: 4 + Math.floor(rng() * 3),
              h: 5 + rng() * 5,
              ph: rng() * 6.28,
              swayT: 0,
            });
          }
          if (rng() < 0.42) {
            this.pebbles.push({ x: cx * TILE + rng() * 8, y: cy * TILE - 1, w: 1 + Math.floor(rng() * 3) });
          }
          if (rng() < 0.55) {
            this.moss.push({
              x: cx * TILE + rng() * 3,
              y: cy * TILE,
              w: 4 + rng() * 6,
              h: 1 + rng() * 2,
              side: 0,
            });
          }
        }

        if (solid && airBelow) {
          if (rng() < 0.34) {
            const len = 7 + rng() * 24;
            this.roots.push({
              x: cx * TILE + 2 + rng() * 5,
              y: (cy + 1) * TILE,
              len,
              ph: rng() * 6.28,
              thick: rng() < 0.3,
            });
            if (this.roots.length % 2 === 0) this.ceilingTips.push({ x: cx * TILE + 4, y: (cy + 1) * TILE + len });
          }
          if (rng() < 0.22) {
            this.hangMoss.push({
              x: cx * TILE + 1 + rng() * 6,
              y: (cy + 1) * TILE,
              len: 3 + rng() * 7,
              ph: rng() * 6.28,
              n: 2 + Math.floor(rng() * 2),
            });
          }
          if (rng() < 0.12) this.pushCrack(rng, cx * TILE + 2 + rng() * 5, cy * TILE + 8);
          // 顶上萤火：短半径有色光源，不改玩法
          if (rng() < 0.07 && this.lights.length < 7) {
            this.lights.push({
              x: cx * TILE + 4 + rng() * 3,
              y: (cy + 1) * TILE + 2 + rng() * 4,
              r: 4 + rng() * 2,
              tint: p.glow,
            });
          }
        }

        if (solid && airLeft) {
          if (rng() < 0.09 && this.glowMoss.length < 44) {
            this.glowMoss.push({ x: cx * TILE, y: cy * TILE + 1 + rng() * 7, s: 1, ph: rng() * 6.28 });
          }
          if (rng() < 0.28) {
            this.moss.push({
              x: cx * TILE,
              y: cy * TILE + 1 + rng() * 5,
              w: 1 + rng() * 2,
              h: 3 + rng() * 6,
              side: -1,
            });
          }
          if (rng() < 0.1) {
            this.shelves.push({
              x: cx * TILE,
              y: cy * TILE + 3 + rng() * 4,
              w: 3 + rng() * 3,
              ph: rng() * 6.28,
            });
          }
        }
        if (solid && airRight) {
          if (rng() < 0.09 && this.glowMoss.length < 44) {
            this.glowMoss.push({ x: cx * TILE + TILE - 1, y: cy * TILE + 1 + rng() * 7, s: 1, ph: rng() * 6.28 });
          }
          if (rng() < 0.28) {
            this.moss.push({
              x: cx * TILE + 8,
              y: cy * TILE + 1 + rng() * 5,
              w: 1 + rng() * 2,
              h: 3 + rng() * 6,
              side: 1,
            });
          }
          if (rng() < 0.1) {
            this.shelves.push({
              x: cx * TILE + 10,
              y: cy * TILE + 3 + rng() * 4,
              w: -(3 + rng() * 3),
              ph: rng() * 6.28,
            });
          }
        }

        if (solid && rng() < 0.14) {
          this.pushCrack(rng, cx * TILE + 2 + rng() * 5, cy * TILE + 2 + rng() * 6);
        }
        if (solid && rng() < 0.16) {
          this.lichen.push({
            x: cx * TILE + 1 + rng() * 7,
            y: cy * TILE + 1 + rng() * 7,
            glow: depth > 0.35 && rng() < 0.45,
          });
        }
      }
    }

    // 背景植物：空气格且脚下实心。深层更常发光。
    let placed = 0;
    for (let tries = 0; tries < 80 && placed < 10; tries++) {
      const cx = 1 + Math.floor(rng() * 30);
      const cy = 1 + Math.floor(rng() * 16);
      if (tiles.get(cx, cy) !== Tile.Air || tiles.get(cx, cy + 1) !== Tile.Solid) continue;
      const glow = depth > 0.28 && rng() < 0.7;
      this.flora.push({
        x: cx * TILE + 3 + rng() * 4,
        y: (cy + 1) * TILE,
        kind: Math.floor(rng() * 5),
        s: 0.75 + rng() * 0.7,
        ph: rng() * 6.28,
      });
      if (glow && this.lights.length < 8) {
        this.lights.push({
          x: cx * TILE + 5,
          y: (cy + 1) * TILE - 6,
          r: 5 + rng() * 3,
          tint: p.glow,
        });
      }
      placed++;
    }

    // 天光柱：顶行开口往下探，纯视觉体积光
    for (let cx = 0; cx < 32; cx++) {
      if (tiles.get(cx, 0) !== Tile.Air) continue;
      let h = 1;
      while (h < 12 && tiles.get(cx, h) === Tile.Air) h++;
      if (h >= 3 && rng() < 0.85) {
        this.shafts.push({ x: cx * TILE + 1, w: 6 + rng() * 5, h: h * TILE });
      }
    }

    const moteN = 12 + Math.floor(depth * 8);
    for (let i = 0; i < moteN; i++) {
      this.motes.push({
        x: rng() * ROOM_W,
        y: rng() * ROOM_H,
        vx: (rng() - 0.5) * 5,
        vy: -1.2 - rng() * 3.5,
        s: rng() < 0.25 ? 2 : 1,
        ph: rng() * 6.28,
        glow: rng() < 0.35 + depth * 0.3,
      });
    }

    this.seedLayer(this.bgFar, rng, 16, 30, 8, 4, 10, 4, 22);
    this.seedLayer(this.bgMid, rng, 10, 22, 6, 5, 12, 5, 16);
    this.seedLayer(this.bgNear, rng, 6, 16, 5, 4, 9, 4, 12);

    // 发光苔藓描边层：每一段岩壁暴露边缘逐像素烘焙（一次性），运行时整图 lighter 叠加
    const layer = document.createElement("canvas");
    layer.width = ROOM_W;
    layer.height = ROOM_H;
    const gc = layer.getContext("2d")!;
    for (let cy = 0; cy < 18; cy++) {
      for (let cx = 0; cx < 32; cx++) {
        if (tiles.get(cx, cy) !== Tile.Solid) continue;
        const pts: [number, number, number, number][] = []; // x, y, 外法线 dx, dy
        if (tiles.get(cx, cy - 1) !== Tile.Solid) for (let i = 0; i < TILE; i++) pts.push([cx * TILE + i, cy * TILE, 0, -1]);
        if (tiles.get(cx, cy + 1) !== Tile.Solid) for (let i = 0; i < TILE; i++) pts.push([cx * TILE + i, cy * TILE + TILE - 1, 0, 1]);
        if (tiles.get(cx - 1, cy) !== Tile.Solid) for (let i = 0; i < TILE; i++) pts.push([cx * TILE, cy * TILE + i, -1, 0]);
        if (tiles.get(cx + 1, cy) !== Tile.Solid) for (let i = 0; i < TILE; i++) pts.push([cx * TILE + TILE - 1, cy * TILE + i, 1, 0]);
        for (const [ex, ey, nx, ny] of pts) {
          const h = (((ex * 73856093) ^ (ey * 19349663)) >>> 0) % 100;
          gc.fillStyle = `rgba(${this.mossColor},${(0.22 + h * 0.0034).toFixed(3)})`; // 0.22~0.56 逐像素微差
          gc.fillRect(ex, ey, 1, 1);
          gc.fillStyle = `rgba(${this.mossColor},0.05)`;
          gc.fillRect(ex + nx, ey + ny, 1, 1); // 只向空气侧晕 1px（不往岩里糊）
        }
      }
    }
    this.glowLayer = layer;

  }

  private seedLayer(
    layer: BgLayer,
    rng: () => number,
    base: number,
    amp: number,
    stalN: number,
    colN: number,
    plantN: number,
    hangN: number,
    speckN: number,
  ): void {
    for (let i = 0; i <= 12; i++) {
      layer.floor.push(ROOM_H - base - rng() * amp);
      layer.ceil.push(8 + rng() * (amp * 0.55));
    }
    for (let i = 0; i < stalN; i++) {
      layer.stal.push({ x: -50 + rng() * (ROOM_W + 100), w: 5 + rng() * 16, len: 10 + rng() * 32 });
    }
    for (let i = 0; i < colN; i++) {
      const h = 36 + rng() * 90;
      layer.cols.push({
        x: -30 + rng() * (ROOM_W + 60),
        w: 10 + rng() * 22,
        y: ROOM_H - h + rng() * 20,
        h,
      });
    }
    for (let i = 0; i < plantN; i++) {
      layer.plants.push({
        x: rng() * ROOM_W,
        y: ROOM_H - 16 - rng() * 70,
        h: 12 + rng() * 28,
        k: Math.floor(rng() * 3),
      });
    }
    for (let i = 0; i < hangN; i++) {
      layer.hangs.push({
        x: rng() * ROOM_W,
        w: 4 + rng() * 14,
        len: 18 + rng() * 50,
      });
    }
    for (let i = 0; i < speckN; i++) {
      layer.specks.push({ x: rng() * ROOM_W, y: 16 + rng() * (ROOM_H - 32) });
    }
  }

  private pushCrack(rng: () => number, x: number, y: number): void {
    const pts: [number, number][] = [[x, y]];
    let cx = x;
    let cy = y;
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      cx += (rng() - 0.5) * 7;
      cy += 2 + rng() * 3.5;
      pts.push([cx, cy]);
    }
    this.cracks.push({ pts });
  }

  /** 环境粒子 + 植被摇摆。px/py 是玩家坐标（房间局部系）：路过惊动草丛/灌木。 */
  update(dt: number, particles: Particles, px = -999, py = -999): void {
    const p = this.palette;
    const wake = (x: number, baseY: number, plant: { swayT: number }) => {
      if (Math.abs(x - px) < 9 && Math.abs(py + 4 - baseY) < 8) plant.swayT = 0.55;
      plant.swayT = Math.max(0, plant.swayT - dt);
    };
    for (const g of this.grass) wake(g.x, g.y, g);
    for (const b of this.bushes) wake(b.x + 4, b.y, b);
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -6) {
        m.y = ROOM_H + 4;
        m.x = Math.random() * ROOM_W;
      }
      if (m.x < -6) m.x = ROOM_W + 4;
      if (m.x > ROOM_W + 6) m.x = -4;
    }
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 0.22 + Math.random() * 0.5;
      const m = this.motes[Math.floor(Math.random() * this.motes.length)];
      particles.spawn({
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy * 0.6,
        life: 2.4,
        size: m.s,
        color: m.glow ? p.floraGlow : p.spore,
      });
    }
    this.dripT -= dt;
    if (this.dripT <= 0 && this.ceilingTips.length > 0) {
      this.dripT = 1.1 + Math.random() * 3.2;
      const tip = this.ceilingTips[Math.floor(Math.random() * this.ceilingTips.length)];
      particles.spawn({ x: tip.x, y: tip.y, vy: 14, life: 1.1, color: p.wet, grav: 80 });
    }
  }

  /** 远中近三层视差背景。resX/resY 是镜头相对当前房间原点的残差。 */
  drawBackground(ctx: CanvasRenderingContext2D, resX: number, resY: number, time: number): void {
    const p = this.palette;
    // 井筒天光：上层从顶渗一丝冷绿，深层从底渗一丝群系色
    const sky = ctx.createLinearGradient(0, 0, 0, ROOM_H);
    sky.addColorStop(0, p.bgTop);
    sky.addColorStop(0.45, p.bgBase);
    sky.addColorStop(1, p.bgBase);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);

    this.drawLayer(ctx, this.bgFar, p.bgFar, resX * 0.18, resY * 0.18, time, 0, 0.35);
    this.drawLayer(ctx, this.bgMid, p.bgMid, resX * 0.42, resY * 0.42, time, 2, 0.55);
    this.drawLayer(ctx, this.bgNear, p.bgNear, resX * 0.68, resY * 0.68, time, 5, 0.8);

    this.drawShafts(ctx, time, resX, resY, 0.045);
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: BgLayer,
    color: string,
    ox: number,
    oy: number,
    time: number,
    seed: number,
    speckA: number,
  ): void {
    ctx.save();
    ctx.translate(-Math.round(ox), -Math.round(oy));
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(-50, ROOM_H + 50);
    layer.floor.forEach((y, i) => {
      ctx.lineTo(-50 + (i * (ROOM_W + 100)) / (layer.floor.length - 1), y);
    });
    ctx.lineTo(ROOM_W + 50, ROOM_H + 50);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-50, -50);
    layer.ceil.forEach((y, i) => {
      ctx.lineTo(-50 + (i * (ROOM_W + 100)) / (layer.ceil.length - 1), y);
    });
    ctx.lineTo(ROOM_W + 50, -50);
    ctx.closePath();
    ctx.fill();

    for (const col of layer.cols) {
      ctx.fillRect(Math.round(col.x), Math.round(col.y), Math.round(col.w), Math.round(col.h));
    }

    layer.stal.forEach((s, i) => {
      const sway = Math.sin(time * 0.28 + i + seed) * 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x - s.w / 2, -4);
      ctx.lineTo(s.x + sway, -4 + s.len);
      ctx.lineTo(s.x + s.w / 2, -4);
      ctx.closePath();
      ctx.fill();
    });

    for (const h of layer.hangs) {
      ctx.fillRect(Math.round(h.x), 0, Math.round(h.w), Math.round(h.len));
    }

    // 远景植物剪影：比岩体略偏群系色，读得出是活物
    ctx.fillStyle = this.palette.moss;
    ctx.globalAlpha = 0.45;
    for (const pl of layer.plants) {
      if (pl.k === 0) {
        ctx.fillRect(Math.round(pl.x), Math.round(pl.y - pl.h), 2, Math.round(pl.h));
        ctx.fillRect(Math.round(pl.x - 3), Math.round(pl.y - pl.h), 8, 3);
      } else if (pl.k === 1) {
        ctx.beginPath();
        ctx.moveTo(pl.x, pl.y);
        ctx.quadraticCurveTo(pl.x + 6, pl.y - pl.h * 0.5, pl.x + 2, pl.y - pl.h);
        ctx.lineTo(pl.x - 1, pl.y);
        ctx.fill();
      } else {
        ctx.fillRect(Math.round(pl.x - 4), Math.round(pl.y - 5), 9, 5);
        ctx.fillRect(Math.round(pl.x - 2), Math.round(pl.y - 8), 5, 4);
      }
    }
    ctx.globalAlpha = 1;

    const p = this.palette;
    ctx.fillStyle = p.floraGlow;
    for (const s of layer.specks) {
      const a = 0.22 + Math.sin(time * 1.4 + s.x * 0.1 + seed) * 0.16;
      ctx.globalAlpha = Math.max(0, speckA * a);
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 体积光柱。behind=弱（背景）、front 在光照后用 additive 再扫一遍。 */
  drawShafts(ctx: CanvasRenderingContext2D, time: number, resX = 0, resY = 0, alpha = 0.05): void {
    if (this.shafts.length === 0) return;
    ctx.save();
    ctx.translate(-Math.round(resX * 0.15), -Math.round(resY * 0.1));
    for (const s of this.shafts) {
      const pulse = 0.85 + Math.sin(time * 0.6 + s.x * 0.04) * 0.15;
      const g = ctx.createLinearGradient(s.x, 0, s.x, s.h);
      g.addColorStop(0, `rgba(${this.palette.shaft},${(alpha * 1.6 * pulse).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(${this.palette.shaft},${(alpha * 0.55 * pulse).toFixed(3)})`);
      g.addColorStop(1, `rgba(${this.palette.shaft},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x + s.w, 0);
      ctx.lineTo(s.x + s.w + 10, s.h);
      ctx.lineTo(s.x - 6, s.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawShaftsFront(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    this.drawShafts(ctx, time, 0, 0, 0.018);
    ctx.restore();
  }

  /** 主题色染：把场景物件的基础色向本房苔藓色混合 k 比例（0~1）——
   *  房间主题影响场景类观感但不完全变色（用户需求：倾向一点）。返回 #rrggbb，可与 shade 组合。 */
  tint(base: string, k = 0.35): string {
    const n = parseInt(base.replace("#", ""), 16);
    const br = (n >> 16) & 255, bg = (n >> 8) & 255, bb = n & 255;
    const m = this.mossColor.split(",").map((v) => Number(v));
    const mix = (a: number, b: number) => Math.max(0, Math.min(255, Math.round(a + (b - a) * k)));
    const hex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${hex(mix(br, m[0]))}${hex(mix(bg, m[1]))}${hex(mix(bb, m[2]))}`;
  }

  /** 环境微光：装饰灯/萤光苔/孢子/背景星点的慢脉搏光晕。光照后 additive。 */
  /** 自发光点缀：发光苔藓 + 萤火虫/蜡烛/晶石/吊灯。在光照层之后调用（lighter 叠加）。 */
  drawGlowScene(ctx: CanvasRenderingContext2D, time: number): void {
    const rgb = this.mossColor;
    ctx.save();

    ctx.globalCompositeOperation = "lighter";
    // 完整苔藓描边：整层呼吸脉动
    if (this.glowLayer) {
      ctx.globalAlpha = 0.82 + Math.sin(time * 1.1) * 0.12;
      ctx.drawImage(this.glowLayer, 0, 0);
      ctx.globalAlpha = 1;
    }
    const halo = (x: number, y: number, r: number, a: number, color: string): void => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${color},${a.toFixed(3)})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

    // 发光苔藓：贴壁的呼吸微光
    for (const m of this.glowMoss) {
      const pulse = 0.55 + Math.sin(time * 1.3 + m.ph) * 0.45;
      halo(m.x, m.y, 4 + m.s, 0.055 * pulse, rgb);
      ctx.fillStyle = `rgba(${rgb},${(0.5 * pulse).toFixed(3)})`;
      ctx.fillRect(m.x, m.y, m.s, 1);
    }


    ctx.restore();
  }

  drawDynamicGlow(ctx: CanvasRenderingContext2D, time: number, depth: number): void {
    const p = this.palette;
    const tint = p.glow;
    const base = 0.012 + depth * 0.009;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const halo = (x: number, y: number, r: number, a: number, color = tint): void => {
      const rgb = rgbParts(color);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
      g.addColorStop(0.42, `rgba(${rgb},${(a * 0.3).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

    for (const l of this.lights) {
      const pulse = 0.72 + Math.sin(time * 1.6 + l.x * 0.04 + l.y * 0.03) * 0.28;
      halo(l.x, l.y, l.r * 3.4, base * 2.0 * pulse, l.tint ?? tint);
    }

    for (const l of this.lichen) {
      if (!l.glow) continue;
      const pulse = 0.62 + Math.sin(time * 2.1 + l.x * 0.08) * 0.38;
      halo(l.x + 1, l.y + 1, 9, base * 1.5 * pulse);
    }

    for (const m of this.motes) {
      if (!m.glow) continue;
      const pulse = 0.58 + Math.sin(time * 2.8 + m.ph) * 0.42;
      halo(m.x, m.y, 6 + m.s * 2.5, base * 1.2 * pulse, p.floraGlow);
    }

    for (const f of this.flora) {
      if (f.kind !== 3) continue;
      const pulse = 0.7 + Math.sin(time * 1.4 + f.ph) * 0.3;
      halo(f.x, f.y - 5 * f.s, 12 * f.s, base * 1.6 * pulse);
    }

    const speckGlow = (layer: BgLayer, seed: number): void => {
      for (const s of layer.specks) {
        const tw = 0.5 + Math.sin(time * 1.4 + s.x * 0.1 + seed) * 0.5;
        if (tw < 0.68) continue;
        halo(s.x, s.y, 5, base * 0.85 * tw, p.floraGlow);
      }
    };
    speckGlow(this.bgFar, 0);
    speckGlow(this.bgMid, 2);
    speckGlow(this.bgNear, 5);

    ctx.restore();
  }

  /** 背景植物：画在瓦片之后、实体之前，带轻微摇曳。 */
  drawFlora(ctx: CanvasRenderingContext2D, time: number): void {
    const p = this.palette;
    for (const f of this.flora) {
      const sway = Math.sin(time * 1.1 + f.ph) * f.s;
      ctx.save();
      ctx.translate(Math.round(f.x), Math.round(f.y));
      ctx.globalAlpha = 0.42;
      if (f.kind === 0) {
        ctx.fillStyle = "#4a3a2c";
        ctx.fillRect(-1, -7 * f.s, 2, 7 * f.s);
        ctx.fillStyle = p.flora;
        ctx.fillRect(-4 * f.s, -10 * f.s, 8 * f.s, 4 * f.s);
        ctx.fillStyle = p.flora;
        ctx.fillRect(-2 * f.s, -10 * f.s, 3 * f.s, 1);
      } else if (f.kind === 1) {
        ctx.strokeStyle = p.flora;
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(i * 3.5, -6 * f.s, i * 7 + sway, -11 * f.s);
          ctx.stroke();
        }
      } else if (f.kind === 2) {
        ctx.strokeStyle = p.grass;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(sway, -5 * f.s, sway * 2, -9 * f.s);
        ctx.stroke();
        ctx.fillStyle = p.grassDim;
        ctx.fillRect(Math.round(sway * 2) - 1, Math.round(-10 * f.s), 2, 2);
      } else if (f.kind === 3) {
        // 成簇发光菌
        ctx.fillStyle = "#3a3228";
        ctx.fillRect(-1, -4 * f.s, 2, 4 * f.s);
        ctx.fillRect(3, -3 * f.s, 1, 3 * f.s);
        ctx.fillStyle = p.flora;
        ctx.fillRect(-3 * f.s, -6 * f.s, 5 * f.s, 3 * f.s);
        ctx.fillRect(2, -5 * f.s, 3 * f.s, 2 * f.s);
        ctx.fillStyle = p.flora;
        ctx.fillRect(-2 * f.s, -6 * f.s, 2, 1);
      } else {
        // 芦苇
        ctx.strokeStyle = p.grassDim;
        ctx.lineWidth = 1;
        for (const dx of [-2, 0, 2]) {
          ctx.beginPath();
          ctx.moveTo(dx, 0);
          ctx.quadraticCurveTo(dx + sway, -8 * f.s, dx + sway * 1.6, -14 * f.s);
          ctx.stroke();
        }
        ctx.fillStyle = p.flora;
        ctx.fillRect(Math.round(sway * 1.6) - 1, Math.round(-15 * f.s), 2, 2);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  drawMotes(ctx: CanvasRenderingContext2D, time: number): void {
    const p = this.palette;
    for (const m of this.motes) {
      const pulse = 0.18 + Math.sin(time * 2.2 + m.ph) * 0.1;
      ctx.globalAlpha = Math.max(0.08, pulse);
      ctx.fillStyle = p.spore;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s);
    }
    ctx.globalAlpha = 1;
  }

  /** 贴瓦片的细节：苔藓、草簇、碎石、根须、裂缝、壁菇。纯视觉，半透明退到碰撞岩之后。 */
  drawTileDecor(ctx: CanvasRenderingContext2D, time: number): void {
    const p = this.palette;
    ctx.globalAlpha = 0.62;

    ctx.fillStyle = p.moss;
    for (const m of this.moss) {
      ctx.globalAlpha = m.side === 0 ? 0.58 : 0.46; // 装饰退后半步：与可碰撞物拉开层次
      ctx.fillRect(Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h));
      if (m.side === 0) {
        ctx.fillStyle = p.grassDim;
        ctx.fillRect(Math.round(m.x + 1), Math.round(m.y), Math.max(1, Math.round(m.w - 2)), 1);
        ctx.fillStyle = p.moss;
      }
    }
    ctx.globalAlpha = 1;

    for (const l of this.lichen) {
      ctx.fillStyle = p.moss;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(l.x), Math.round(l.y), 2, 1);
      ctx.fillRect(Math.round(l.x), Math.round(l.y + 1), 1, 1);
    }
    ctx.globalAlpha = 1;

    for (const s of this.shelves) {
      ctx.fillStyle = p.flora;
      ctx.globalAlpha = 0.55;
      const w = Math.round(s.w);
      ctx.fillRect(Math.round(s.x), Math.round(s.y), w, 2);
    }
    ctx.globalAlpha = 0.62;

    // ⚠ stroke 前必须显式设 strokeStyle/lineWidth：canvas 状态会跨帧泄漏
    ctx.strokeStyle = "rgba(8, 12, 16, 0.62)";
    ctx.lineWidth = 1;
    for (const c of this.cracks) {
      ctx.beginPath();
      ctx.moveTo(c.pts[0][0], c.pts[0][1]);
      for (const [x, y] of c.pts) ctx.lineTo(x, y);
      ctx.stroke();
    }

    for (const h of this.hangMoss) {
      const sway = Math.sin(time * 1.5 + h.ph) * 1.1;
      ctx.strokeStyle = p.moss;
      ctx.lineWidth = 1;
      for (let i = 0; i < h.n; i++) {
        const dx = (i - (h.n - 1) / 2) * 1.6;
        ctx.beginPath();
        ctx.moveTo(h.x + dx, h.y);
        ctx.quadraticCurveTo(h.x + dx + sway * 0.4, h.y + h.len * 0.55, h.x + dx + sway, h.y + h.len);
        ctx.stroke();
      }
      ctx.fillStyle = p.grassDim;
      ctx.fillRect(Math.round(h.x + sway), Math.round(h.y + h.len), 2, 1);
    }

    for (const r of this.roots) {
      const sway = Math.sin(time * 1.3 + r.ph) * 2.2;
      ctx.strokeStyle = p.root;
      ctx.lineWidth = r.thick ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.quadraticCurveTo(r.x + sway, r.y + r.len * 0.6, r.x + sway * 2, r.y + r.len);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = p.grassDim;
      ctx.fillRect(Math.round(r.x + sway * 2), Math.round(r.y + r.len), 1, 1);
      if (r.thick) {
        ctx.fillStyle = p.moss;
        ctx.fillRect(Math.round(r.x + sway * 0.8) - 1, Math.round(r.y + r.len * 0.45), 2, 1);
      }
    }

    for (const g of this.grass) {
      ctx.globalAlpha = 0.86;
      const react = g.swayT > 0 ? Math.sin(time * 16 + g.ph) * 2 * (g.swayT / 0.55) : 0;
      const sway = Math.sin(time * 1.6 + g.ph) * 1.2 + react;
      const h = Math.round(g.h);
      ctx.fillStyle = g.dim ? p.grassDim : p.grass;
      for (let i = 0; i < g.blades; i++) {
        const dx = i * 1.5;
        const bend = Math.round(sway * (g.h / 5) * (0.6 + i * 0.2));
        ctx.fillRect(Math.round(g.x + dx + bend * 0.4), Math.round(g.y - h + Math.abs(i - 1)), 1, h);
      }
    }

    for (const b of this.bushes) {
      ctx.globalAlpha = 0.86;
      const react = b.swayT > 0 ? Math.sin(time * 15 + b.ph) * 2.4 * (b.swayT / 0.55) : 0;
      const sway = Math.sin(time * 1.2 + b.ph) * 0.7 + react;
      for (let i = 0; i < b.n; i++) {
        const bx = b.x + (i - (b.n - 1) / 2) * 2.2;
        const h = b.h * (i % 2 === 0 ? 1 : 0.72);
        ctx.fillStyle = i % 2 === 0 ? p.grass : p.grassDim;
        ctx.fillRect(Math.round(bx + sway * 0.5), Math.round(b.y - h), 2, Math.round(h));
      }
      ctx.fillStyle = p.grassDim;
      ctx.fillRect(Math.round(b.x + sway), Math.round(b.y - b.h - 1), 2, 1);
    }

    for (const s of this.sprouts) {
      ctx.globalAlpha = 0.86;
      const sway = Math.sin(time * 1.4 + s.ph) * 1.2;
      const h = s.h;
      const tipX = s.x + s.curl * h * 0.45 + sway;
      const tipY = s.y - h;
      ctx.strokeStyle = p.root;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(s.x + s.curl * h * 0.1, s.y - h * 0.6, tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = p.flora;
      ctx.fillRect(Math.round(tipX) - (s.curl > 0 ? 0 : 2), Math.round(tipY), 2, 1);
      ctx.fillRect(Math.round(tipX) + (s.curl > 0 ? 1 : -1) * (s.kind === 0 ? 0 : 1), Math.round(tipY) - 1, 1, 2);
      if (s.kind !== 1) {
        ctx.fillStyle = p.grassDim;
        ctx.fillRect(Math.round(s.x + s.curl * 1), Math.round(s.y - h * 0.35), 2, 1);
      }
      // 装饰芽不发亮：发光留给可交互物
    }

    ctx.fillStyle = p.rockDeep;
    for (const pb of this.pebbles) {
      ctx.fillRect(Math.round(pb.x), Math.round(pb.y), pb.w, 1);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /** 光照后的雾团 + 群系色罩。depth 0..1。 */
  drawFog(ctx: CanvasRenderingContext2D, time: number, depth: number): void {
    const fog = this.palette.fog;
    const banks: [number, number, number, number][] = [
      [7, 38, 250, 32],
      [-11, 92, 220, 28],
      [15, 148, 260, 24],
      [-8, 70, 180, 18],
    ];
    ctx.save();
    for (const [sp, yy, rx, ry] of banks) {
      const off = ((time * sp) % 560 + 560) % 560 - 280;
      const a = (0.07 + depth * 0.09) * (0.9 + Math.sin(time * 0.35 + yy) * 0.1);
      ctx.fillStyle = `rgba(${fog},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(160 + off, yy + Math.sin(time * 0.4 + yy) * 5, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 贴地潮气
    const ground = ctx.createLinearGradient(0, 120, 0, ROOM_H);
    ground.addColorStop(0, `rgba(${fog},0)`);
    ground.addColorStop(1, `rgba(${fog},${(0.08 + depth * 0.09).toFixed(3)})`);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 120, ROOM_W, 60);
    ctx.restore();
  }

  drawGrade(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = `rgba(${this.palette.grade},0.14)`;
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);
  }
}

// 苔藓底色按生物群系分：上绿 / 中青 / 深紫，房间种子再做明暗微调——同一层各有各的色。
function defaultMoss(depth: number, rng: () => number): string {
  const base = depth < 0.4 ? [110, 220, 120] : depth < 0.75 ? [90, 200, 210] : [150, 130, 230];
  const k = () => 0.85 + rng() * 0.3;
  return base.map((v) => Math.round(Math.min(255, v * k()))).join(",");
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
