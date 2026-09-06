// 世界：房间装载与流转、道具使用路由、危险判定、光照合成、HUD、存档、结局。
// 房间即一屏，镜头在房间原点之间滑动；转换期间世界冻结（确定性优先）。
import type { Input } from "../engine/input";
import { keyLabel } from "../engine/input";
import { audio } from "../engine/audio";
import { Particles } from "../engine/particles";
import { LightPass, type Light } from "../engine/light";
import { drawText, drawTextCentered } from "../engine/pixfont";
import { Player } from "./player";
import type { StalkLike } from "./player";
import {
  Bubble,
  Flower,
  ITEM_ORDER,
  PitcherElevator,
  SpikeRow,
  Ring,
  SavePoint,
  SporeCloud,
  VineStalk,
  drawItemGlyph,
  segPointDist,
  segRectHit,
  type Entity,
  type ItemId,
  type Rect,
  ENTITY_TYPES,
  type BaseEntity,
  VineBud,
} from "./entities";
import { mat } from "../data/materials";
import { RoomDecor, paletteFor, GLOBAL_LIGHT_DEPTH, type Palette } from "./decor";
import { ROOMS, ROOM_KEY_BY_ID, SEED_TOTAL, SPAWN, type ObjDef, type RoomDef } from "../data/maps";
import {
  BEAN_HOLD_TIME,
  BEAN_MAX_TILES,
  BEAN_PARK_TIME,
  BUBBLE_DOOM,
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  RING_GRAB_RADIUS,
  ROOM_H,
  ROOM_W,
  TILE,
  TRIGGER_HOLD,
  USE_BUFFER,
} from "./constants";
import { Tile, Tilemap } from "../engine/tiles";

const SAVE_KEY = "plantwell.save.v1";
const FADE_T = 0.1; // 黑场眨眼单程时长（秒）：出 0.1 + 入 0.1

interface RoomInst {
  cx: number;
  cy: number;
  def: RoomDef;
  tiles: Tilemap;
  entities: Entity[];
  solids: Rect[];
  decor: RoomDecor;
}

interface SaveData {
  room: [number, number];
  x: number;
  y: number;
  items: ItemId[];
  active: ItemId | null;
  seeds: number[];
  flags: string[];
  hp?: number;
  /** 上次激活的存档花：血尽重生点（缺省回出生点）。 */
  checkpoint?: { room: [number, number]; x: number; y: number } | null;
  /** 每株已激活存档花的落点（传送目的地）。键=存档花 flagKey。 */
  spPos?: Record<string, { room: [number, number]; x: number; y: number }>;
}

export class World {
  player = new Player();
  particles = new Particles();
  private lightPass = new LightPass();

  cx = 0;
  cy = 0;
  room!: RoomInst;
  flags = new Set<string>();
  seeds = new Set<number>();
  items = new Set<ItemId>();
  activeItem: ItemId | null = null;
  /** 本帧玩家被场景物"吞入"（猪笼草电梯乘坐中）：draw 跳过玩家绘制。每帧 update 开头清零。 */
  hidePlayer = false;
  /** 空笼跨房时挂在世界级的载具：玩家视野外仍照常模拟（飞行/到站/返程计时），
   *  它的 homeKey 房间被加载时自动归位进该房实体表。 */
  detached: PitcherElevator[] = [];


  time = 0;
  paused = false;
  mapOpen = false;
  camX = 0;
  camY = 0;
  /** 房间切换：渐隐→瞬间换房→渐显的黑场眨眼。不用平移——任何帧率下都不会有叠影。 */
  private fade: { t: number; phase: "out" | "in"; ncx: number; ncy: number; nx: number; ny: number; dur?: number } | null = null;

  // 结局两段：巨花绽放 → 黑屏尾声
  ending = false;
  private endingT = 0;
  epilogue = false;
  private epilogueT = 0;

  // 藤鞭一次挥击的命中去重
  private whipConsumed = new Set<object>();
  private boundaryDoorHit = new Set<string>();
  private lastSafeX = 0;
  private lastSafeY = 0;

  toastT = 0;
  private toastItem: ItemId | null = null;
  private useBuf = 0; // 使用键预输入：锁定期间按下也不丢

  // 蔓豆：全局只认一根活茎；beanHold 累计长按使用键的时长（够 BEAN_HOLD_TIME 才扎根）
  beanStalk: VineStalk | null = null;
  private beanHold = 0;
  // 离房后的豆茎停泊位：期内返回原房即原样捞回，超时丢弃
  private parkedStalk: { stalk: VineStalk; roomKey: string; timer: number } | null = null;

  // 本房间的入口（跨房进入时的落点）：未安抚游魂把人送回这里
  entryX = 0;
  entryY = 0;

  // ---- 存档花（血量/重生/传送系统）----
  /** 上次激活的存档花落点：血尽时回到这里（null=回出生点）。 */
  checkpoint: { room: [number, number]; x: number; y: number } | null = null;
  /** 每株已激活存档花的传送落点，键=flagKey。 */
  spPos = new Map<string, { room: [number, number]; x: number; y: number }>();
  /** 本帧玩家身旁的存档花（HUD 提示与交互用）。 */
  nearSave: SavePoint | null = null;
  /** 传送选花模式：地图面板打开，WASD 自由移动光标，压住存档花才能确认转移。 */
  travelMode = false;
  private travelCursor: { x: number; y: number } | null = null; // 全局地图上的瓦片坐标
  private travelRepeat = 0;
  /** 吸附冷却：吸到存档花后短暂不再吸附，玩家可以继续把光标移开 */ // 光标按住连发的延迟/间隔计时
  private travelArmed = false; // 连发保险：开传送的那一下方向键松开前不许连发（否则开菜单即挪一格）
  private travelPanTX = 0; // 视野跟随的 pan 目标（实际 pan 每帧向它插值，贴边才滚动）
  private travelPanTY = 0;
  private travelList: { key: string; cx: number; cy: number; x: number; y: number; mx: number; my: number }[] = [];
  private hurtFlashT = 0;
  /** 本帧刚在存档花前激活过：吞掉这一下"使用键"，免得蔓豆跟着扎根。 */
  private saveJustUsed = false;

  // 地图视图：全局地形缩略图，当前房居中；QE 缩放、WASD 平移（pan 单位=地图像素）
  mapZoom = 2;
  private mapPanX = 0;
  private mapPanY = 0;
  private worldMap: HTMLCanvasElement | null = null;
  private mapDirty = true;
  private mapMinCx = 0;
  private mapMinCy = 0;
  private mapCols = 1;
  private mapRows = 1;

  debug = false;
  /** debug 态换房日志（探针用）：loadRoom 调用时间与来源。 */
  debugLog: string[] = [];
  /** 0..1 scene darkness tuning (higher = darker). */
  debugSceneDark = 0.82;
  /** 0..1 player glow brightness (lower = darker seed). */
  debugPlayerGlow = 0.72;
  onExitToTitle: () => void = () => {};

  constructor(private input: Input) {}

  // ---- 生命周期 ----

  startNew(): void {
    this.useBuf = 0;
    this.beanStalk = null;
    this.parkedStalk = null;
    this.flags.clear();
    this.seeds.clear();
    this.items.clear();
    this.activeItem = null;
    this.ending = false;
    this.epilogue = false;
    this.paused = false;
    this.travelMode = false;
    this.checkpoint = null;
    this.spPos.clear();
    this.player.hp = this.player.maxHp;
    const [cx, cy] = SPAWN.room.split(",").map(Number);
    this.loadRoom(cx, cy);
    this.player.spawnAt(SPAWN.x, SPAWN.y);
    this.lastSafeX = SPAWN.x;
    this.lastSafeY = SPAWN.y;
    this.entryX = SPAWN.x;
    this.entryY = SPAWN.y;
    this.snapCamera();
  }

