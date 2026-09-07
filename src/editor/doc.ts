// 编辑器文档：MAP_LIST 的内存深拷贝 + 撤销/重做 + 校验。
// 多地图：maps[] 是全部地图；editMapId 指正在编辑的图；gameMapId 指游戏采用（GAME_MAP_ID）的图。
// rooms/idOrder 两个 getter 永远指向「正在编辑的图」，编辑器其余代码照旧只管一间间房间（id=Rxx 是唯一房间标识）。
import { GAME_MAP_ID, MAP_LIST, normalizeRoomGeo } from "./dataBridge";
import { serializeMap } from "./exporter";
import { propByIdDoc } from "./mats";
import { num, type ObjRec } from "./palette";

export interface LightRec { x: number; y: number; r: number }
export interface RoomRec { id: string; x: number; y: number; map: string[]; /** 附着层（附着类物品 @ 等，空格=无）：与瓦片层独立 */ attach: string[]; objects: ObjRec[]; lights?: LightRec[]; roomColor?: string }
/** 出生点/地图元数据里的 room 是房间 id（"R05"），不是网格坐标。 */
export interface SpawnRec { room: string; x: number; y: number }
export interface MapRec {
  id: string;
  name: string;
  spawn: SpawnRec;
  /** 房间 id 顺序（新建序），下拉/遍历用它。 */
  idOrder: string[];
  /** 房间 id（"R05"）→ 房间记录。网格坐标在 rec.x/rec.y 上。 */
  rooms: Record<string, RoomRec>;
}
export interface Issue {
  level: "error" | "warn" | "info";
  msg: string;
  room?: string;
  x?: number;
  y?: number;
}

const COLS = 32;
const ROWS = 18;
const UNDO_MAX = 100;

export class EditorDoc {
  maps: MapRec[] = [];
  editMapId = "";
  gameMapId = "";
  dirty = false;
  /** 各地图装载时的序列化基线：保存只写与基线不同的文件；保存成功后更新基线。 */
  baseJson: Record<string, string> = {};
  baseGame = "";
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private subs: (() => void)[] = [];

  constructor() {
    this.resetFromSource();
  }

  /** 正在编辑的地图（editMapId 失效时兜底到游戏地图/第一张）。 */
  curMap(): MapRec {
    return this.maps.find((m) => m.id === this.editMapId) ?? this.maps.find((m) => m.id === this.gameMapId) ?? this.maps[0];
  }
  get idOrder(): string[] {
    return this.curMap().idOrder;
  }
  get rooms(): Record<string, RoomRec> {
    return this.curMap().rooms;
  }

  resetFromSource(): void {
    this.maps = MAP_LIST.map((def) => this.toRec(def));
    this.gameMapId = GAME_MAP_ID;
    this.editMapId = GAME_MAP_ID;
    this.baseJson = {};
    for (const m of this.maps) this.baseJson[m.id] = serializeMap(m);
    this.baseGame = GAME_MAP_ID;
    try {
      const last = localStorage.getItem("plantwell.editor.map");
      if (last && this.maps.some((m) => m.id === last)) this.editMapId = last;
    } catch {
      /* ignore */
    }
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.touch();
  }

  /** 与磁盘基线相比有改动的地图 id（新图没有基线=一定脏）。 */
  dirtyMapIds(): string[] {
    return this.maps.filter((m) => serializeMap(m) !== this.baseJson[m.id]).map((m) => m.id);
  }
  gameDirty(): boolean {
    return this.gameMapId !== this.baseGame;
  }
  /** 全部保存成功后调用：以当前内存内容为新的磁盘基线。 */
  markBasesClean(): void {
    for (const m of this.maps) this.baseJson[m.id] = serializeMap(m);
    this.baseGame = this.gameMapId;
  }

