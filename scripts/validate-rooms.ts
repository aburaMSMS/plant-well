// 地图数据校验（Node 24 原生跑 TS）：全部地图逐张校验——形状/边界、房间 id、网格占位、
// 物件引用完整性、绑定对称性；"源种收集齐/道具齐全"这类通关性检查只对 ★游戏地图生效。
// 数据直读 JSON（src/data/gameMap.json + src/data/maps/*.json）——
// src/data/maps.ts 的 import.meta.glob 是 Vite 专属，Node 环境跑不了；派生逻辑在此本地重算。
// 模型（v41 起）：房间以 id（Rxx）为唯一标识；网格坐标 (x,y) 只是位置——错位洞口是合法设计
//（游戏侧房界缝合+落点择址兜底），不做洞口配对检查。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface RoomRec { id: string; x: number; y: number; map: string[]; objects?: any[] }
interface MapRec { id: string; name?: string; spawn: { room: string; x: number; y: number }; rooms: RoomRec[] }

const gameMeta = JSON.parse(readFileSync("src/data/gameMap.json", "utf8")) as { gameMapId: string };
const MAP_LIST: MapRec[] = readdirSync("src/data/maps")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join("src/data/maps", f), "utf8")));
const GAME_MAP_ID: string = gameMeta.gameMapId;
const GAME_MAP: MapRec = MAP_LIST.find((m) => m.id === GAME_MAP_ID) ?? MAP_LIST[0];

const COLS = 32;
const ROWS = 18;
let errors = 0;
let warnings = 0;
const fail = (msg: string) => {
  console.error("  ✗ " + msg);
  errors++;
};
// 警告：不拦构建/提交的提示项（刻意保留的数据选择、游戏会自行钳制的值）
const warn = (msg: string) => {
  console.warn("  ⚠ " + msg);
  warnings++;
};

// ---- 地图级：id 格式/唯一、出生点可解析 ----
{
  console.log(`MAP_LIST：${MAP_LIST.length} 张图，GAME_MAP_ID = ${GAME_MAP_ID}`);
  const seen = new Set<string>();
  for (const m of MAP_LIST) {
    if (!/^[A-Z0-9]{2,4}$/.test(m.id)) fail(`地图 id "${m.id}" 非法（2~4 位大写字母/数字）`);
    else if (seen.has(m.id)) fail(`地图 id ${m.id} 重复`);
    else seen.add(m.id);
    if (!m.rooms.length) warn(`地图 ${m.id} 没有任何房间`);
    if (!m.rooms.some((r) => r.id === m.spawn.room)) fail(`地图 ${m.id} 的出生点房间 "${m.spawn.room}" 不存在`);
  }
  if (!seen.has(GAME_MAP_ID)) fail(`GAME_MAP_ID "${GAME_MAP_ID}" 不在 MAP_LIST 里`);
  else console.log(`game map：${GAME_MAP.id}（${GAME_MAP.name ?? ""}，${GAME_MAP.rooms.length} 房）`);
}

