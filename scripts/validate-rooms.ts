// 地图数据校验：MAP_LIST 元数据（id/出生点）+ ★游戏地图（ROOMS）的形状、边界封闭、
// 相邻房间洞口配对、物件引用完整性。
// 运行：node scripts/validate-rooms.ts（Node 24 原生支持 TS 类型剥离）
// 数据直读 JSON（src/data/gameMap.json + src/data/maps/*.json）——
// src/data/maps.ts 里的 import.meta.glob 是 Vite 专属，Node 环境跑不了；派生逻辑在此本地重算。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const gameMeta = JSON.parse(readFileSync("src/data/gameMap.json", "utf8")) as { gameMapId: string };
const MAP_LIST = readdirSync("src/data/maps")
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join("src/data/maps", f), "utf8")));
const GAME_MAP_ID: string = gameMeta.gameMapId;
const GAME_MAP = MAP_LIST.find((m: any) => m.id === GAME_MAP_ID) ?? MAP_LIST[0];
const ROOM_LIST: any[] = GAME_MAP.rooms;
const ROOMS: Record<string, any> = Object.fromEntries(ROOM_LIST.map((r) => [`${r.x},${r.y}`, r]));
const SEED_TOTAL: number = Math.max(
  0,
  ...ROOM_LIST.flatMap((m) => (m.objects ?? []).filter((o: any) => o.type === "seed").map((o: any) => o.id as number)),
);

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

// ---- 地图级：id 格式/唯一、游戏地图存在、出生点可解析 ----
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
  else console.log(`game map：${GAME_MAP.id}（${GAME_MAP.name}，${GAME_MAP.rooms.length} 房）`);
}

for (const [key, def] of Object.entries(ROOMS)) {
  console.log(`room ${key}`);
  if (def.map.length !== ROWS) fail(`应有 ${ROWS} 行，实际 ${def.map.length}`);
  def.map.forEach((line, y) => {
    if (line.length !== COLS) fail(`第 ${y} 行应有 ${COLS} 字符，实际 ${line.length}`);
    for (const ch of line) {
      if (!"#.".includes(ch)) fail(`第 ${y} 行有非法字符 '${ch}'（尖刺请用 objects 里的 spike 物件）`);
    }
  });

  // 边缘空气格（洞口）
  const holes = { left: [] as number[], right: [] as number[], top: [] as number[], bottom: [] as number[] };
  for (let y = 0; y < ROWS; y++) {
    if (def.map[y]?.[0] === ".") holes.left.push(y);
    if (def.map[y]?.[COLS - 1] === ".") holes.right.push(y);
  }
  for (let x = 0; x < COLS; x++) {
    if (def.map[0]?.[x] === ".") holes.top.push(x);
    if (def.map[ROWS - 1]?.[x] === ".") holes.bottom.push(x);
  }

  const [cx, cy] = key.split(",").map(Number);
  const neighborKey = (dx: number, dy: number) => `${cx + dx},${cy + dy}`;

  const edges: [keyof typeof holes, number, number, number, number][] = [
    // 边, 对方key的偏移, 自身遍历范围
    ["left", -1, 0, 0, 1],
    ["right", 1, 0, 0, 1],
    ["top", 0, -1, 1, 0],
    ["bottom", 0, 1, 1, 0],
  ];
  for (const [edge, dx, dy] of edges) {
    const nKey = neighborKey(dx, dy);
    const neighbor = ROOMS[nKey];
    const mine = holes[edge];
    if (!neighbor) {
      if (mine.length > 0) fail(`${edge} 边有洞口（${fmt(mine)}）但没有相邻房间 ${nKey}，世界会漏`);
      continue;
    }
    // 对方在同一共享边上的洞口
    const nMap = neighbor.map;
    const theirs: number[] = [];
    if (edge === "left" || edge === "right") {
      const nx = edge === "left" ? COLS - 1 : 0;
      for (let y = 0; y < ROWS; y++) if (nMap[y]?.[nx] === ".") theirs.push(y);
    } else {
      const ny = edge === "top" ? ROWS - 1 : 0;
      for (let x = 0; x < COLS; x++) if (nMap[ny]?.[x] === ".") theirs.push(x);
    }
    if (mine.join(",") !== theirs.join(",")) {
      fail(`${edge} 边洞口与 ${nKey} 不配对: 自己[${fmt(mine)}] vs 对方[${fmt(theirs)}]`);
    }
  }
}