  private toRec(def: { id: string; name: string; spawn: SpawnRec; rooms: { id: string; x: number; y: number; map: string[]; attach?: string[]; objects?: ObjRec[]; lights?: LightRec[]; roomColor?: string }[] }): MapRec {
    const rec: MapRec = { id: def.id, name: def.name, spawn: { ...def.spawn }, idOrder: [], rooms: {} };
    for (const r of def.rooms) {
      rec.idOrder.push(r.id);
      const geo = normalizeRoomGeo(r.map, r.attach);
      rec.rooms[r.id] = {
        id: r.id,
        x: r.x,
        y: r.y,
        map: geo.map,
        attach: geo.attach,
        objects: (r.objects ?? []).map((o) => ({ ...o }) as ObjRec),
        lights: r.lights?.map((l) => ({ ...l })),
        roomColor: r.roomColor,
      };
    }
    return rec;
  }

  onChange(fn: () => void): void {
    this.subs.push(fn);
  }

  touch(): void {
    for (const fn of this.subs) fn();
  }

  markClean(): void {
    this.dirty = false;
    this.touch();
  }

  // ---- 撤销体系：整文档 JSON 快照（含全部地图；单图 KB 级，100 步无压力） ----

  snapshot(): string {
    return JSON.stringify({ maps: this.maps, editMapId: this.editMapId, gameMapId: this.gameMapId });
  }

  /** 旧版（单地图）自动存档不含 maps → 返回 false，调用方按没有备份处理。 */
  restoreSnapshot(json: string): boolean {
    const d = JSON.parse(json) as { maps?: MapRec[]; editMapId?: string; gameMapId?: string };
    if (!Array.isArray(d.maps) || !d.maps.length) return false;
    this.maps = d.maps;
    // 旧自动存档的房间可能缺 attach 字段：统一归一补齐（幂等）
    for (const m of this.maps) {
      for (const [rid, r] of Object.entries(m.rooms)) {
        m.rooms[rid] = { ...r, ...normalizeRoomGeo(r.map, r.attach) };
      }
    }
    this.editMapId = d.editMapId ?? d.maps[0].id;
    this.gameMapId = d.gameMapId ?? d.maps[0].id;
    this.dirty = true;
    this.touch();
    return true;
  }

