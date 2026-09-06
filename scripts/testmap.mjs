// 探针专用独立测试地图 T90：与 M01 完全解耦——用户随时改 M01 都不影响探针。
// withTestMap(run)：写入 T90.json + 把 gameMap.json 切到 T90 → 跑断言 → 无论成败恢复原字节并删文件。
// 地形（全部程序化拼装，坐标即契约）：
//   R91 @(0,0) 主房：走廊 [1,11]-[30,15]（地板=row16 顶=row10）、竖井 [13,0]-[17,10] 通顶、
//             右缘开口 rows13-15、电梯 TSTELV (5,13)→R92(5,13)
//   R92 @(1,0) 右邻：左缘开口 rows13-15 对齐、同款走廊 [1,11]-[30,15]、savepoint (5,15)
//   R93 @(0,-1) 上邻：底缘开口 cols14-16、落点地板=row12（cols10-20）、竖井 [13,13]-[17,16]
import fs from "node:fs";
import { join } from "node:path";

const MAPS_DIR = join(process.cwd(), "src", "data", "maps");
const T90_PATH = join(MAPS_DIR, "T90.json");
const GAME_MAP = join(process.cwd(), "src", "data", "gameMap.json");

function carve({ top = [], bottom = [], left = [], right = [], boxes = [] }) {
  const g = Array.from({ length: 18 }, () => Array.from({ length: 32 }, () => "#"));
  const open = (x, y) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 18) g[y][x] = ".";
  };
  for (const x of top) open(x, 0);
  for (const x of bottom) open(x, 17);
  for (const y of left) open(0, y);
  for (const y of right) open(31, y);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) open(x, y);
  }
  return g.map((r) => r.join(""));
}

export function buildT90() {
  const r91 = carve({
    top: [14, 15, 16],
    right: [13, 14, 15],
    boxes: [
      [1, 11, 30, 15], // 走廊
      [13, 0, 17, 10], // 竖井（顶内段）
    ],
    objects: [
      { type: "elevator", id: "TSTELV", location: { room_id: "R91", x: 5, y: 14 }, end: { room_id: "R92", x: 5, y: 13 }, speed: 80 },
    ],
  });
  const r92 = carve({
    left: [13, 14, 15],
    boxes: [[1, 11, 30, 15]],
    objects: [
      { type: "savepoint", location: { room_id: "R92", x: 5, y: 15 } },
    ],
  });
  const r93 = carve({
    bottom: [14, 15, 16],
    boxes: [[8, 6, 23, 16]], // 高腔体：row17 是地板（开口 cols14-16 除外），升上来后漂移可落在开口旁
  });
  return {
    kind: "plantwell-map",
    version: 1,
    id: "T90",
    name: "探针测试图",
    spawn: { room: "R91", x: 150, y: 150 },
    rooms: [
      {
        id: "R91", x: 0, y: 0, map: r91,
        objects: [
          { type: "elevator", id: "TSTELV", location: { room_id: "R91", x: 5, y: 14 }, end: { room_id: "R92", x: 5, y: 13 }, speed: 80 },
        ],
      },
      { id: "R92", x: 1, y: 0, map: r92, objects: [{ type: "savepoint", location: { room_id: "R92", x: 5, y: 15 } }] },
      { id: "R93", x: 0, y: -1, map: r93, objects: [] },
    ],
  };
}

/** 写入 T90 + 切游戏图 → run → 恢复。run 内部应等待 __pw 重建（vite 会因文件变更整页刷新）。 */
export async function withTestMap(run) {
  let prevGame = fs.readFileSync(GAME_MAP, "utf8");
  // 自愈：上次运行崩溃可能把 gameMap 留在 T90——归位 M01，避免“残留”被当成原状再次写回
  if (prevGame.includes('"T90"')) {
    fs.writeFileSync(GAME_MAP, JSON.stringify({ gameMapId: "M01" }, null, 2) + String.fromCharCode(10));
    prevGame = fs.readFileSync(GAME_MAP, "utf8");
  }
  const hadT90 = fs.existsSync(T90_PATH);
  const prevT90 = hadT90 ? fs.readFileSync(T90_PATH, "utf8") : null;
  const def = buildT90();
  fs.writeFileSync(T90_PATH, JSON.stringify(def, null, 2) + "\n");
  fs.writeFileSync(GAME_MAP, JSON.stringify({ gameMapId: "T90" }, null, 2) + "\n");
  try {
    return await run();
  } finally {
    fs.writeFileSync(GAME_MAP, prevGame);
    if (hadT90) fs.writeFileSync(T90_PATH, prevT90);
    else fs.rmSync(T90_PATH, { force: true });
  }
}