// ---- 每张图逐张校验 ----
const gameObjects: any[] = [];
for (const m of MAP_LIST) {
  console.log(`map ${m.id}`);
  const rooms = new Map<string, RoomRec>(); // id → 房间
  const byPos = new Map<string, RoomRec>(); // 网格 → 房间
  for (const r of m.rooms) {
    if (rooms.has(r.id)) fail(`地图 ${m.id}：房间 id ${r.id} 重复`);
    rooms.set(r.id, r);
    const pk = `${r.x},${r.y}`;
    const twin = byPos.get(pk);
    if (twin) fail(`地图 ${m.id}：房间 ${r.id} 与 ${twin.id} 占同一网格 (${r.x},${r.y})`);
    byPos.set(pk, r);
  }

  for (const def of m.rooms) {
    const where = `${m.id}/${def.id}`;
    if (def.map.length !== ROWS) fail(`${where}: 应有 ${ROWS} 行，实际 ${def.map.length}`);
    def.map.forEach((line: string, y: number) => {
      if (line.length !== COLS) fail(`${where}: 第 ${y} 行应有 ${COLS} 字符，实际 ${line.length}`);
      for (const ch of line) {
        if (!"#.".includes(ch)) fail(`${where}: 第 ${y} 行有非法字符 '${ch}'（尖刺请用 objects 里的 spike 物件）`);
      }
    });

    if (!/^[A-Z0-9]{3}$/.test(def.id)) fail(`${where}: 房间 id 非法（应为 3 位大写字母/数字）`);
    if (def.x !== Math.trunc(def.x) || def.y !== Math.trunc(def.y)) fail(`${where}: 网格坐标 x/y 必须是整数`);
  }

  // 物件逐项：引用完整、位置在房内、room_id 自描述一致
  for (const def of m.rooms) {
    const where = `${m.id}/${def.id}`;
    (def.objects ?? []).forEach((o: any, i: number) => {
      const loc = o.location;
      if (loc) {
        const x = loc.x ?? -1;
        const y = loc.y ?? -1;
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
          fail(`${where}: 物件#${i} (${o.type}) location (${x},${y}) 越出房间`);
        }
        if (loc.room_id && loc.room_id !== def.id) {
          warn(`${where}: 物件#${i} (${o.type}) location.room_id "${loc.room_id}" 不是本房 id "${def.id}"`);
        }
      }
      for (const pk of ["location", "end"] as const) {
        const v = o[pk] as { room_id?: string } | undefined;
        if (pk === "end" && !v) continue; // end 只有电梯/睡莲有
        const rid = v?.room_id ?? "";
        if (!rid) fail(`${where}: ${o.type}#${i} 的 ${pk}.room_id 为空`);
        else if (!rooms.has(rid)) fail(`${where}: ${o.type}#${i} 的 ${pk}.room_id "${rid}" 不存在`);
      }
      if (o.type === "lilypad") {
        const end = o.end;
        if (end?.room_id && end.room_id !== def.id) {
          fail(`${where}: lilypad#${i} end.room_id "${end.room_id}" 跨房——睡莲不支持跨房，只有电梯支持`);
        }
      }
      if (o.type === "spike") {
        const w = Math.max(1, o.w ?? 1); // 游戏侧同款默认（省略 w = 1 格）
        if (o.location.x + w > COLS || o.location.y < 0 || o.location.y >= ROWS) {
          fail(`${where}: spike (${o.location.x},${o.location.y}) 宽 ${w} 越界`);
        } else {
          for (let dx = 0; dx < w; dx++) {
            if (def.map[o.location.y]?.[o.location.x + dx] !== ".") {
              fail(`${where}: spike (${o.location.x},${o.location.y}) 覆盖格 (${o.location.x + dx},${o.location.y}) 必须是空气`);
            }
          }
        }
      }
      if (o.type === "vine") {
        // 锚点：上一行两格都必须是实心天花板；垂落区：整段必须是空气
        const above = def.map[o.location.y - 1];
        if (!above || above[o.location.x] !== "#" || above[o.location.x + 1] !== "#") {
          fail(`${where}: vine (${o.location.x},${o.location.y}) 顶部两格必须都是实心天花板`);
        }
        // lens 语义：显式值=该条实际长度（忽略 h 上限）；-1=在 [hMin,h] 随机（不超过 h）
        const lensArr = Array.isArray(o.lens) ? o.lens : null;
        const effH =
          lensArr && lensArr.length
            ? Math.max(lensArr.some((v: number) => v < 0) ? o.h : 1, ...lensArr.map((v: number) => Math.max(1, v)))
            : o.h;
        for (let dy = 0; dy < effH; dy++) {
          const row = def.map[o.location.y + dy];
          for (const dx of [0, 1]) {
            if (!row || row[o.location.x + dx] !== ".") {
              // 藤无碰撞无伤害，垂落区插进岩层只是视觉穿帮——警告不拦
              warn(`${where}: vine (${o.location.x},${o.location.y}) 垂落区 (${o.location.x + dx},${o.location.y + dy}) 不是空气（藤尖会插进岩层）`);
            }
          }
        }
        if (o.h < 1 || o.location.y + o.h > ROWS) fail(`${where}: vine (${o.location.x},${o.location.y}) 长度 h=${o.h} 越界`);
        if (lensArr && lensArr.length > 6) warn(`${where}: vine lens ${lensArr.length} 条——游戏只长前 6 根`);
        if (lensArr) {
          for (const v of lensArr) {
            if (v < -1) fail(`${where}: vine lens 条目 ${v} 非法（须 ≥ -1）`);
            else if (!Number.isInteger(v)) warn(`${where}: vine lens 条目 ${v} 非整数`);
          }
        }
      }
    });
  }

  // ---- 绑定校验（多对多，属性名统一为 id）----
  const bindKind = new Map<string, "door" | "mover">();
  const trigIds = new Set<string>();
  const bindOwner = new Map<string, string>();
  for (const def of m.rooms) {
    (def.objects ?? []).forEach((o: any) => {
      const loc = o.location;
      const pos = `room ${def.id} ${o.type}@(${loc?.x},${loc?.y})`;
      if (o.type === "door" || o.type === "elevator" || o.type === "lilypad") {
        const id = o.id;
        if (!id) {
          fail(`${pos} 缺自身 id`);
          return;
        }
        if (bindKind.has(id) || trigIds.has(id)) fail(`id '${id}' 重复（${pos} vs ${bindOwner.get(id)}）`);
        bindKind.set(id, o.type === "door" ? "door" : "mover");
        bindOwner.set(id, pos);
      }
      if (o.type === "switch" || o.type === "plate") {
        const id = o.id;
        if (!id) {
          fail(`${pos} 缺自身 id`);
          return;
        }
        if (bindKind.has(id) || trigIds.has(id)) fail(`id '${id}' 重复（${pos} vs ${bindOwner.get(id)}）`);
        trigIds.add(id);
        bindOwner.set(id, pos);
      }
    });
  }
  for (const def of m.rooms) {
    (def.objects ?? []).forEach((o: any) => {
      if (o.type !== "switch" && o.type !== "plate") return;
      const controls: string[] = o.controls ?? [];
      if (!controls.length) warn(`room ${def.id}: ${o.type} '${o.id}' 没绑定任何被控物件（controls 为空）`);
      for (const id of controls) {
        const kind = bindKind.get(id);
        if (!kind) fail(`room ${def.id}: ${o.type} '${o.id}' controls 里的 '${id}' 不是任何门/电梯/睡莲的 id`);
      }
      for (const id of controls) {
        let mirrored = false;
        for (const d2 of m.rooms) {
          for (const o2 of d2.objects ?? []) {
            if (o2.type !== "door" && o2.type !== "elevator" && o2.type !== "lilypad") continue;
            if (o2.id === id && (o2.triggeredBy ?? []).includes(o.id)) mirrored = true;
          }
        }
        if (!mirrored) warn(`room ${def.id}: ${o.type} '${o.id}' 控制 '${id}'，但被控方没在 triggeredBy 回写 '${o.id}'`);
      }
    });
  }
  for (const def of m.rooms) {
    (def.objects ?? []).forEach((o: any) => {
      if (o.type !== "door" && o.type !== "elevator" && o.type !== "lilypad") return;
      for (const tid of o.triggeredBy ?? []) {
        if (!trigIds.has(tid)) {
          fail(`room ${def.id}: ${o.type} '${o.id}' triggeredBy 里的 '${tid}' 不是任何开关/压力板的 id`);
        }
      }
    });
  }

  // 游戏图额外收集：源种/道具（通关性检查只对 ★游戏地图）
  if (m.id === GAME_MAP_ID) {
    for (const def of m.rooms) for (const o of def.objects ?? []) gameObjects.push(o);
  }
}