  hasSave(): boolean {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  continueGame(): boolean {
    const save = this.readSave();
    if (!save) return false;
    this.useBuf = 0;
    this.beanStalk = null;
    this.parkedStalk = null;
    this.flags = new Set(save.flags);
    this.seeds = new Set(save.seeds);
    this.items = new Set(save.items);
    this.activeItem = save.active;
    this.ending = false;
    this.epilogue = false;
    this.paused = false;
    this.travelMode = false;
    this.player.hp = save.hp ?? this.player.maxHp;
    this.checkpoint = save.checkpoint ?? null;
    this.spPos = new Map(Object.entries(save.spPos ?? {}));
    this.loadRoom(save.room[0], save.room[1]);
    this.player.spawnAt(save.x, save.y);
    this.lastSafeX = save.x;
    this.lastSafeY = save.y;
    this.entryX = save.x;
    this.entryY = save.y;
    this.snapCamera();
    return true;
  }

  private readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? (JSON.parse(raw) as SaveData) : null;
    } catch {
      return null;
    }
  }

  saveGame(): void {
    if (this.ending || this.epilogue) return;
    try {
      const data: SaveData = {
        room: [this.cx, this.cy],
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        items: [...this.items],
        active: this.activeItem,
        seeds: [...this.seeds],
        flags: [...this.flags],
        hp: this.player.hp,
        checkpoint: this.checkpoint,
        spPos: Object.fromEntries(this.spPos),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // 存不上就算了（隐私模式），本次会话照玩
    }
  }

  clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* 同上 */
    }
  }

  // ---- 房间装载 ----

  private loadRoom(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const def = ROOMS[key];
    if (!def) return;
    if (this.debug) {
      // 探针/调试：换房调用日志（谁在什么时候换了房），最新 60 条
      const via = (new Error().stack ?? "").split("\n")[2]?.trim().replace(/^at /, "") ?? "?";
      this.debugLog.push(`t=${Math.round(this.time * 60)} loadRoom ${key} via ${via}`);
      if (this.debugLog.length > 60) this.debugLog.shift();
    }
    const fromKey = `${this.cx},${this.cy}`; // 茎所在的老房（此刻 cx/cy 还没换）
    this.cx = cx;
    this.cy = cy;
    // 蔓豆茎停泊：离房不立刻消失——挂 BEAN_PARK_TIME 倒计时，**停泊房=离开前的那间**，
    // 期内回老房原样捞回；去别的房间看不见它，倒计时走完才真正丢弃
    if (this.beanStalk && !this.beanStalk.dead) {
      this.parkedStalk = { stalk: this.beanStalk, roomKey: fromKey, timer: BEAN_PARK_TIME };
    }
    this.beanStalk = null;
    this.flags.add(`seen:${key}`); // 地图迷雾：到过的房间才上地图（随 flags 自动入存档）
    this.mapDirty = true; // 新到访的房间要烙进全局地图
    const entities: Entity[] = [];
    (def.objects ?? []).forEach((o: ObjDef, i: number) => {
      const k = `${key}#${i}`;
      const factory = ENTITY_TYPES[o.type] as (o: ObjDef, key: string, flags: ReadonlySet<string>, homeKey: string) => BaseEntity | BaseEntity[];
      if (!factory) return; // 未知类型（校验器兜底）：跳过不实例化
      // 两个键各司其职，别混用：
      //   k = "房#序号" → 存档 flag 键（bud/vinebud/switch/plate/sp）
      //   key = 网格键 → 载具 homeKey（电梯 endRoom 与它比较判断是否跨房，带序号会永远"跨房"）
      const made = factory(o, k, this.flags, key);
      const list = Array.isArray(made) ? made : [made];
      for (const e of list) {
        entities.push(e);
      }
      const n0 = entities.length - list.length;
      // 材质键：供"基础微光"回退按物件类型取材质
      for (let j = n0; j < entities.length; j++) entities[j].matKey = o.type;
      // 视觉缩放（纯渲染）：实际 = scale × (1 ± scaleJit)，随机按房间+序号确定性取值
      if (entities.length > n0 && (o.scale !== undefined || (o.scaleJit ?? 0) > 0)) {
        const sc = o.scale ?? 1;
        const jit = o.scaleJit ?? 0;
        let mul = sc;
        if (jit > 0) {
          let h = 2166136261;
          for (let c = 0; c < k.length; c++) {
            h ^= k.charCodeAt(c);
            h = Math.imul(h, 16777619);
          }
          const r = ((h >>> 0) % 1000) / 1000;
          mul = sc * (1 + (r * 2 - 1) * jit);
        }
        mul = Math.min(3, Math.max(0.3, mul));
        for (let j = n0; j < entities.length; j++) entities[j].scale = mul;
      }
    });
    // 回到停泊房：豆茎原样捞回（倒计时清零）
    if (this.parkedStalk && this.parkedStalk.roomKey === key) {
      if (!this.parkedStalk.stalk.dead) {
        this.beanStalk = this.parkedStalk.stalk;
        entities.push(this.beanStalk);
      }
      this.parkedStalk = null;
    }
    this.room = {
      cx,
      cy,
      def,
      tiles: new Tilemap(32, 18, def.map),
      entities,
      solids: [],
      decor: new RoomDecor(key, new Tilemap(32, 18, def.map), cy / 6),
    };
    // 挂在视野外的跨房载具：家房被加载就归位（同 id 的数据原件让位给它）
    if (this.detached.length) {
      const stay: PitcherElevator[] = [];
      for (const el of this.detached) {
        if (el.homeKey === key) {
          this.room.entities = this.room.entities.filter(
            (x) => x === el || (x as { id?: unknown }).id !== el.id,
          );
          this.room.entities.push(el);
          el.detached = false;
        } else stay.push(el);
      }
      this.detached = stay;
    }
    // 电梯到站状态持久：flags lift:<id> = 该电梯停在远端。
    // 出发房重建出的"origin 状态数据原件"让位（真身在远端，以 detached 挂着等玩家去）；
    // 终点房物化远端形态的真身（同 id 旧实例让位）。flag 不在 → 一切按数据原位重建。
    for (const r of Object.values(ROOMS)) {
      for (const o of r.objects ?? []) {
        if (o.type !== "elevator") continue;
        if (!this.flags.has(`lift:${o.id}`)) continue;
        const homeKey2 = `${r.x},${r.y}`;
        const endKey = ROOM_KEY_BY_ID[o.end.room_id] ?? homeKey2;
        if (key === homeKey2) {
          this.room.entities = this.room.entities.filter((e) => (e as { id?: unknown }).id !== o.id);
          if (!this.detached.some((d) => d.id === o.id)) {
            const el = new PitcherElevator(o.location, { ...o.end, room_id: endKey }, o, homeKey2, this.flags);
            el.detached = true;
            this.detached.push(el);
          }
        } else if (key === endKey) {
          const here = this.room.entities.find((e) => (e as { id?: unknown }).id === o.id) as (PitcherElevator | undefined);
          if (!here || !here.atFar) {
            this.room.entities = this.room.entities.filter((e) => (e as { id?: unknown }).id !== o.id);
            if (!this.detached.some((d) => d.id === o.id)) {
              const el = new PitcherElevator(o.location, { ...o.end, room_id: endKey }, o, homeKey2, this.flags);
              this.room.entities.push(el);
            }
          }
        }
      }
    }
    this.rebuildSolids();
  }

  // ---- 主更新 ----

  update(): void {
    const input = this.input;
    this.time += 1 / 60;
    this.hidePlayer = false;
    this.saveJustUsed = false;
    this.hurtFlashT = Math.max(0, this.hurtFlashT - 1 / 60);
    this.toastT = Math.max(0, this.toastT - 1 / 60);

    // 预输入先记账：在转换/受击等"锁定"期间按下也不丢，恢复的第一步生效
    if (this.input.pressed("use")) this.useBuf = USE_BUFFER;

    if (this.epilogue) {
      this.epilogueT += 1 / 60;
      if (this.epilogueT > 4.5 && (input.pressed("confirm") || input.pressed("pause") || input.pressed("jump"))) {
        this.clearSave();
        this.onExitToTitle();
      }
      return;
    }

    if (this.ending) {
      this.endingT += 1 / 60;
      this.particles.update();
      if (this.endingT > 1 && Math.random() < 0.5) {
        this.particles.spawn({
          x: this.player.x + (Math.random() - 0.5) * 60,
          y: this.player.y + 20,
          vy: -20 - Math.random() * 30,
          life: 1.5,
          color: Math.random() < 0.5 ? "#ffe9a8" : "#cfe8d8",
        });
      }
      if (this.endingT > 4) {
        this.ending = false;
        this.epilogue = true;
        this.epilogueT = 0;
        this.particles.clear();
      }
      return;
    }

    if (this.input.pressed("pause")) {
      if (this.travelMode) {
        this.travelMode = false; // Esc 先关传送选花，再谈暂停
        this.mapOpen = false;
        this.useBuf = 0;
        return;
      }
      if (this.mapOpen) {
        this.mapOpen = false;
        return;
      }
      this.paused = !this.paused;
      if (this.paused) this.saveGame();
    }
    if (this.paused) {
      this.useBuf = 0; // 暂停是显式冻结，不替玩家记这一下
      return;
    }
    if (this.input.pressed("map")) {
      this.mapOpen = !this.mapOpen;
      if (this.mapOpen) {
        this.mapPanX = 0;
        this.mapPanY = 0; // 打开地图：视野以当前房间为中心
      }
    }
    if (this.travelMode) {
      this.updateTravelMap();
      return;
    }
    if (this.mapOpen) {
      this.updateMapView();
      return;
    }

    if (this.fade) {
      const dur = this.fade.dur ?? FADE_T;
      this.fade.t += 1 / 60;
      if (this.fade.phase === "out" && this.fade.t >= dur) {
        this.completeRoomSwap();
      } else if (this.fade.phase === "in" && this.fade.t >= dur) {
        this.fade = null;
      }
      return;
    }

    this.player.update(this, input);

    // 藤鞭扫击挂钩：鞭身任何一处扫过钩环就立刻挂上（不只是鞭梢），隔墙不钩
    if (this.player.whipHeld && this.player.deadT <= 0 && !this.player.swing && !this.player.pull) {
      for (const seg of this.player.whipSegs()) {
        let grabbed: Ring | null = null;
        for (const e of this.room.entities) {
          if (!(e instanceof Ring)) continue;
          if (segPointDist(seg, e.x, e.y) > RING_GRAB_RADIUS) continue;
          if (this.lineBlocked(this.player.x, this.player.y, e.x, e.y)) continue;
          grabbed = e;
          break;
        }
        if (grabbed) {
          audio.attach();
          this.particles.burst(grabbed.x, grabbed.y, 5, { speed: 25, color: "#e0cc96", life: 0.3 });
          this.player.startPull(grabbed);
          break;
        }
      }
    }

    // 鞭梢越过房间边界：邻房贴边的脆弱门可以从脆弱侧隔界击破（如 (1,3)/(2,3) 荆棘门）
    if (this.player.whipHeld && this.player.deadT <= 0 && !this.player.swing && !this.player.pull) {
      for (const dir of [-1, 1] as const) {
        const def = ROOMS[`${this.cx + dir},${this.cy}`];
        if (!def?.objects) continue;
        for (const o of def.objects) {
          if (o.type !== "door" || !o.fragile || this.flags.has(`door:${o.id}`)) continue;
          const rect = { x: o.location.x * TILE + dir * ROOM_W, y: o.location.y * TILE, w: o.w * TILE, h: o.h * TILE };
          let hit = false;
          for (const seg of this.player.whipSegs()) {
            if (!segRectHit(seg, rect)) continue;
            hit = true;
            break;
          }
          if (!hit) continue;
          const qx = Math.max(rect.x, Math.min(this.player.x, rect.x + rect.w));
          const qy = Math.max(rect.y, Math.min(this.player.y, rect.y + rect.h));
          if (this.lineBlocked(this.player.x, this.player.y, qx, qy)) continue; // 隔墙不破门
          const fromFragile =
            o.fragile === "right" ? this.player.x > rect.x + rect.w : this.player.x < rect.x;
          if (fromFragile) {
            this.flags.add(`door:${o.id}`);
            audio.doorOpen();
            this.particles.burst(rect.x + rect.w / 2, rect.y + rect.h / 2, 18, {
              speed: 45,
              color: "#7fae8c",
              life: 0.7,
              grav: 90,
            });
            this.saveGame();
          } else if (!this.boundaryDoorHit.has(o.id)) {
            // 免疫侧：一次挥鞭只提示一次
            this.boundaryDoorHit.add(o.id);
            audio.switchClick();
            const hx = o.fragile === "right" ? rect.x + rect.w : rect.x;
            this.particles.burst(hx, this.player.y, 6, { speed: 40, color: "#c8b890", life: 0.3, grav: 160 });
          }
        }
      }
    }

    // 切换道具
    if (input.pressed("cycle")) {
      const owned = ITEM_ORDER.filter((i) => this.items.has(i));
      if (owned.length > 0) {
        const idx = this.activeItem ? owned.indexOf(this.activeItem) : -1;
        this.activeItem = owned[(idx + 1) % owned.length];
        audio.switchClick();
      }
    }
    // 数字键直选槽位：1=藤鞭 2=泡泡荚 3=孢子笛 4=蔓豆（未持有的按了没反应）
    ITEM_ORDER.forEach((item, i) => {
      if (input.pressed(`slot${i + 1}` as "slot1")) {
        if (this.items.has(item) && this.activeItem !== item) {
          this.activeItem = item;
          audio.switchClick();
        }
      }
    });

    // 存档花交互：靠近时可激活（回满血+设为重生点）；已激活的按 S 打开传送。
    // 放在道具路由之前：激活会清掉预输入，同一按下不会既存档又挥鞭
    this.updateSavepoint(input);

    // 使用道具：预输入只在"活着且世界正常"时衰减——死亡期间按下的 K 重生瞬间生效
    if (this.player.deadT <= 0) this.useBuf = Math.max(0, this.useBuf - 1 / 60);
    if (
      this.useBuf > 0 &&
      this.activeItem &&
      this.activeItem !== "bean" && // 蔓豆有自己的节奏：点按取消、长按扎根，不走 press 路由
      this.player.deadT <= 0 &&
      !this.player.swing
    ) {
      this.useBuf = 0;
      this.useItem(this.activeItem);
    }
    this.updateBean(input);

    // 停泊中的豆茎倒计时（只在世界的活帧走：暂停/地图/转场都不烧时间）
    if (this.parkedStalk) {
      this.parkedStalk.timer -= 1 / 60;
      if (this.parkedStalk.timer <= 0) this.parkedStalk = null;
    }

    for (const e of this.room.entities) e.update(this);
    this.room.entities = this.room.entities.filter((e) => !e.dead);
    // 空笼跨房挂载的载具：玩家视野外照常模拟（飞行/到站/返程计时），死亡照常清
    for (const e of this.detached) e.update(this);
    this.detached = this.detached.filter((e) => !e.dead);
    // 记录本步鞭身扫到的时刻：下一步的"经过"判定从这里续扫，扇面无缺口
    if (this.player.whipHeld) this.player.whipPrevT = this.player.whipT;
    this.rebuildSolids();
    this.particles.update();
    this.room.decor.update(1 / 60, this.particles, this.player.x, this.player.y);


    // 跨房电梯 riding：玩家被笼子锁着飞越房间边界，坐标越界是行程的一部分——
    // 此时不能触发房间转换（handoff 负责换房）
    if (!this.hidePlayer) this.checkTransitions();
    audio.updateAmbient(this.depth());
  }

  private useItem(item: ItemId): void {
    const p = this.player;
    if (item === "whip") {
      // 螺旋扫击：整段鞭身既是攻击判定（实体各自查 whipHits）也是挂钩判定（上方扫描）
      p.startWhip();
      this.whipConsumed.clear();
      this.boundaryDoorHit.clear();
      audio.whip();
    } else if (item === "bubble") {
      if (this.nearSpores(p.x, p.y)) {
        // 第一种护罩方式：在毒雾附近直接罩身
        p.startShield();
        audio.bubbleBlow();
        this.particles.burst(p.x, p.y, 6, { speed: 20, color: "#9fdcff", life: 0.4 });
      } else {
        // 放出静止泡泡：可踩（踩住上升），可藤鞭打中变成护罩
        let bx = p.x + p.facing * 6;
        let by = p.y - 6;
        if (this.solidAtPx(bx, by)) {
          bx = p.x;
          by = p.y - 4;
        }
        if (!this.solidAtPx(bx, by)) {
          // 一井一泡：新泡泡出现后，旧的进入 0.5s 破裂倒计时（骑在上面也照破，来得及跳走）
          for (const e of this.room.entities) if (e instanceof Bubble) e.doom = BUBBLE_DOOM;
          this.room.entities.push(new Bubble(bx, by));
          audio.bubbleBlow();
        }
      }
    } else if (item === "flute") {
      p.startFlute();
      audio.flute();
      for (const e of [...this.room.entities]) e.flute?.(this);
    }
  }

  // ---- 蔓豆：长按扎根于脚下陆地 → **按住 J 才生长**（方向键指挥、玩家原地；松开 J 立刻恢复移动）
  //      → 再按一次 J 整根消失（按住不放超过扎根时长会原地重新生根）----

  private updateBean(input: Input): void {
    if (this.beanStalk?.dead) this.beanStalk = null;
    if (this.saveJustUsed) {
      // 刚在存档花前激活过：这一下按住不算蔓豆扎根
      this.beanHold = 0;
      if (this.beanStalk) this.beanStalk.growing = false;
      return;
    }
    if (this.activeItem !== "bean" || this.player.deadT > 0) {
      this.beanHold = 0;
      if (this.beanStalk) this.beanStalk.growing = false;
      return;
    }
    const p = this.player;
    const st = this.beanStalk;
    if (st) {
      if (input.pressed("use")) {
        // 茎已存在时再按 J：整根消失
        st.cancel(this);
        this.beanStalk = null;
        this.beanHold = 0;
        return;
      }
      // 生长窗口 = J 按着；松手即收（玩家由 isBeanGrowing 恢复移动）
      st.growing = input.held("use");
      if (st.growing) {
        const gx = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
        const gy = (input.held("down") ? 1 : 0) - (input.held("up") ? 1 : 0);
        const edge =
          input.pressed("right") || input.pressed("left") || input.pressed("up") || input.pressed("down");
        st.growStep(this, { x: gx, y: gy }, edge);
      }
      return;
    }
    if (
      p.grounded &&
      !p.swing &&
      !p.climb &&
      input.held("use") &&
      this.solidAtPx(p.x, p.y + 5) // 脚下必须是实打实的陆地
    ) {
      this.beanHold += 1 / 60;
      if (this.beanHold >= BEAN_HOLD_TIME) {
        this.beanHold = 0;
        this.plantBean();
      }
      return;
    }
    this.beanHold = 0;
  }

  private plantBean(): void {
    const p = this.player;
    const tx = Math.round(p.x / 10);
    const ty = Math.round((p.y + 4) / 10); // 脚下地面瓦片行（round：落地 EPS 缓冲会停在 x9.99）
    const st = new VineStalk(tx, ty);
    this.beanStalk = st;
    this.room.entities.push(st);
    audio.plant();
    this.particles.burst(p.x, p.y + 4, 8, { speed: 22, color: "#7fd4a0", life: 0.4 });
  }

  /** 蔓豆茎是否处于生长窗口（J 按住且未长满）：玩家被根须固定原地，松手即恢复移动。 */
  isBeanGrowing(): boolean {
    const st = this.beanStalk;
    return st !== null && !st.dead && st.chain.length < BEAN_MAX_TILES && this.input.held("use");
  }

  /** 玩家身体所在处是否有可攀爬的蔓豆茎。 */
  stalkAt(x: number, y: number): StalkLike | null {
    for (const e of this.room.entities) {
      if (e instanceof VineStalk && e.holds(x, y)) return e;
    }
    return null;
  }

  /** 毒雾"邻近"：玩家判定盒与云矩形相交即算（站在云边也能触发护罩）。 */
  nearSpores(x: number, y: number): boolean {
    for (const e of this.room.entities) {
      if (e instanceof SporeCloud) {
        const r = e.rect;
        if (x + 3 > r.x && x - 3 < r.x + r.w && y + 4 > r.y && y - 4 < r.y + r.h) return true;
      }
    }
    return false;
  }

  // ---- 碰撞与危险（Player.WorldLike 实现） ----

  get locked(): boolean {
    return this.fade !== null || this.ending || this.epilogue || this.paused;
  }

  solidAtPx(x: number, y: number): boolean {
    if (this.room.tiles.solidAtPx(x, y)) return true;
    for (const r of this.room.solids) {
      if (r.oneWay) continue; // 单向平台不是墙：上升/横移/视线都可穿过
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }

  /** 攀爬豆茎时的实心判定：与 solidAtPx 一致，但无视藤蔓墙——原生藤蔓与豆茎互不干扰，
   *  茎能长进去的地方人就攀得过去（垂藤本就非实心；这里豁免的是藤蔓墙/藤蔓荚）。 */
  climbSolidAtPx(x: number, y: number): boolean {
    if (this.room.tiles.solidAtPx(x, y)) return true;
    for (const e of this.room.entities) {
      if (e instanceof VineBud) continue;
      const r = e.solidRect?.(this);
      if (!r || r.oneWay) continue;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }

  spikeAtPx(x: number, y: number): boolean {
    if (this.room.tiles.get(Math.floor(x / 10), Math.floor(y / 10)) === Tile.Spike) return true;
    for (const e of this.room.entities) {
      if (e instanceof SpikeRow) {
        const r = e.rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
      }
    }
    return false;
  }

  private rebuildSolids(): void {
    this.room.solids = [];
    for (const e of this.room.entities) {
      const r = e.solidRect?.(this);
      if (r) this.room.solids.push(r);
    }
  }

  inSpores(x: number, y: number): boolean {
    for (const e of this.room.entities) {
      if (e instanceof SporeCloud) {
        const r = e.rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
      }
    }
    return false;
  }

  checkPlayerHazards(): void {
    const p = this.player;
    const m = 1; // 判定收缩，尖刺更宽容
    const x0 = p.x - 3 + m;
    const x1 = p.x + 3 - m;
    const y0 = p.y - 4 + m;
    const y1 = p.y + 4 - m;
    let spike = false;
    for (let ty = Math.floor(y0 / 10); ty <= Math.floor(y1 / 10) && !spike; ty++) {
      for (let tx = Math.floor(x0 / 10); tx <= Math.floor(x1 / 10); tx++) {
        if (this.room.tiles.get(tx, ty) === Tile.Spike) {
          spike = true;
          break;
        }
      }
    }
    if (!spike) {
      for (const e of this.room.entities) {
        if (e instanceof SpikeRow) {
          const r: Rect = e.rect;
          if (x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y) {
            spike = true;
            break;
          }
        }
      }
    }
    if (spike) {
      if (p.hurt(this)) this.onHazardStart();
    }
    // 毒雾伤害无视无敌帧：复活无敌冲刺穿云不是预期解法
    if (this.inSpores(p.x, p.y) && p.shieldT <= 0) {
      if (p.hurt(this, true)) this.onHazardStart();
    }
    if (p.y > ROOM_H + 40) {
      if (p.hurt(this)) this.onHazardStart();
    }
  }

  private onHazardStart(): void {
    audio.hurt();
    this.particles.burst(this.player.x, this.player.y, 16, {
      speed: 60,
      color: "#e8c878",
      life: 0.6,
      grav: 140,
    });
  }

  recordSafeSpot(): void {
    const p = this.player;
    // 只在"确实站稳、周围没有危险"时记录，避免读档点在尖刺/毒雾边
    if (this.nearSpores(p.x, p.y)) return;
    for (const [dx, dy] of [
      [-4, -5],
      [4, -5],
      [-4, 5],
      [4, 6],
      [0, 0],
    ] as const) {
      if (this.spikeAtPx(p.x + dx, p.y + dy)) return; // 瓦片尖刺与地刺物件都算
    }
    this.lastSafeX = p.x;
    this.lastSafeY = p.y;
  }

  finishRespawn(): void {
    const p = this.player;
    if (p.hp <= 0) {
      // 血尽：回满血回到最近激活的存档花；一株都没激活过=**直接回出生点房间**
      // （此前 checkpoint 为 null 时只传送坐标不换房——人会"在当前房间复活"）
      p.hp = p.maxHp;
      const [scx, scy] = SPAWN.room.split(",").map(Number);
      const cp = this.checkpoint;
      const room = cp ? cp.room : ([scx, scy] as [number, number]);
      const x = cp ? cp.x : SPAWN.x;
      const y = cp ? cp.y : SPAWN.y;
      if (room[0] !== this.cx || room[1] !== this.cy) {
        this.loadRoom(room[0], room[1]);
      }
      p.finishRespawnAt(x, y);
      this.entryX = x;
      this.entryY = y;
      this.lastSafeX = x;
      this.lastSafeY = y;
      this.snapCamera();
      return;
    }
    p.finishRespawnAt(this.lastSafeX, this.lastSafeY);
  }

  // Player.WorldLike 回调
  onJump(): void {
    audio.jump();
    this.dust(this.player.x, this.player.y + 4, 3);
  }
  onLand(impact: number): void {
    if (impact > 60) {
      audio.land();
      this.dust(this.player.x - 2, this.player.y + 4, 3);
      this.dust(this.player.x + 2, this.player.y + 4, 3);
    }
  }
  onSwingRelease(): void {
    audio.release();
  }
  onShieldExit(): void {
    this.dust(this.player.x, this.player.y, 3);
  }
  onAttach(): void {
    audio.attach();
  }
  onHurt(): void {
    this.hurtFlashT = 0.45; // 掉血红闪（HUD 之上的一层淡红罩）
  }
  dust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.particles.spawn({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 20,
        vy: -10 - Math.random() * 10,
        life: 0.35,
        color: "#5a6a72",
      });
    }
  }

  playerWhipConsumed(target: object): boolean {
    return this.whipConsumed.has(target);
  }
  markWhipHit(target: object): void {
    this.whipConsumed.add(target);
  }

  /** 藤鞭扫击判定：本步鞭身扇面与目标矩形相交，且玩家到目标之间没有实心（不隔墙打到）。 */
  whipHits(rect: Rect): boolean {
    const hit = this.player.whipSegs().some((seg) => segRectHit(seg, rect));
    if (!hit) return false;
    // 采样到矩形"离玩家最近的边界点"为止：鞭子捅进目标内部不算隔墙，又能挡住隔墙命中
    const qx = Math.max(rect.x, Math.min(this.player.x, rect.x + rect.w));
    const qy = Math.max(rect.y, Math.min(this.player.y, rect.y + rect.h));
    return !this.lineBlocked(this.player.x, this.player.y, qx, qy);
  }

  /** 两点之间是否隔着实心（按 5px 步进采样；端点本身不采样）。 */
  private lineBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAtPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
    }
    return false;
  }

  openDoor(id: string): void {
    this.flags.add(`door:${id}`);
    audio.doorOpen();
    this.saveGame();
  }

  // ---- 触发：开关/压力板 → 被控物件（门 id / 电梯·睡莲 bind）。多对多：controls 列表逐个发 ----
  // 一个物件可被多个开关控制：任一触发即生效（门 OR 开、电梯/睡莲各吃自己的边沿脉冲）。

  private triggerTTL = new Map<string, number>(); // 触发目标 → 到期时刻（this.time 秒）

  /** 触发方（开关/压力板）的 fire 核心：往 controls 里的每个被控对象发触发。 */
  fireControls(controls: readonly string[], kind: "door" | "mover", reset: number | undefined): void {
    for (const id of controls) {
      if (kind === "mover") {
        // 电梯/睡莲是边沿触发：永远喂 TTL 脉冲（一次性=常驻让它动一趟；复位=到期自己停）
        this.pressTrigger(id, reset ?? TRIGGER_HOLD);
        continue;
      }
      if (reset != null) {
        // 门 + 复位开关：瞬时——触发期间开着，到期自动关（门自己查总线长回）
        this.pressTrigger(id, reset);
      } else {
        // 门 + 一次性开关：永久 flag
        this.flags.add(`door:${id}`);
        this.openDoor(id);
      }
    }
    if (kind === "door" && reset == null) this.saveGame();
  }

  pressTrigger(id: string, reset: number): void {
    this.triggerTTL.set(id, this.time + reset);
  }

  triggerActive(id: string): boolean {
    const t = this.triggerTTL.get(id);
    if (t === undefined) return false;
    if (t <= this.time) {
      this.triggerTTL.delete(id);
      return false;
    }
    return true;
  }

  toast(item: ItemId): void {
    this.toastT = 2.6;
    this.toastItem = item;
  }

  depth(): number {
    return Math.min(1, Math.max(0, this.cy / 6));
  }

  // ---- 房间流转 ----

  private checkTransitions(): void {
    const p = this.player;
    let ncx = this.cx;
    let ncy = this.cy;
    // 水平转只改 x（换到对侧），y 保持；垂直转只改 y，x 保持——
    // 速度与朝向一个都不动，跳进新房间就是同一个抛物线的延续
    let nx = p.x;
    let ny = p.y;
    // 阈值要容得下一整个身位越出房间边缘，避免在边界上反复横跳
    if (p.x < -4) {
      ncx -= 1;
      nx = ROOM_W - 6;
    } else if (p.x > ROOM_W + 4) {
      ncx += 1;
      nx = 6;
    }
    if (p.y < -6) {
      ncy -= 1;
      ny = ROOM_H - 7;
    } else if (p.y > ROOM_H + 6) {
      ncy += 1;
      ny = 7;
    }
    if ((ncx !== this.cx || ncy !== this.cy) && ROOMS[`${ncx},${ncy}`]) {
      // 黑场眨眼：渐隐后瞬间换房。骑泡时**不做夹持**——泡泡正带着人越界上升，
      // 夹回边界会让"人+泡"在渐隐里突然下坠一截（ riding 相对位置其实没断，纯属视觉惊吓）
      this.fade = { t: 0, phase: "out", ncx, ncy, nx, ny };
      const rider = this.riddenBubble();
      if (!rider) {
        p.x = Math.max(2, Math.min(ROOM_W - 2, p.x));
        p.y = Math.max(4, Math.min(ROOM_H - 4, p.y));
      }
    } else if (ncx !== this.cx || ncy !== this.cy) {
      // 没有相邻房间：夹回（数据校验保证不发生，双保险）
      p.x = Math.max(4, Math.min(ROOM_W - 4, p.x));
      p.y = Math.max(6, Math.min(ROOM_H - 6, p.y));
    }
  }

  /** 黑透瞬间执行的真实换房：位置/嵌体/骑泡/存档一次性落定。 */
  private completeRoomSwap(): void {
    const f = this.fade!;
    const p = this.player;
    const oldPx = p.x;
    const oldPy = p.y;
    const rider = this.riddenBubble();
    this.loadRoom(f.ncx, f.ncy);
    // 落点若嵌进实心（跳斜了、贴着洞口边），就近找空位——优先保持"不变的轴"
    const spot = this.resolveEmbed(f.nx, f.ny);
    p.x = spot.x;
    p.y = spot.y;
    // 骑着的泡泡跟人一起搬家：寿命/破裂倒计时都是同一个对象，自然不重置
    if (rider) {
      rider.x += p.x - oldPx;
      rider.y += p.y - oldPy;
      this.room.entities.push(rider);
    }
    this.entryX = p.x;
    this.entryY = p.y;
    this.lastSafeX = p.x;
    this.lastSafeY = p.y;
    this.snapCamera();
    this.saveGame();
    f.phase = "in";
    f.t = 0;
  }

  /** 玩家正骑着上升的泡泡（跨房时随身携带）。 */
  private riddenBubble(): Bubble | null {
    for (const e of this.room.entities) {
      if (e instanceof Bubble && e.riding) return e;
    }
    return null;
  }

  /** 落点嵌入实心时按"上、下、左、右"由近及远找第一个空位；找不到就原样返回。 */
  private resolveEmbed(x: number, y: number): { x: number; y: number } {
    if (!this.embeddedAt(x, y)) return { x, y };
    for (let r = 2; r <= 60; r += 2) {
      for (const [dx, dy] of [[0, -r], [0, r], [-r, 0], [r, 0]] as const) {
        if (!this.embeddedAt(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
    return { x, y };
  }

  /** 幽魂碰身：掉 1 血、闪烁无敌 1s、原地击退——不再送回房间入口。血尽回存档花。 */
  wispTouch(wisp: { x: number; y: number }): void {
    const p = this.player;
    if (p.deadT > 0 || p.invuln > 0 || this.locked) return;
    const dir = Math.sign(p.x - wisp.x) || -p.facing;
    if (!p.hitSoft(this, dir * 95, -70)) return;
    audio.hurt();
    this.particles.burst(p.x, p.y, 14, {
      speed: 55,
      color: "#b8a8e8",
      life: 0.6,
      grav: -20,
    });
  }

  // ---- 存档花：激活=回满血+设为重生点；已激活的存档花之间可互相传送 ----

  /** 每帧扫描身旁的存档花并处理交互输入（在道具路由之前调用）。 */
  private updateSavepoint(input: Input): void {
    this.nearSave = null;
    const p = this.player;
    if (p.deadT > 0) return;
    for (const e of this.room.entities) {
      if (!(e instanceof SavePoint)) continue;
      if (Math.abs(e.x - p.x) <= 8 && Math.abs(e.y - p.y) <= 9) {
        this.nearSave = e;
        break;
      }
    }
    const sp = this.nearSave;
    if (!sp) return;
    if (this.useBuf > 0) {
      this.useBuf = 0;
      this.saveJustUsed = true;
      this.attuneSavepoint(sp);
      return;
    }
    if (sp.attuned && input.pressed("down") && this.spPos.size >= 2) {
      this.openTravel();
    }
  }

  /** 激活存档花：回满血、记为血尽重生点、登记传送落点、立刻写档。 */
  private attuneSavepoint(sp: SavePoint): void {
    sp.attuned = true;
    this.flags.add(`sp:${sp.flagKey}`);
    this.player.hp = this.player.maxHp;
    const pos = { room: [this.cx, this.cy] as [number, number], x: this.player.x, y: this.player.y };
    this.spPos.set(sp.flagKey, pos);
    this.checkpoint = pos;
    this.mapDirty = true; // 地图上的花点从暗变亮
    audio.pacify();
    this.particles.burst(sp.x, sp.y - 4, 16, {
      speed: 28,
      color: mat("savepoint").accent,
      life: 1.0,
      grav: -30,
    });
    this.saveGame();
  }

  private openTravel(): void {
    if (this.mapDirty) this.buildWorldMap();
    this.travelList = [...this.spPos.entries()]
      .map(([key, v]) => ({
        key,
        cx: v.room[0],
        cy: v.room[1],
        x: v.x,
        y: v.y,
        mx: (v.room[0] - this.mapMinCx) * 32 + Math.floor(v.x / 10),
        my: (v.room[1] - this.mapMinCy) * 18 + Math.floor(v.y / 10),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const here = this.travelList.find((t) => t.cx === this.cx && t.cy === this.cy);
    this.travelCursor = here
      ? { x: here.mx, y: here.my }
      : { x: (this.cx - this.mapMinCx) * 32 + 16, y: (this.cy - this.mapMinCy) * 18 + 9 };
    this.travelMode = true;
    this.mapOpen = true; // 传送选花直接在地图面板上做
    this.mapPanX = 0;
    this.mapPanY = 0; // 视野先落在当前房间
    this.travelPanTX = 0;
    this.travelPanTY = 0;
    this.travelArmed = false; // 开传送的那一下方向键还按着：先不许连发
    this.useBuf = 0;
    audio.switchClick();
  }

  /** 光标正压着的存档花（若有）。 */
  private cursorSavepoint() {
    const c = this.travelCursor;
    if (!c) return undefined;
    // 精确命中优先；否则取 1.5 格内最近的花（光标不需要精确到像素点）
    return (
      this.travelList.find((t) => t.mx === c.x && t.my === c.y) ??
      this.travelList
        .filter((t) => Math.hypot(t.mx - c.x, t.my - c.y) <= 1.5)
        .sort((a, b) => Math.hypot(a.mx - c.x, a.my - c.y) - Math.hypot(b.mx - c.x, b.my - c.y))[0]
    );
  }

  /** 地图上选存档花：WASD 逐格移动光标，压住存档花后 J 确认黑场直达，Esc/Tab/K 取消。 */
  private updateTravelMap(): void {
    const input = this.input;
    if (this.travelList.length === 0 || !this.mapOpen || !this.travelCursor) {
      this.travelMode = false;
      this.mapOpen = false;
      return;
    }
    if (this.mapDirty) this.buildWorldMap();
    // QE 缩放（与地图查看同键）
    if (input.pressed("zoomIn")) this.mapZoom = Math.min(MAP_ZOOM_MAX, this.mapZoom + 1);
    if (input.pressed("zoomOut")) this.mapZoom = Math.max(MAP_ZOOM_MIN, this.mapZoom - 1);
    const maxX = this.mapCols * 32 - 1;
    const maxY = this.mapRows * 18 - 1;
    // 点按走一格；按住先短停顿再加速连发——远处存档花不用一格一格敲。
    // 保险：用 S 打开传送时 S 还按着，这里必须等它松开过一次才开始连发
    const edge =
      input.pressed("up") || input.pressed("down") || input.pressed("left") || input.pressed("right");
    const dirX = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    const dirY = (input.held("down") ? 1 : 0) - (input.held("up") ? 1 : 0);
    if (dirX === 0 && dirY === 0) {
      this.travelRepeat = 0;
      this.travelArmed = true;
    } else {
      this.travelRepeat -= 1 / 60;
      if (edge || (this.travelArmed && this.travelRepeat <= 0)) {
        this.travelRepeat = edge ? 0.22 : 0.035; // 连发 ≈28 格/秒
        this.travelCursor.x = Math.max(0, Math.min(maxX, this.travelCursor.x + dirX));
        this.travelCursor.y = Math.max(0, Math.min(maxY, this.travelCursor.y + dirY));
        audio.switchClick();
      }
    }
    // 吸附：光标**停住**时（无方向输入）落在存档花附近（≤2.5 格）→ 吸到花上。
    // 移动中绝不吸附——按住方向就能离开，不会"钉死"在花上；松手停稳才归位。
    if (dirX === 0 && dirY === 0) {
      let best: { mx: number; my: number } | null = null;
      let bestD = 2.5;
      for (const t of this.travelList) {
        const d = Math.hypot(t.mx - this.travelCursor.x, t.my - this.travelCursor.y);
        if (d > 0.01 && d <= bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) {
        this.travelCursor.x = best.mx;
        this.travelCursor.y = best.my;
      }
    }
    // ---- 视野跟随：光标贴到视野内侧舒适带边缘才连续滚动（pan 平滑插值，不瞬跳、不强制居中）----
    const z = this.mapZoom;
    const baseX = (this.cx - this.mapMinCx + 0.5) * 32;
    const baseY = (this.cy - this.mapMinCy + 0.5) * 18;
    const screenX = (this.travelCursor.x - (baseX + this.mapPanX)) * z + ROOM_W / 2;
    const screenY = (this.travelCursor.y - (baseY + this.mapPanY)) * z + ROOM_H / 2;
    const bandX0 = 48, bandX1 = ROOM_W - 48;
    const bandY0 = 32, bandY1 = ROOM_H - 32;
    if (screenX > bandX1) this.travelPanTX -= (screenX - bandX1) / z;
    if (screenX < bandX0) this.travelPanTX -= (screenX - bandX0) / z;
    if (screenY > bandY1) this.travelPanTY -= (screenY - bandY1) / z;
    if (screenY < bandY0) this.travelPanTY -= (screenY - bandY0) / z;
    const vw = ROOM_W / this.mapZoom;
    const vh = ROOM_H / this.mapZoom;
    const worldW = this.mapCols * 32;
    const worldH = this.mapRows * 18;
    const clampPan = (p: number, view: number, world: number, base: number): number => {
      if (world <= view) return 0;
      const lo = view / 2 - base;
      const hi = world - view / 2 - base;
      return Math.max(lo, Math.min(hi, p));
    };
    this.travelPanTX = clampPan(this.travelPanTX, vw, worldW, baseX);
    this.travelPanTY = clampPan(this.travelPanTY, vh, worldH, baseY);
    this.mapPanX += (this.travelPanTX - this.mapPanX) * 0.3;
    this.mapPanY += (this.travelPanTY - this.mapPanY) * 0.3;
    if (input.pressed("map") || input.pressed("jump")) {
      this.travelMode = false;
      this.mapOpen = false;
      this.useBuf = 0;
      return;
    }
    if (input.pressed("confirm") || this.useBuf > 0) {
      const t = this.cursorSavepoint();
      if (!t) return; // 光标没压住存档花：不确认，继续移动
      this.travelMode = false;
      this.mapOpen = false;
      this.useBuf = 0;
      // 复用房间黑场眨眼：传送用更从容的过场（0.32s 单程），黑透瞬间落进目标花的激活位置
      this.fade = { t: 0, phase: "out", ncx: t.cx, ncy: t.cy, nx: t.x, ny: t.y, dur: 0.32 };
      audio.doorOpen();
    }
  }


  /** 玩家判定盒在该点是否与任何实心重叠。 */
  private embeddedAt(x: number, y: number): boolean {
    for (const [dx, dy] of [
      [-3, -3.9],
      [3, -3.9],
      [-3, 3.9],
      [3, 3.9],
      [0, 0],
    ]) {
      if (this.solidAtPx(x + dx, y + dy)) return true;
    }
    return false;
  }

  dynamicSolids(): { x: number; y: number; w: number; h: number }[] {
    return this.room.solids;
  }

  private snapCamera(): void {
    this.camX = this.cx * ROOM_W;
    this.camY = this.cy * ROOM_H;
  }

  // ---- 结局 ----

  startEnding(): void {
    this.ending = true;
    this.endingT = 0;
    audio.ending();
    this.particles.burst(this.player.x, this.player.y, 24, {
      speed: 50,
      color: "#ffe9a8",
      life: 1.2,
      grav: -30,
    });
  }

  // ---- 绘制 ----

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.epilogue) {
      this.drawEpilogue(ctx);
      return;
    }
    this.drawScene(ctx);

    if (this.ending && this.endingT > 2.2) {
      const a = Math.min(1, (this.endingT - 2.2) / 1.6);
      ctx.fillStyle = `rgba(244, 248, 240, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    }

    this.drawHud(ctx);
    if (this.mapOpen) this.drawMap(ctx);
  }

  /** 场景层（背景→实体→光照→氛围层），不含 HUD。房间切换时也用它抓旧房快照。 */
  private drawScene(ctx: CanvasRenderingContext2D): void {
    const decor = this.room.decor;
    const lightPal = paletteFor(GLOBAL_LIGHT_DEPTH);
    const resX = this.camX - this.cx * ROOM_W;
    const resY = this.camY - this.cy * ROOM_H;
    ctx.fillStyle = decor.palette.bgBase;
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    decor.drawBackground(ctx, resX, resY, this.time);

    // 场景以房间局部坐标绘制，这里取相机相对当前房间原点的残差：
    // 静止时为 0，房间切换时恰好是两房间原点之差，形成平移过渡
    ctx.save();
    ctx.translate(-Math.round(resX), -Math.round(resY));

    decor.drawFlora(ctx, this.time);
    this.drawTiles(ctx, decor.palette);
    decor.drawTileDecor(ctx, this.time);
    decor.drawMotes(ctx, this.time);
    const drawEnt = (e: Entity): void => {
      const k = e.scale ?? 1;
      if (k === 1) {
        e.draw(ctx, this);
        return;
      }
      // 围绕实体锚点（x,y）缩放：纯视觉，判定不变
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(k, k);
      ctx.translate(-e.x, -e.y);
      e.draw(ctx, this);
      ctx.restore();
    };
    for (const e of this.room.entities) {
      if (e instanceof SporeCloud || e instanceof Flower) drawEnt(e);
    }
    for (const e of this.room.entities) {
      if (!(e instanceof SporeCloud || e instanceof Flower)) drawEnt(e);
    }
    // 空笼跨房挂载的载具：坐标在其所属房间系里，按房间差平移绘制（跨界时恰好出入画面边缘）
    for (const el of this.detached) {
      const [hx, hy] = el.homeKey.split(",").map(Number);
      ctx.save();
      ctx.translate((hx - this.cx) * ROOM_W, (hy - this.cy) * ROOM_H);
      drawEnt(el);
      ctx.restore();
    }
    if (!this.hidePlayer) {
      this.player.drawSwingRope(ctx);
      this.player.draw(ctx);
    }
    this.particles.draw(ctx);

    ctx.restore();

    // 光照。光源坐标是房间局部的，先统一换算成世界坐标再交给光照层
    const ox = this.cx * ROOM_W;
    const oy = this.cy * ROOM_H;
    const pal = decor.palette;
    const lights: Light[] = (this.room.def.lights ?? []).map((l) => ({
      x: l.x + ox,
      y: l.y + oy,
      r: l.r,
      tint: pal.shaft,
    }));
    // 玩家灯光：暖烛火（双正弦闪烁）——金光是种子在井里唯一的体温
    const px = this.player.x + ox;
    const py = this.player.y + oy;
    const flicker = Math.sin(this.time * 11) * 2.2 + Math.sin(this.time * 5.3) * 1.8;
    const pg = this.debugPlayerGlow;
    lights.push({
      x: px,
      y: py,
      r: 78 + flicker,
      tint: "215,168,92",
      strength: pg,
    });
    lights.push({
      x: px,
      y: py,
      r: 30 + flicker * 0.45,
      tint: "220,175,105",
      strength: Math.min(1, pg * 1.08),
    });
    // 扫击中的鞭梢自带一小圈光——转多快都看得清它在哪
    if (this.player.whipT > 0) {
      const tip = this.player.whipSegs().at(-1);
      if (tip) lights.push({ x: tip.x1 + ox, y: tip.y1 + oy, r: 18, tint: "170,255,190" });
    }
    for (const e of this.room.entities) {
      const ls = e.lights ? e.lights(this) : [];
      if (ls.length) {
        for (const l of ls) lights.push({ x: l.x + ox, y: l.y + oy, r: l.r, tint: l.tint, strength: l.strength });
      } else {
        // 基础微光：仅剪影级存在感（微光=发光的一种，物件不该"发光"——鲜亮交给材质色彩）。
        // 强度取材质自发光但压低下限；真正的发光只有光源类（glowStrength 0.75+）
        const m = mat(e.matKey ?? "");
        const gs = Math.min(m.glowStrength, 0.2);
        lights.push({ x: e.x + ox, y: e.y + oy, r: 6 + 14 * gs, tint: m.glow, strength: gs * 0.5 });
      }
    }
    for (const l of decor.lights) lights.push({ x: l.x + ox, y: l.y + oy, r: l.r, tint: l.tint ?? pal.glow });
    // 地刺自发光：能杀角色的东西不许藏进黑暗里（小红光斑 + 错相呼吸脉冲）
    for (let ty = 0; ty < ROOM_H / 10; ty++) {
      for (let tx = 0; tx < ROOM_W / 10; tx++) {
        if (this.room.tiles.get(tx, ty) !== Tile.Spike) continue;
        const breathe = 0.68 + Math.sin(this.time * 3.2 + tx * 7 + ty * 13) * 0.12;
        lights.push({ x: tx * 10 + 5 + ox, y: ty * 10 + 6 + oy, r: 13, tint: "255,96,64", strength: breathe });
      }
    }
    if (this.ending) {
      lights.push({
        x: this.flowerX() + ox,
        y: this.flowerY() + oy,
        r: 40 + this.endingT * 220,
        tint: "255,220,140",
      });
    }
    const sd = this.debugSceneDark;
    // 场景底暗度 = 基础可见度 + 深度加成 + 调参。基础项压低：即使无光源、角色不在旁，
    // 场景物件也保持可辨认的剪影（用户反馈"几乎都看不见"）——光仍明显更亮，黑暗仍有层次。
    const dark = 0.60 + GLOBAL_LIGHT_DEPTH * 0.10 + sd * 0.22;
    this.lightPass.render(ctx, this.camX, this.camY, `rgba(${lightPal.dark}, ${dark.toFixed(3)})`, lights);
    // 自发光点缀（发光苔藓/萤火虫/蜡烛/晶石/吊灯）：叠在黑暗之上，阴翳里也读得到生机
    decor.drawGlowScene(ctx, this.time);
    decor.drawFog(ctx, this.time, GLOBAL_LIGHT_DEPTH);
    decor.drawShaftsFront(ctx, this.time);
    decor.drawDynamicGlow(ctx, this.time, GLOBAL_LIGHT_DEPTH);
    this.drawAmbientPulse(ctx, lightPal.glow, GLOBAL_LIGHT_DEPTH);
    decor.drawGrade(ctx);
    this.drawVignette(ctx, lightPal.dark, sd);
    this.drawPlayerGlow(ctx, pg);
    // 掉血红闪：受击瞬间全屏一层淡红，随 hurtFlashT 衰减
    if (this.hurtFlashT > 0) {
      ctx.fillStyle = `rgba(255, 72, 56, ${(this.hurtFlashT * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    }
    this.drawGrain(ctx);

    // 黑场眨眼遮罩：渐隐→换房→渐显，全程没有任何运动画面可供帧混叠
    if (this.fade) {
      const dur = this.fade.dur ?? FADE_T;
      const a = this.fade.phase === "out"
        ? Math.min(1, this.fade.t / dur)
        : Math.max(0, 1 - this.fade.t / dur);
      ctx.fillStyle = `rgba(3, 6, 9, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    }
  }

  // ---- 地图：全局地形视野——到访过的房间按真实瓦片 1px/格 烙进同一张连续地形图，
  // 没去过的地方是纯黑。没有房间框：视野以当前房间居中就是"你在这里"。
  // QE 缩放、WASD/方向键平移，看得多细由玩家自己定。----

  /** 把所有到访过的房间烙进一张连续的全局地形图（1px/格，按房增量重画）。 */
  private buildWorldMap(): void {
    const keys = Object.keys(ROOMS);
    const cxs = keys.map((k) => Number(k.split(",")[0]));
    const cys = keys.map((k) => Number(k.split(",")[1]));
    this.mapMinCx = Math.min(...cxs);
    this.mapMinCy = Math.min(...cys);
    this.mapCols = Math.max(...cxs) - this.mapMinCx + 1;
    this.mapRows = Math.max(...cys) - this.mapMinCy + 1;
    const c = (this.worldMap ??= document.createElement("canvas"));
    c.width = this.mapCols * 32;
    c.height = this.mapRows * 18;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    for (const [key, def] of Object.entries(ROOMS)) {
      if (!this.flags.has(`seen:${key}`)) continue; // 没去过的地方是黑的
      const [cx, cy] = key.split(",").map(Number);
      const ox = (cx - this.mapMinCx) * 32;
      const oy = (cy - this.mapMinCy) * 18;
      const pal = paletteFor(Math.min(1, Math.max(0, cy / 6)));
      for (let ty = 0; ty < 18; ty++) {
        for (let tx = 0; tx < 32; tx++) {
          const ch = def.map[ty][tx];
          if (ch === "#") {
            g.fillStyle = pal.rock[1]; // 岩壁按深度取色，整体比现场更暗——地图是"记忆"
            g.fillRect(ox + tx, oy + ty, 1, 1);
          }
        }
      }
      // 地刺物件（数据里已无 ^ 瓦片，刺全来自物件）：地图同样标出危险
      (def.objects ?? []).forEach((o) => {
        if (o.type !== "spike") return;
        g.fillStyle = "#6e3f3f";
        g.fillRect(ox + o.location.x, oy + o.location.y, Math.max(1, o.w ?? 1), 1);
      });
      if (def.objects?.some((o) => o.type === "flower")) {
        // 巨花标记：一粒金芽
        g.fillStyle = "#e8c878";
        g.fillRect(ox + 15, oy + 8, 2, 3);
        g.fillRect(ox + 14, oy + 7, 1, 1);
        g.fillRect(ox + 17, oy + 7, 1, 1);
      }
      // 存档花标记（序号与 loadRoom 的物件索引一致）：激活=亮绿花芯，未激活=暗点
      (def.objects ?? []).forEach((o, i) => {
        if (o.type !== "savepoint") return;
        const mx = ox + o.location.x;
        const my = oy + o.location.y;
        if (this.flags.has(`sp:${key}#${i}`)) {
          g.fillStyle = "#7fe8c0";
          g.fillRect(mx - 1, my - 1, 3, 3);
          g.fillStyle = "#eafff4";
          g.fillRect(mx, my, 1, 1);
        } else {
          g.fillStyle = "#3f6a5c";
          g.fillRect(mx, my, 2, 2);
        }
      });
    }
    this.mapDirty = false;
  }

  /** 地图打开期间的视图输入：QE 缩放、WASD/方向键平移（视野始终留在世界内）。 */
  private updateMapView(): void {
    const input = this.input;
    if (input.pressed("zoomIn")) this.mapZoom = Math.min(MAP_ZOOM_MAX, this.mapZoom + 1);
    if (input.pressed("zoomOut")) this.mapZoom = Math.max(MAP_ZOOM_MIN, this.mapZoom - 1);
    if (this.mapDirty) this.buildWorldMap();
    const vw = ROOM_W / this.mapZoom;
    const vh = ROOM_H / this.mapZoom;
    const baseCx = (this.cx - this.mapMinCx + 0.5) * 32;
    const baseCy = (this.cy - this.mapMinCy + 0.5) * 18;
    const pan = 130 / this.mapZoom / 60; // 平移速度（地图像素/步），随缩放同步
    const dx = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    const dy = (input.held("down") ? 1 : 0) - (input.held("up") ? 1 : 0);
    const clampPan = (p: number, view: number, world: number, base: number): number => {
      if (world <= view) return 0; // 全图都装得下，无需平移
      const lo = view / 2 - base;
      const hi = world - view / 2 - base;
      return Math.max(lo, Math.min(hi, p));
    };
    this.mapPanX = clampPan(this.mapPanX + dx * pan, vw, this.mapCols * 32, baseCx);
    this.mapPanY = clampPan(this.mapPanY + dy * pan, vh, this.mapRows * 18, baseCy);
  }

  private drawMap(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#04070a"; // 底即迷雾：没画出来的地方就是没去过
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    if (this.mapDirty) this.buildWorldMap();
    const world = this.worldMap!;
    const z = this.mapZoom;
    // 视口中心 = 当前房间中心 + 平移偏移；整图装得下就居中
    const cxw = (this.cx - this.mapMinCx + 0.5) * 32 + this.mapPanX;
    const cyw = (this.cy - this.mapMinCy + 0.5) * 18 + this.mapPanY;
    const destW = world.width * z;
    const destH = world.height * z;
    let destX = 160 - cxw * z;
    let destY = 90 - cyw * z;
    destX = destW <= ROOM_W ? (ROOM_W - destW) / 2 : Math.max(ROOM_W - destW, Math.min(0, destX));
    destY = destH <= ROOM_H ? (ROOM_H - destH) / 2 : Math.max(ROOM_H - destH, Math.min(0, destY));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(world, destX, destY, destW, destH);
    ctx.imageSmoothingEnabled = true;
    // 玩家所在：一粒闪动的光点（房间框不需要——居中即是所在）
    if (Math.sin(this.time * 6) > -0.3) {
      const px = destX + ((this.cx - this.mapMinCx) * 32 + this.player.x / 10) * z;
      const py = destY + ((this.cy - this.mapMinCy) * 18 + this.player.y / 10) * z;
      ctx.fillStyle = "#ffe9a8";
      ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
    }
    // 传送选花：WASD 光标（十字）+ 压住存档花时的高亮框
    if (this.travelMode && this.travelCursor) {
      const c = this.travelCursor;
      const sx = destX + c.x * z;
      const sy = destY + c.y * z;
      ctx.strokeStyle = "rgba(234, 255, 244, 0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy + 0.5);
      ctx.lineTo(sx + 5, sy + 0.5);
      ctx.moveTo(sx + 0.5, sy - 4);
      ctx.lineTo(sx + 0.5, sy + 5);
      ctx.stroke();
      const t = this.cursorSavepoint();
      if (t) {
        const pulse = 0.55 + Math.sin(this.time * 7) * 0.45;
        ctx.strokeStyle = `rgba(174, 240, 216, ${pulse.toFixed(2)})`;
        ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
        drawText(ctx, `GO? ${t.cx},${t.cy}`, sx + 6, sy - 5, 1, "#aef0d8");
      }
    }
    drawTextCentered(ctx, "MAP", 160, 8, 1, "#5a7268");
    if (this.travelMode) {
      drawTextCentered(ctx, "WASD MOVE . J GO ON FLOWER . ESC CANCEL", 160, 171, 1, "#aef0d8");
    } else {
      drawTextCentered(ctx, "Q/E ZOOM . WASD MOVE . TAB CLOSE", 160, 171, 1, "#3d5260");
    }
  }

  private flowerX(): number {
    for (const e of this.room.entities) if (e instanceof Flower) return e.x;
    return 160;
  }
  private flowerY(): number {
    for (const e of this.room.entities) if (e instanceof Flower) return e.y;
    return 100;
  }

  private grainCanvas: HTMLCanvasElement | null = null;

  /** 井内慢呼吸：群系色微光，让阴翳里仍有生命感。纯视觉。 */
  private drawAmbientPulse(ctx: CanvasRenderingContext2D, glowRgb: string, depth: number): void {
    const pulse = 0.5 + Math.sin(this.time * 0.5) * 0.22 + Math.sin(this.time * 0.19 + 1.4) * 0.14;
    const a = (0.010 + depth * 0.007) * pulse;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(160, 88, 24, 160, 92, 172);
    g.addColorStop(0, `rgba(${glowRgb},${a.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(${glowRgb},${(a * 0.38).toFixed(3)})`);
    g.addColorStop(1, `rgba(${glowRgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);
    ctx.restore();
  }

  /** 种子贴身暖光环——叠在暗角之后，保证角色始终从岩壁里被圈出来。纯视觉。 */
  private drawPlayerGlow(ctx: CanvasRenderingContext2D, strength: number): void {
    if (this.player.deadT > 0) return;
    const sx = this.player.x - (this.camX - this.cx * ROOM_W);
    const sy = this.player.y - (this.camY - this.cy * ROOM_H);
    const pulse = 0.9 + Math.sin(this.time * 4.4) * 0.1 + Math.sin(this.time * 7.1) * 0.04;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 36);
    g.addColorStop(0, `rgba(255,220,150,${(0.22 * pulse * strength).toFixed(3)})`);
    g.addColorStop(0.28, `rgba(255,198,118,${(0.10 * pulse * strength).toFixed(3)})`);
    g.addColorStop(0.62, `rgba(220,160,72,${(0.038 * pulse * strength).toFixed(3)})`);
    g.addColorStop(1, "rgba(200,140,50,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 36, sy - 36, 72, 72);
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, darkRgb: string, sceneDark = 0.68): void {
    const g = ctx.createRadialGradient(160, 88, 48, 160, 90, 210);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.45, `rgba(${darkRgb},${(0.05 + sceneDark * 0.04).toFixed(3)})`);
    g.addColorStop(1, `rgba(${darkRgb},${(0.30 + sceneDark * 0.12).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);
  }

  private drawGrain(ctx: CanvasRenderingContext2D): void {
    if (!this.grainCanvas) {
      const c = document.createElement("canvas");
      c.width = ROOM_W;
      c.height = ROOM_H;
      const g = c.getContext("2d")!;
      const img = g.createImageData(ROOM_W, ROOM_H);
      for (let i = 0; i < img.data.length; i += 4) {
        if (((i / 4) * 1103515245 + 12345) % 17 !== 0) continue;
        const n = 90 + ((i * 7) % 140);
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 28;
      }
      g.putImageData(img, 0, 0);
      this.grainCanvas = c;
    }
    ctx.globalAlpha = 0.24;
    ctx.drawImage(this.grainCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawTiles(ctx: CanvasRenderingContext2D, pal: Palette): void {
    const t = this.room.tiles;
    for (let cy = 0; cy < 18; cy++) {
      for (let cx = 0; cx < 32; cx++) {
        const tile = t.get(cx, cy);
        if (tile === Tile.Solid) {
          const above = t.get(cx, cy - 1);
          const below = t.get(cx, cy + 1);
          const left = t.get(cx - 1, cy);
          const right = t.get(cx + 1, cy);
          // 每格确定性斑驳：岩色按哈希混合，打破大色块的呆板
          const h = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
          ctx.fillStyle = h % 7 === 0 ? pal.rock[1] : h % 13 === 0 ? pal.rock[2] : pal.rock[0];
          ctx.fillRect(cx * 10, cy * 10, 10, 10);
          if (h % 4 === 0) {
            ctx.fillStyle = pal.rockDeep;
            ctx.fillRect(cx * 10 + (h % 7), cy * 10 + ((h >> 3) % 7), 2, 2);
          }
          if (h % 5 === 0) {
            ctx.fillStyle = pal.rock[1];
            ctx.fillRect(cx * 10 + (h % 6), cy * 10 + ((h >> 4) % 6), 3, 2);
          }
          if (h % 11 === 0) {
            ctx.fillStyle = pal.wet;
            ctx.fillRect(cx * 10 + ((h >> 2) % 8), cy * 10 + ((h >> 5) % 8), 1, 1);
          }
          if (h % 17 === 0) {
            ctx.fillStyle = pal.rockEdge;
            ctx.fillRect(cx * 10 + ((h >> 6) % 7), cy * 10 + ((h >> 2) % 6), 1, 3);
          }
          if (above !== Tile.Solid) {
            // 可站立沿：矿石浅边，和装饰草（后画、半透明）分开读
            ctx.fillStyle = pal.lip;
            ctx.fillRect(cx * 10, cy * 10, 10, 2);
            ctx.fillStyle = pal.rock[2];
            ctx.fillRect(cx * 10, cy * 10, 10, 1);
            if (h % 5 === 0) {
              ctx.fillStyle = pal.wet;
              ctx.fillRect(cx * 10 + (h % 8), cy * 10 + 1, 2, 1);
            }
          }
          if (below !== Tile.Solid && h % 3 === 0) {
            ctx.fillStyle = pal.rockDeep;
            ctx.fillRect(cx * 10 + (h % 8), cy * 10 + 9, 3, 1);
          }
          if (left !== Tile.Solid) {
            ctx.fillStyle = pal.rockDeep;
            ctx.fillRect(cx * 10, cy * 10, 1, 10);
          }
          if (right !== Tile.Solid) {
            ctx.fillStyle = pal.rockDeep;
            ctx.fillRect(cx * 10 + 9, cy * 10, 1, 10);
          }
        } else if (tile === Tile.Spike) {
          ctx.fillStyle = pal.spike;
          for (let i = 0; i < 3; i++) {
            const sx = cx * 10 + i * 3 + 1;
            const base = cy * 10 + 10;
            ctx.beginPath();
            ctx.moveTo(sx - 1.5, base);
            ctx.lineTo(sx, base - 6 - ((cx + i) % 2));
            ctx.lineTo(sx + 1.5, base);
            ctx.closePath();
            ctx.fill();
          }
          // 尖端高光：死东西要一眼认得出来
          ctx.fillStyle = "rgba(255, 240, 220, 0.5)";
          for (let i = 0; i < 3; i++) {
            const sx = cx * 10 + i * 3 + 1;
            const tipY = cy * 10 + 10 - 6 - ((cx + i) % 2);
            ctx.fillRect(sx - 1, tipY + 1, 1, 2);
          }
          ctx.fillStyle = pal.spikeBase;
          ctx.fillRect(cx * 10, cy * 10 + 8, 10, 2);
        }
      }
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    // 调试：左上角显示当前房间代号（配合编辑器/传送调试用）；血量占了一行，往下挪
    if (this.debug) {
      drawText(ctx, `${this.cx},${this.cy}`, 3, 12, 1, "#5a7268");
    }

    // 血量：左上角一排小红心（受伤暗掉，回存档花回满）
    for (let i = 0; i < this.player.maxHp; i++) {
      this.drawHeart(ctx, 5 + i * 8, 4, i < this.player.hp);
    }

    // 道具槽
    ITEM_ORDER.forEach((item, i) => {
      const x = 5 + i * 11;
      const y = 169;
      const owned = this.items.has(item);
      const active = this.activeItem === item;
      if (!owned) return;
      ctx.globalAlpha = active ? 1 : 0.5;
      ctx.fillStyle = "#0a1010";
      ctx.fillRect(x - 3, y - 3, 11, 11);
      ctx.fillStyle = active ? "#1a2a24" : "#12181c";
      ctx.fillRect(x - 2, y - 2, 9, 9);
      if (active) {
        ctx.strokeStyle = "#cfe8d8";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2.5, y - 2.5, 10, 10);
      } else {
        ctx.strokeStyle = "#3d5260";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2.5, y - 2.5, 10, 10);
      }
      drawItemGlyph(ctx, item, x, y - 1);
      ctx.globalAlpha = 1;
    });

    // 源种槽：10 个小点
    for (let i = 0; i < SEED_TOTAL; i++) {
      const x = 315 - i * 5;
      const got = this.seeds.has(i + 1);
      ctx.fillStyle = got ? "#6a4a20" : "#161c20";
      ctx.fillRect(x, 171, 3, 3);
      ctx.fillStyle = got ? "#ffe9a8" : "#2a3a42";
      ctx.fillRect(x, 172, 2, 2);
      if (got) {
        ctx.fillStyle = "#f4d98c";
        ctx.fillRect(x + 1, 171, 1, 1);
        ctx.fillStyle = "#7fd4a0";
        ctx.fillRect(x + 1, 170, 1, 1);
      }
    }

    // 拾取提示：道具图标 + 使用键
    if (this.toastT > 0 && this.toastItem) {
      const a = Math.min(1, this.toastT);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(6, 12, 16, 0.85)";
      ctx.fillRect(136, 8, 48, 14);
      ctx.strokeStyle = "#3d5260";
      ctx.strokeRect(136.5, 8.5, 47, 13);
      drawItemGlyph(ctx, this.toastItem, 142, 12);
      const useKey = keyLabel(this.input.getBindings().use[0]);
      drawText(ctx, useKey, 160, 12, 1, "#cfe8d8");
      ctx.globalAlpha = 1;
    }

    // 存档花交互提示：身旁有花时浮现（已激活的多了个传送入口）
    if (this.nearSave && !this.travelMode && this.player.deadT <= 0 && !this.fade && !this.paused) {
      const a = 0.55 + Math.sin(this.time * 5) * 0.25;
      ctx.globalAlpha = a;
      drawTextCentered(ctx, this.nearSave.attuned ? "J SAVE . S TRAVEL" : "J SAVE", 160, 152, 1, "#aef0d8");
      ctx.globalAlpha = 1;
    }

    // 暂停
    if (this.paused) {
      ctx.fillStyle = "rgba(2, 6, 10, 0.75)";
      ctx.fillRect(0, 0, ROOM_W, ROOM_H);
      drawTextCentered(ctx, "PAUSED", 160, 76, 2, "#cfe8d8");
      drawTextCentered(ctx, "ESC RESUME . T TITLE . M MUTE . TAB MAP", 160, 96, 1, "#5a7268");
    }
  }

  /** 5×5 像素小红心。on=false 画暗色空壳。 */
  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    ctx.fillStyle = on ? "#6a2018" : "#141014";
    ctx.fillRect(x, y, 5, 5);
    ctx.fillStyle = on ? "#e86450" : "#2a2024";
    ctx.fillRect(x + 1, y, 1, 1);
    ctx.fillRect(x + 3, y, 1, 1);
    ctx.fillRect(x, y + 1, 5, 2);
    ctx.fillRect(x + 1, y + 3, 3, 1);
    ctx.fillRect(x + 2, y + 4, 1, 1);
    if (on) {
      ctx.fillStyle = "#ffb09a";
      ctx.fillRect(x + 1, y + 1, 1, 1);
      ctx.fillStyle = "#8a3028";
      ctx.fillRect(x + 3, y + 2, 1, 1);
    }
  }

  private drawEpilogue(ctx: CanvasRenderingContext2D): void {
    const t = this.epilogueT;
    ctx.fillStyle = "#04080b";
    ctx.fillRect(0, 0, ROOM_W, ROOM_H);

    // 一粒种子缓缓落下
    const fall = Math.min(1, t / 1.8);
    const ease = 1 - Math.pow(1 - fall, 2);
    const sy = -10 + ease * 128;
    if (t < 4.2) {
      ctx.fillStyle = "#e8c878";
      ctx.fillRect(158, Math.round(sy), 4, 5);
      ctx.fillStyle = "#7fd4a0";
      ctx.fillRect(161, Math.round(sy) - 2, 1, 2);
    }

    // 落地后抽芽
    if (t > 1.9) {
      const grow = Math.min(1, (t - 1.9) / 1.6);
      const h = Math.round(grow * 16);
      ctx.strokeStyle = "#4c8a5e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(160, 146);
      ctx.quadraticCurveTo(158, 146 - h / 2, 160, 146 - h);
      ctx.stroke();
      if (grow > 0.5) {
        const lf = (grow - 0.5) * 2;
        ctx.fillStyle = "#7fd4a0";
        ctx.fillRect(160 - Math.round(lf * 4), 146 - h + 2, Math.round(lf * 4), 1);
        ctx.fillRect(161, 146 - h + 4, Math.round(lf * 4), 1);
      }
    }

    // 标题浮现
    if (t > 3.4) {
      const a = Math.min(1, (t - 3.4) / 1);
      ctx.globalAlpha = a;
      drawTextCentered(ctx, "PLANT", 160, 52, 3, "#cfe8d8");
      drawTextCentered(ctx, "WELL", 160, 72, 3, "#cfe8d8");
      drawTextCentered(ctx, "THE WELL BLOOMS", 160, 96, 1, "#5a7268");
      if (t > 4.5) {
        const blink = Math.sin(t * 4) > 0;
        if (blink) drawTextCentered(ctx, "J", 160, 130, 1, "#8fa3ad");
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- 调试 ----

  debugGrantAll(): void {
    this.items = new Set(ITEM_ORDER);
    this.activeItem = "whip";
    for (let i = 1; i <= SEED_TOTAL; i++) this.seeds.add(i);
  }

  debugTeleport(dir: -1 | 1): void {
    const keys = Object.keys(ROOMS);
    const cur = keys.indexOf(`${this.cx},${this.cy}`);
    const key = keys[(cur + dir + keys.length) % keys.length];
    this.debugGoto(key);
  }

  /** 电梯等载具跨房投递：直接落到目标房间坐标（作为乘坐的一部分，无黑场）。 */
  relocatePlayer(roomKey: string, x: number, y: number): void {
    if (!ROOMS[roomKey]) return;
    const [rcx, rcy] = roomKey.split(",").map(Number);
    this.loadRoom(rcx, rcy);
    const spot = this.resolveEmbed(x, y);
    this.player.x = spot.x;
    this.player.y = spot.y;
    this.entryX = spot.x;
    this.entryY = spot.y;
    this.lastSafeX = spot.x;
    this.lastSafeY = spot.y;
    this.snapCamera();
  }

  /** 跨房电梯的中途交接：笼子越过房间边界的瞬间，把笼子（连乘客）迁入另一间并继续行程。
   *  shift = 目标房原点相对当前房的像素偏移（电梯自己算好传进来）。 */
  /** 电梯到站状态持久（默认行为）：停在哪端写进 flags（键 lift:<id>），跨房间/读档按它恢复。 */
  setLiftEnd(id: string, atFar: boolean): void {
    if (atFar) this.flags.add(`lift:${id}`);
    else this.flags.delete(`lift:${id}`);
  }

  handoffElevator(el: PitcherElevator, endRoom: string, shift: { x: number; y: number }): void {
    if (this.debug) this.debugLog.push(`t=${Math.round(this.time * 60)} handoff→${endRoom} carrying=${el.carrying}`);
    const [rcx, rcy] = endRoom.split(",").map(Number);
    if (!ROOMS[`${rcx},${rcy}`]) return;
    el.adopt(endRoom, shift, endRoom !== el.originKey ? true : false);
    if (el.carrying) {
      // 载客：世界（房间/镜头/乘客坐标）跟着笼子走
      this.player.x -= shift.x;
      this.player.y -= shift.y;
      this.loadRoom(rcx, rcy);
      // 回巢时 loadRoom 会从数据重建出同一台电梯的"原件"，和 adopt 回来的这只重叠成两只
      // （新实例 prevTrig=false，若触发仍有效会立刻幽灵发车）——摘掉同 id 的其他电梯，只留这只。
      this.room.entities = this.room.entities.filter(
        (e) => e === el || (e as { id?: unknown }).id !== el.id,
      );
      this.room.entities.push(el);
      // 入口/安全点先记到人身上（笼内位置），吐客落点才是最终位置
      this.entryX = this.player.x;
      this.entryY = this.player.y;
      this.lastSafeX = this.player.x;
      this.lastSafeY = this.player.y;
      this.snapCamera();
      return;
    }
    // 空笼：玩家的世界纹丝不动。目标房=玩家所在房 → 直接进驻当前实体表；
    // 否则摘下挂到 detached——在玩家视野外照常模拟（飞行/到站/返程计时），家房加载时自动归位。
    this.room.entities = this.room.entities.filter((e) => e !== el);
    this.detached = this.detached.filter((e) => e !== el);
    el.detached = !(rcx === this.cx && rcy === this.cy);
    if (el.detached) this.detached.push(el);
    else this.room.entities.push(el);
  }

  /** 调试深链（编辑器「运行游戏」用）：直达任意房间。 */
  debugGoto(key: string): void {
    if (!ROOMS[key]) return;
    const [cx, cy] = key.split(",").map(Number);
    this.loadRoom(cx, cy);
    const spot = this.findSafeSpot();
    this.player.spawnAt(spot.x, spot.y);
    this.lastSafeX = spot.x;
    this.lastSafeY = spot.y;
    this.entryX = spot.x;
    this.entryY = spot.y;
    this.snapCamera();
  }

  /** 调试传送用：找一个"脚下实心、无尖刺、不在毒雾里"的落点。 */
  private findSafeSpot(): { x: number; y: number } {    const t = this.room.tiles;
    for (const cx of [16, 8, 24, 4, 28, 12, 20]) {
      for (let cy = 1; cy < 17; cy++) {
        if (t.get(cx, cy) !== Tile.Air) continue;
        if (t.get(cx, cy + 1) !== Tile.Solid) continue;
        if (this.spikeAtPx(cx * 10 + 5, cy * 10 + 5)) continue; // 地刺物件上不当安全点
        if (t.get(cx, cy - 1) !== Tile.Air) continue;
        let safe = true;
        for (let dx = -1; dx <= 1 && safe; dx++) {
          for (let dy = -1; dy <= 2; dy++) {
            if (t.get(cx + dx, cy + dy) === Tile.Spike) {
              safe = false;
              break;
            }
          }
        }
        if (!safe) continue;
        const px = cx * 10 + 5;
        const py = cy * 10 + 5;
        if (this.inSpores(px, py)) continue;
        return { x: px, y: py };
      }
    }
    return { x: 160, y: 90 };
  }
}