// 房间 id：3 位、唯一；物件坐标 room_id 必须能解析
const roomIds = new Map<string, string>();
for (const [key, def] of Object.entries(ROOMS)) {
  const rid = (def as { id?: string }).id ?? "";
  if (!/^[A-Z0-9]{3}$/.test(rid)) fail(`房间 ${key} 的 id 非法（应为 3 位字符，现为 "${rid}"）`);
  else if (roomIds.has(rid)) fail(`房间 id ${rid} 重复（${roomIds.get(rid)} 与 ${key}）`);
  else roomIds.set(rid, key);
}
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o) => {
    for (const pk of ["location", "end"] as const) {
      const v = (o as Record<string, unknown>)[pk] as { room_id?: string } | undefined;
      if (pk === "end" && !v) continue; // end 只有电梯/睡莲有
      const rid = v?.room_id ?? "";
      if (!rid) fail(`room ${key}: ${o.type} 的 ${pk}.room_id 为空`);
      else if (!roomIds.has(rid)) fail(`room ${key}: ${o.type} 的 ${pk}.room_id "${rid}" 不存在`);
    }
  });
}

// 物件引用
const doorIds = new Set<string>();
const seedIds = new Set<number>();
const foundItems = new Set<string>();
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o) => {
    if (o.type === "door") doorIds.add(o.id);
    if (o.type === "seed") {
      if (seedIds.has(o.id)) fail(`room ${key}: 源种 ${o.id} 重复`);
      seedIds.add(o.id);
      if (o.id < 1 || o.id > SEED_TOTAL) fail(`room ${key}: 源种编号 ${o.id} 越界`);
    }
    if (o.type === "item") foundItems.add(o.item);
    if (o.type === "spike") {
      const w = Math.max(1, o.w ?? 1); // 游戏侧同款默认（省略 w = 1 格）
      if (o.location.x + w > COLS || o.location.y < 0 || o.location.y >= ROWS) {
        fail(`room ${key}: spike (${o.location.x},${o.location.y}) 宽 ${w} 越界`);
      } else {
        for (let dx = 0; dx < w; dx++) {
          if (def.map[o.location.y]?.[o.location.x + dx] !== ".") {
            fail(`room ${key}: spike (${o.location.x},${o.location.y}) 覆盖格 (${o.location.x + dx},${o.location.y}) 必须是空气`);
          }
        }
      }
    }
    if (o.type === "vine") {
      // 锚点：上一行两格都必须是实心天花板；垂落区：整段必须是空气
      const above = def.map[o.location.y - 1];
      if (!above || above[o.location.x] !== "#" || above[o.location.x + 1] !== "#") {
        fail(`room ${key}: vine (${o.location.x},${o.location.y}) 顶部两格必须都是实心天花板`);
      }
      // lens 语义：显式值=该条实际长度（忽略 h 上限）；-1=在 [hMin,h] 随机（不超过 h）。
      // 有效垂落深度 = 显式值与（含 -1 时的）h 取最大
      const lensArr = Array.isArray(o.lens) ? o.lens : null;
      const effH =
        lensArr && lensArr.length
          ? Math.max(lensArr.some((v) => v < 0) ? o.h : 1, ...lensArr.map((v) => Math.max(1, v)))
          : o.h;
      for (let dy = 0; dy < effH; dy++) {
        const row = def.map[o.location.y + dy];
        for (const dx of [0, 1]) {
          if (!row || row[o.location.x + dx] !== ".") {
            // 藤无碰撞无伤害，垂落区插进岩层只是视觉穿帮——警告不拦
            warn(`room ${key}: vine (${o.location.x},${o.location.y}) 垂落区 (${o.location.x + dx},${o.location.y + dy}) 不是空气（藤尖会插进岩层）`);
          }
        }
      }
      if (o.h < 1 || o.location.y + o.h > ROWS) fail(`room ${key}: vine (${o.location.x},${o.location.y}) 长度 h=${o.h} 越界`);
      if (lensArr && lensArr.length > 6) warn(`room ${key}: vine (${o.location.x},${o.location.y}) lens ${lensArr.length} 条——游戏只长前 6 根`);
      if (lensArr) {
        for (const v of lensArr) {
          // lens 显式值=该条实际长度（忽略 h 上限，游戏如此实现）；-1=在 [hMin,h] 随机
          if (v < -1) fail(`room ${key}: vine (${o.location.x},${o.location.y}) lens 条目 ${v} 非法（须 ≥ -1）`);
          // 0 与 -1 同义：在 [hMin,h] 内随机（不再钳为 1）
          else if (!Number.isInteger(v)) warn(`room ${key}: vine (${o.location.x},${o.location.y}) lens 条目 ${v} 非整数`);
        }
      }
    }
  });
}
// 物件落点：位置在房间内；location.room_id 应指向所在房间（游戏只按列表+网格键定位，
// room_id 是数据自描述——填错房间的 id 说明数据已经乱了）；睡莲的 end 不许跨房（无投递逻辑）
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o, i) => {
    const loc = (o as { location?: { room_id?: string; x?: number; y?: number } }).location;
    if (loc) {
      const x = loc.x ?? -1;
      const y = loc.y ?? -1;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
        fail(`room ${key}: 物件#${i} (${o.type}) location (${x},${y}) 越出房间`);
      }
      if (loc.room_id && loc.room_id !== def.id) {
        warn(`room ${key}: 物件#${i} (${o.type}) location.room_id "${loc.room_id}" 不是本房 id "${def.id}"`);
      }
    }
    if (o.type === "lilypad") {
      const end = (o as { end?: { room_id?: string } }).end;
      if (end?.room_id && end.room_id !== def.id) {
        fail(`room ${key}: lilypad#${i} end.room_id "${end.room_id}" 跨房——睡莲不支持跨房，只有电梯支持`);
      }
    }
  });
}
// ---- 绑定校验（多对多，属性名统一为 id）----
// 被控方（门/电梯/睡莲）与触发方（开关/压力板）都有 6 位唯一 id。
// 触发方 controls = 它控制的被控物件 id 列表；被控方 triggeredBy = 触发它的触发方 id 列表。
// 双向应当对称；单向引用给警告（编辑器双向绑定/解除会保证对称）。
const bindKind = new Map<string, "door" | "mover">();
const trigIds = new Set<string>();
const bindOwner = new Map<string, string>();
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o) => {
    const loc = (o as { location?: { x?: number; y?: number } }).location;
    const where = `room ${key} ${o.type}@(${loc?.x},${loc?.y})`;
    if (o.type === "door" || o.type === "elevator" || o.type === "lilypad") {
      const id = o.id;
      if (!id) {
        fail(`${where} 缺自身 id`);
        return;
      }
      if (bindKind.has(id) || trigIds.has(id)) fail(`id '${id}' 重复（${where} vs ${bindOwner.get(id)}）`);
      if (o.type === "door") bindKind.set(id, "door");
      else bindKind.set(id, "mover");
      bindOwner.set(id, where);
    }
    if (o.type === "switch" || o.type === "plate") {
      const id = o.id;
      if (!id) {
        fail(`${where} 缺自身 id`);
        return;
      }
      if (bindKind.has(id) || trigIds.has(id)) fail(`id '${id}' 重复（${where} vs ${bindOwner.get(id)}）`);
      trigIds.add(id);
      bindOwner.set(id, where);
    }
  });
}
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o) => {
    if (o.type !== "switch" && o.type !== "plate") return;
    const controls = o.controls ?? [];
    if (!controls.length) warn(`room ${key}: ${o.type} '${o.id}' 没绑定任何被控物件（controls 为空）`);
    for (const id of controls) {
      const kind = bindKind.get(id);
      if (!kind) fail(`room ${key}: ${o.type} '${o.id}' controls 里的 '${id}' 不是任何门/电梯/睡莲的 id`);
    }
    // 对称性：被控方 triggeredBy 里应回写本触发方 id
    for (const id of controls) {
      let mirrored = false;
      for (const [, d2] of Object.entries(ROOMS)) {
        for (const o2 of d2.objects ?? []) {
          if (o2.type !== "door" && o2.type !== "elevator" && o2.type !== "lilypad") continue;
          if (o2.id === id && (o2.triggeredBy ?? []).includes(o.id)) mirrored = true;
        }
      }
      if (!mirrored) warn(`room ${key}: ${o.type} '${o.id}' 控制 '${id}'，但被控方没在 triggeredBy 回写 '${o.id}'`);
    }
  });
}
// 被控方 triggeredBy 指向的触发方 id 必须真实存在
for (const [key, def] of Object.entries(ROOMS)) {
  (def.objects ?? []).forEach((o) => {
    if (o.type !== "door" && o.type !== "elevator" && o.type !== "lilypad") return;
    for (const tid of o.triggeredBy ?? []) {
      if (!trigIds.has(tid)) {
        fail(`room ${key}: ${o.type} '${o.id}' triggeredBy 里的 '${tid}' 不是任何开关/压力板的 id`);
      }
    }
  });
}
// 源种编号必须从 1 连续到 SEED_TOTAL（HUD 槽位按 1..SEED_TOTAL 画，缺号=永远收不齐）
if (seedIds.size !== SEED_TOTAL) fail(`源种应恰好 ${SEED_TOTAL} 颗，实际 ${seedIds.size}`);
for (let i = 1; i <= SEED_TOTAL; i++) {
  if (!seedIds.has(i)) fail(`源种编号 ${i} 缺失（编号须从 1 连续到 ${SEED_TOTAL}）`);
}
for (const need of ["whip", "bubble", "flute"]) {
  if (!foundItems.has(need)) fail(`缺少道具 '${need}' 的拾取点`);
}

console.log(
  errors === 0
    ? warnings > 0
      ? `\n✓ 全部通过（${warnings} 条警告）`
      : "\n✓ 全部通过"
    : `\n✗ ${errors} 个问题（另有 ${warnings} 条警告）`,
);
process.exit(errors === 0 ? 0 : 1);

function fmt(a: number[]): string {
  return a.length ? a.join(",") : "无";
}