// ---- 游戏图通关性：源种编号 1..N 连续、三类道具齐 ----
{
  const seedIds = new Set<number>();
  const foundItems = new Set<string>();
  let seedCount = 0;
  for (const o of gameObjects) {
    if (o.type === "seed") {
      if (seedIds.has(o.id)) fail(`游戏图：源种 ${o.id} 重复`);
      seedIds.add(o.id);
      seedCount++;
      if (o.id < 1 || o.id > 99) fail(`游戏图：源种编号 ${o.id} 越界`);
    }
    if (o.type === "item") foundItems.add(o.item);
  }
  const total = Math.max(0, ...seedIds);
  if (seedCount !== total) fail(`游戏图：源种应恰好 ${total} 颗，实际 ${seedCount}`);
  for (let i = 1; i <= total; i++) {
    if (!seedIds.has(i)) fail(`游戏图：源种编号 ${i} 缺失（编号须从 1 连续到 ${total}）`);
  }
  for (const need of ["whip", "bubble", "flute"]) {
    if (!foundItems.has(need)) fail(`游戏图缺少道具 '${need}' 的拾取点`);
  }
}

console.log(
  errors === 0
    ? warnings > 0
      ? `\n✓ 全部通过（${warnings} 条警告）`
      : "\n✓ 全部通过"
    : `\n✗ ${errors} 个问题（另有 ${warnings} 条警告）`,
);
process.exit(errors === 0 ? 0 : 1);