  private pushUndo(pre: string): void {
    this.undoStack.push(pre);
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  /** 带撤销的一次变更。 */
  mutate(fn: () => void): void {
    const pre = this.snapshot();
    fn();
    this.pushUndo(pre);
    this.touch();
  }

  /** 拖拽/连刷等连续操作：开始时取快照，结束时一次性入栈。 */
  beginLive(): string {
    return this.snapshot();
  }

  commitLive(pre: string): void {
    this.pushUndo(pre);
    this.touch();
  }

  /** 放弃未提交的 live 变更（拖拽未移动等）。 */
  cancelLive(): void {
    this.touch();
  }

  undo(): boolean {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    return this.restoreSnapshot(this.undoStack.pop()!);
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    return this.restoreSnapshot(this.redoStack.pop()!);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // ---- 地图级操作 ----

  nextMapId(): string {
    const used = new Set(this.maps.map((m) => m.id));
    for (let n = 1; n < 100; n++) {
      const id = `M${String(n).padStart(2, "0")}`;
      if (!used.has(id)) return id;
    }
    return `M${Date.now() % 1000}`;
  }

  /** 新建地图：一张封闭边框的起始房 + 出生点落在这里，随后切过去编辑。 */
  addMap(): string {
    const id = this.nextMapId();
    this.mutate(() => {
      const m: MapRec = { id, name: `新地图 ${id}`, spawn: { room: "", x: 160, y: 90 }, idOrder: [], rooms: {} };
      this.maps.push(m);
      this.editMapId = id;
      this.buildStarterRoom(m);
      m.spawn.room = m.rooms[m.idOrder[0]].id;
    });
    return id;
  }

  deleteMap(id: string): boolean {
    if (this.maps.length <= 1 || !this.maps.some((m) => m.id === id)) return false;
    this.mutate(() => {
      this.maps = this.maps.filter((m) => m.id !== id);
      if (this.gameMapId === id) this.gameMapId = this.maps[0].id;
      if (this.editMapId === id) this.editMapId = this.gameMapId;
    });
    return true;
  }

  renameMap(id: string, name: string): void {
    this.mutate(() => {
      const m = this.maps.find((mm) => mm.id === id);
      if (m && name.trim()) m.name = name.trim();
    });
  }

  /** 设为游戏地图（保存时写进 GAME_MAP_ID）。 */
  setGameMap(id: string): void {
    if (!this.maps.some((m) => m.id === id) || this.gameMapId === id) return;
    this.mutate(() => {
      this.gameMapId = id;
    });
  }

  switchMap(id: string): boolean {
    if (!this.maps.some((m) => m.id === id) || id === this.editMapId) return false;
    this.mutate(() => {
      this.editMapId = id;
    });
    try {
      localStorage.setItem("plantwell.editor.map", id);
    } catch {
      /* ignore */
    }
    return true;
  }

  private buildStarterRoom(m: MapRec): void {
    const border = "#".repeat(COLS);
    const rid = this.nextRoomId(m);
    m.idOrder.push(rid);
    m.rooms[rid] = { id: rid, x: 0, y: 0, map: Array.from({ length: ROWS }, () => border), attach: Array.from({ length: ROWS }, () => " ".repeat(COLS)), objects: [] };
  }

  private nextRoomId(m: MapRec): string {
    const used = new Set(Object.values(m.rooms).map((r) => r.id));
    let n = 1;
    while (used.has(`R${String(n).padStart(2, "0")}`)) n++;
    return `R${String(n).padStart(2, "0")}`;
  }

  /** 本图内 网格坐标 → 房间 id（邻接判定用）。 */
  roomAt(m: MapRec, x: number, y: number): RoomRec | undefined {
    for (const r of Object.values(m.rooms)) if (r.x === x && r.y === y) return r;
    return undefined;
  }

  // ---- 房间级操作（都落在正在编辑的地图上） ----

  room(id: string): RoomRec | undefined {
    return this.rooms[id];
  }

  /** 出生点（room 即房间 id；id 已失效时兜底第一间房）。 */
  spawn(): SpawnRec & { room: string } {
    const m = this.curMap();
    const room = m.rooms[m.spawn.room] ? m.spawn.room : m.idOrder[0] ?? "";
    return { room, x: m.spawn.x, y: m.spawn.y };
  }

  /** 出生点原始数据（room = 房间 id，导出/编辑用）。 */
  spawnRaw(): SpawnRec {
    return { ...this.curMap().spawn };
  }

  setSpawnRoom(id: string): void {
    const m = this.curMap();
    if (!m.rooms[id]) return;
    this.mutate(() => {
      m.spawn.room = id;
    });
  }

  setSpawnPos(x: number, y: number): void {
    const m = this.curMap();
    this.mutate(() => {
      m.spawn.x = Math.max(0, Math.min(COLS * 10 - 1, Math.round(x)));
      m.spawn.y = Math.max(0, Math.min(ROWS * 10 - 1, Math.round(y)));
    });
  }

  /** 新建房间：网格坐标 (x,y) 处放一间封闭边框+全空气的新房，自动分配 Rxx id。成功返回 id。 */
  addRoom(x: number, y: number): string | null {
    const m = this.curMap();
    if (this.roomAt(m, x, y)) return null;
    const rid = this.nextRoomId(m);
    this.mutate(() => {
      const border = "#".repeat(COLS); // 四边全封闭（自己开洞）——首末行也必须是实心
      m.idOrder.push(rid);
      m.rooms[rid] = { id: rid, x, y, map: Array.from({ length: ROWS }, () => border), attach: Array.from({ length: ROWS }, () => " ".repeat(COLS)), objects: [] };
    });
    return rid;
  }

  deleteRoom(id: string): void {
    const m = this.curMap();
    if (!m.rooms[id]) return;
    this.mutate(() => {
      delete m.rooms[id];
      m.idOrder = m.idOrder.filter((k) => k !== id);
    });
  }

  // ---- 导入 / 导出（单张地图，JSON 文件） ----

  /** 当前编辑图的导出内容（与 maps/<id>.json 存储格式完全相同）。 */
  exportMap(): string {
    return serializeMap(this.curMap());
  }

  /** 导入一张地图：id 撞车自动顺延；网格键撞车后者覆盖（会警告）。成功后切过去编辑。 */
  importMap(text: string): { ok: boolean; error?: string; warn?: string } {
    let d: { kind?: string; id?: string; name?: string; spawn?: SpawnRec; rooms?: unknown[] };
    try {
      d = JSON.parse(text);
    } catch {
      return { ok: false, error: "不是合法的 JSON 文件" };
    }
    if (d.kind !== "plantwell-map" || !Array.isArray(d.rooms) || !d.rooms.length) {
      return { ok: false, error: "不是 Plant Well 地图文件（缺 kind/rooms）" };
    }
    const id = this.nextMapId();
    const name = typeof d.name === "string" && d.name.trim() ? d.name.trim() : `导入地图 ${id}`;
    const spawn: SpawnRec =
      d.spawn && typeof d.spawn.room === "string"
        ? { room: d.spawn.room, x: Number(d.spawn.x) || 0, y: Number(d.spawn.y) || 0 }
        : { room: "", x: 160, y: 90 };
    const rec: MapRec = { id, name, spawn, idOrder: [], rooms: {} };
    let dropped = 0;
    for (const raw of d.rooms) {
      const r = raw as { id?: unknown; x?: unknown; y?: unknown; map?: unknown; attach?: unknown; objects?: unknown; lights?: unknown; roomColor?: unknown };
      if (typeof r.id !== "string" || !/^[A-Z0-9]{3}$/.test(r.id) || !Array.isArray(r.map)) {
        dropped++;
        continue;
      }
      const x = Number(r.x);
      const y = Number(r.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        dropped++;
        continue;
      }
      if (rec.rooms[r.id]) dropped++; // id 撞车：后者丢弃
      rec.idOrder.push(r.id);
      // 旧格式地图：内联 @ 摘到附着层；attach 缺省/形状不齐时补齐
      const geo = normalizeRoomGeo((r.map as unknown[]).map(String), Array.isArray(r.attach) ? (r.attach as string[]) : undefined);
      rec.rooms[r.id] = {
        id: r.id,
        x,
        y,
        map: geo.map,
        attach: geo.attach,
        objects: Array.isArray(r.objects) ? (r.objects as ObjRec[]) : [],
        lights: Array.isArray(r.lights) ? (r.lights as LightRec[]) : undefined,
        roomColor: typeof r.roomColor === "string" ? r.roomColor : undefined,
      };
    }
    if (!rec.idOrder.length) return { ok: false, error: "地图里没有可用房间" };
    if (!rec.rooms[spawn.room]) spawn.room = rec.rooms[rec.idOrder[0]].id;
    this.mutate(() => {
      this.maps.push(rec);
      this.editMapId = id;
    });
    try {
      localStorage.setItem("plantwell.editor.map", id);
    } catch {
      /* ignore */
    }
    return { ok: true, warn: dropped ? `有 ${dropped} 个房间无效/坐标撞车被丢弃` : undefined };
  }

  // ---- 校验：与 scripts/validate-rooms.ts 同源，另加编辑器专属提示 ----

  validate(): Issue[] {
    const loc = (o: object): { x: number; y: number } => {
      const v = (o as { location?: { x?: unknown; y?: unknown } }).location;
      return { x: typeof v?.x === "number" ? v.x : 0, y: typeof v?.y === "number" ? v.y : 0 };
    };
    const issues: Issue[] = [];
    const push = (level: Issue["level"], msg: string, room?: string, x?: number, y?: number) =>
      issues.push({ level, msg, room, x, y });

    // 地图级：id 格式/唯一、游戏地图存在、出生点可解析
    const seenMapIds = new Set<string>();
    for (const m of this.maps) {
      if (!/^[A-Z0-9]{2,4}$/.test(m.id)) push("error", `地图 id "${m.id}" 非法（2~4 位大写字母/数字）`);
      else if (seenMapIds.has(m.id)) push("error", `地图 id ${m.id} 重复`);
      else seenMapIds.add(m.id);
      if (!m.rooms[m.spawn.room]) {
        push("error", `地图 ${m.id} 的出生点房间 "${m.spawn.room}" 不存在`);
      } else if (m.spawn.x < 0 || m.spawn.x >= COLS * 10 || m.spawn.y < 0 || m.spawn.y >= ROWS * 10) {
        push("warn", `地图 ${m.id} 的出生点像素越界`);
      }
    }
    if (!seenMapIds.has(this.gameMapId)) push("error", `游戏地图 ${this.gameMapId} 不存在（「★ 设为游戏地图」选一张）`);
    const cur = this.curMap();
    if (cur.id !== this.gameMapId) push("info", `正在编辑 ${cur.name}（${cur.id}），游戏运行的是 ${this.gameMapId}`);

    for (const [key, def] of Object.entries(this.rooms)) {
      if (def.map.length !== ROWS) push("error", `应有 ${ROWS} 行，实际 ${def.map.length}`, key);
      if (def.roomColor != null && !/^#[0-9a-fA-F]{6}$/.test(def.roomColor)) push("error", "房间配色须是 #rrggbb", key);
      def.map.forEach((line, y) => {
        if (line.length !== COLS) push("error", `第 ${y} 行宽 ${line.length}，应为 ${COLS}`, key, 0, y);
        for (let x = 0; x < line.length; x++) {
          if (!"#.@*".includes(line[x])) push("error", `非法字符 '${line[x]}'（可用 # . @ *）`, key, x, y);
        }
      });
      // 附着层：18 行 × 32 列，只认 @ 与空格
      if (def.attach.length !== ROWS) push("error", `附着层应有 ${ROWS} 行，实际 ${def.attach.length}`, key);
      def.attach.forEach((line, y) => {
        if (line.length !== COLS) push("error", `附着层第 ${y} 行宽 ${line.length}，应为 ${COLS}`, key, 0, y);
        for (let x = 0; x < line.length; x++) {
          if (line[x] !== "@" && line[x] !== " ") push("error", `附着层非法字符 '${line[x]}'（可用 @ 与空格）`, key, x, y);
        }
      });

      const byEdge: Record<string, number[]> = {
        left: this.openings(def.map, "left"),
        right: this.openings(def.map, "right"),
        top: this.openings(def.map, "top"),
        bottom: this.openings(def.map, "bottom"),
      };

      const cx = def.x;
      const cy = def.y;
      const edges: [keyof typeof byEdge, number, number][] = [
        ["left", -1, 0],
        ["right", 1, 0],
        ["top", 0, -1],
        ["bottom", 0, 1],
      ];
      for (const [edge, dx, dy] of edges) {
        const nb = this.roomAt(this.curMap(), cx + dx, cy + dy);
        const mine = byEdge[edge];
        if (!nb) {
          if (mine.length) push("error", `${edge} 边有洞口但没有相邻房间，世界会漏`, key);
          continue;
        }
        // 洞口不要求两房配对：错位洞口（如右上阶梯跨房）是合法设计，
        // 游戏侧有房界缝合+落点择址兜底，是否连通由设计者自己把关
      }

      for (const o of def.objects) {
        if (o.type === "vine" && Array.isArray(o.lens)) {
          for (const L of o.lens as unknown[]) {
            // 与游戏同语义：显式值=实际长度（忽略 h）；0/-1=在 [hMin,h] 内随机
            if (typeof L !== "number" || L < -1) {
              push("error", "vine lens 每条须是 ≥ -1 的数（0/-1=随机）", key, loc(o).x, loc(o).y);
            }
          }
        }
        if (o.type === "vine" && o.hMin !== undefined) {
          const lo = num(o, "hMin");
          if (lo < 1 || lo > 18) push("error", "vine hMin 须在 1~18", key, loc(o).x, loc(o).y);
          else if (lo > num(o, "h")) push("warn", "vine hMin 大于 h（随机段会全长取 hMin，比 h 还长）", key, loc(o).x, loc(o).y);
        }
        if (o.type === "vine") {
          const vx = loc(o).x;
          const vy = loc(o).y;
          const above = def.map[vy - 1];
          if (!above || above[vx] !== "#" || above[vx + 1] !== "#") {
            push("error", "vine 顶部两格须都是实心天花板", key, vx, vy);
          }
          const lensArr = Array.isArray(o.lens) ? (o.lens as unknown[]).filter((v): v is number => typeof v === "number") : null;
          // 显式值=实际长度（可超 h）；含 -1 时随机段最长到 h——有效深度取两者最大
          const effH = lensArr && lensArr.length
            ? Math.max(lensArr.some((v) => v < 0) ? num(o, "h") : 1, ...lensArr.map((v) => Math.max(1, v)))
            : num(o, "h");
          for (let dy = 0; dy < effH; dy++) {
            const row = def.map[vy + dy];
            for (const dx of [0, 1]) {
              if (!row || row[vx + dx] !== ".") {
                // 藤无碰撞无伤害，垂落区插进岩层只是视觉穿帮——与校验脚本同口径，警告不拦
                push("warn", "vine 垂落区不是空气（藤尖会插进岩层）", key, vx + dx, vy + dy);
              }
            }
          }
        }
        if (o.type === "spike") {
          const below = def.map[loc(o).y + 1];
          if (below && below[loc(o).x] !== "#") {
            push("info", "地刺下方不是实心岩壁（悬浮尖刺可按需保留）", key, loc(o).x, loc(o).y);
          }
        }
        if (o.type === "plate") {
          const bx = loc(o).x;
          const by = loc(o).y;
          const below = def.map[by + 1];
          if (!below || below[bx] !== "#") {
            push("info", "压力板下一格不是实心岩壁（通常应贴地放置）", key, bx, by);
          }
        }
      }
    }

    // 房间 id：3 位大写字母/数字（id 即房间键，Record 结构保证本图内唯一）；
    // 网格坐标：每格最多一间房（两间挤同一格是世界数据错误）。
    // 物件坐标的 room_id 必须能解析到本图某个房间。
    const seenIds = new Set<string>();
    for (const [rid, r] of Object.entries(this.rooms)) {
      if (!/^[A-Z0-9]{3}$/.test(rid)) push("error", `房间 id "${rid}" 非法（应为 3 位大写字母/数字）`, rid);
      else seenIds.add(rid);
      const twin = this.roomAt(this.curMap(), r.x, r.y);
      if (twin && twin.id !== rid) push("error", `房间 ${rid} 与 ${twin.id} 占同一网格 (${r.x},${r.y})`, rid);
    }
    const idList = [...seenIds];
    for (const rid of Object.keys(this.rooms)) {
      for (const o of this.rooms[rid]?.objects ?? []) {
        for (const pk of ["location", "end"]) {
          const v = o[pk] as { room_id?: unknown } | undefined;
          if (pk === "end" && !v) continue; // end 只有电梯/睡莲有
          const oid = typeof v?.room_id === "string" ? v.room_id : "";
          if (!oid) push("error", `${o.type} 的 ${pk}.room_id 为空`, rid, loc(o).x, loc(o).y);
          else if (!seenIds.has(oid)) {
            push("error", `${o.type} 的 ${pk}.room_id "${oid}" 不存在（房间 id: ${idList.join(" ")}）`, rid, loc(o).x, loc(o).y);
          }
        }
      }
    }
    // location.room_id 应指向物件所在房间：room_id 是数据自描述——填了别的房 id 说明数据乱了
    for (const rid of Object.keys(this.rooms)) {
      const def = this.rooms[rid];
      for (const o of def?.objects ?? []) {
        const v = (o as { location?: { room_id?: unknown } }).location;
        const lr = typeof v?.room_id === "string" ? v.room_id : "";
        if (lr && lr !== rid) push("warn", `${o.type} 的 location.room_id "${lr}" 不是本房 id "${rid}"`, rid, loc(o).x, loc(o).y);
      }
    }

    // 收集：可绑定 id（门/载具=被控方，开关/压力板=触发方，全部统一叫 id）、源种、道具
    const doorIds = new Set<string>();
    const dupDoors = new Set<string>();
    const seedIds = new Set<number>();
    const dupSeeds = new Set<number>();
    const controlledIds = new Set<string>();
    const triggerIds = new Set<string>();
    const items = new Set<string>();
    for (const [key, def] of Object.entries(this.rooms)) {
      for (const o of def.objects) {
        if (o.type === "door") {
          const id = String(o.id ?? "");
          if (doorIds.has(id)) dupDoors.add(id);
          doorIds.add(id);
          controlledIds.add(id);
        }
        if (o.type === "elevator" || o.type === "lilypad") {
          const id = String(o.id ?? "");
          if (id) {
            controlledIds.add(id);
          } else {
            push("error", `${o.type} 缺自身 id`, key, loc(o).x, loc(o).y);
          }
        }
        if (o.type === "switch" || o.type === "plate") {
          const id = String(o.id ?? "");
          if (id) {
            triggerIds.add(id);
          } else {
            push("error", `${o.type} 缺自身 id`, key, loc(o).x, loc(o).y);
          }
        }
        if (o.type === "seed") {
          const id = num(o, "id");
          if (seedIds.has(id)) dupSeeds.add(id);
          seedIds.add(id);
          if (id < 1 || id > 99) push("error", `源种编号 ${id} 非法（1~99）`, key, loc(o).x, loc(o).y);
        }
        if (o.type === "item") items.add(String(o.item));
        if (o.type === "prop" && !propByIdDoc(String(o.id ?? ""))) {
          push("warn", `引用了不存在的自定义物件 '${o.id ?? ""}'（新物品工坊里创建后才能放置）`, key, loc(o).x, loc(o).y);
        }
      }
    }
    for (const id of dupDoors) push("warn", `门 id '${id}' 重复`);
    for (const id of dupSeeds) push("error", `源种编号 ${id} 重复`);
    // 绑定（多对多，属性名统一为 id）：
    // 触发方 switch/plate: controls=它控制的被控物件 id 列表。
    // 被控方 door/elevator/lilypad: triggeredBy=触发它的开关/压力板 id 列表。
    for (const [key, def] of Object.entries(this.rooms)) {
      for (const o of def.objects) {
        if (o.type !== "switch" && o.type !== "plate") continue;
        const list = Array.isArray(o.controls) ? (o.controls as string[]) : [];
        if (!list.length) push("warn", `${o.type} 没绑定任何被控物件（用「绑定」点选门/电梯/睡莲）`, key, loc(o).x, loc(o).y);
        for (const cid of list) {
          if (!controlledIds.has(cid)) push("error", `${o.type} controls 里的 '${cid}' 不是任何门/电梯/睡莲的 id`, key, loc(o).x, loc(o).y);
        }
      }
    }
    // 被控方 triggeredBy 引用真实性（指向触发方 id）
    for (const [key, def] of Object.entries(this.rooms)) {
      for (const o of def.objects) {
        if (o.type !== "door" && o.type !== "elevator" && o.type !== "lilypad") continue;
        const tb = Array.isArray(o.triggeredBy) ? (o.triggeredBy as string[]) : [];
        for (const tid of tb) {
          if (!triggerIds.has(tid)) {
            push("error", `${o.type} triggeredBy 里的 '${tid}' 不是任何开关/压力板的 id`, key, loc(o).x, loc(o).y);
          }
        }
      }
    }
    if (seedIds.size) push("info", `源种共 ${seedIds.size} 颗`);
    for (const need of ["whip", "bubble", "flute", "bean"]) {
      if (!items.has(need)) push("info", `缺少道具 '${need}' 的拾取点`);
    }
    return issues;
  }

  openings(map: string[], side: "left" | "right" | "top" | "bottom"): number[] {
    const out: number[] = [];
    if (side === "left" || side === "right") {
      const x = side === "left" ? 0 : COLS - 1;
      for (let y = 0; y < ROWS; y++) if (map[y]?.[x] === ".") out.push(y);
    } else {
      const y = side === "top" ? 0 : ROWS - 1;
      for (let x = 0; x < COLS; x++) if (map[y]?.[x] === ".") out.push(x);
    }
    return out;
  }
}
