// ============ Plant Well 世界数据：多地图 ============
// 一张地图（MapDef）= 房间集 + 出生点，存成 src/data/maps/<id>.json（与编辑器导入/导出的文件格式完全相同）。
// 游戏采用哪张图：src/data/gameMap.json 的 gameMapId（编辑器「★ 设为游戏地图」保存时写它）。
// 本文件只放类型定义与派生索引（手写维护）；编辑器保存只写 JSON 文件，不碰本文件。
// 完整游戏今后可由多张地图组成（游戏内跨图传送留待后续）；现阶段游戏只加载 GAME_MAP_ID 指定的这一张。
import type { ItemId } from "../game/entities";
import gameMeta from "./gameMap.json";

// 语义坐标：location / end 是一个对象——room_id=目标房间的 3 位唯一 id（RoomDef.id），
// x/y=该房间内的局部格坐标。跨房物件（电梯）的 end.room_id 可填其他房间的 id。
export interface ObjPos {
  room_id: string;
  x: number;
  y: number;
}

type RawObj =
  | { type: "item"; item: ItemId; location: ObjPos; r?: number }
  | { type: "seed"; id: number; location: ObjPos }
  | { type: "ring"; location: ObjPos }
  // 开关类（鞭击开关/压力板）：多对多绑定——controls=它触发的被控物件 id 列表（门/电梯/睡莲的 id）。
  // 自身 6 位唯一 id 供被控方 triggeredBy 回写。reset（秒）可选：配了=瞬时触发（到时自动复位，
  // 门跟着关）；不配=一次性（触发写档、门永久开）。
  | { type: "switch"; id: string; location: ObjPos; controls: string[]; reset?: number }
  | { type: "plate"; id: string; location: ObjPos; controls: string[]; reset?: number }
  | { type: "door"; id: string; location: ObjPos; w: number; h: number; fragile?: "left" | "right"; dir?: "v" | "h"; triggeredBy?: string[] }
  | { type: "vinebud"; location: ObjPos; h: number }
  | { type: "bud"; location: ObjPos }
  | { type: "spores"; location: ObjPos; w: number; h: number }
  | { type: "wisp"; location: ObjPos }
  | { type: "ledge"; location: ObjPos; w: number }
  | { type: "flower"; location: ObjPos }
  // 天花板藤蔓丛：location=悬挂起始空气格（上一行须实心），宽 2 格、垂 h 格。
  // 铁律：护罩飞行路线附近不放或放短——护罩蹭到藤蔓会破。
  // h=长度上限，hMin=长度下限（缺省 ≈55%×h）；lens 逐条定长：条数=根数，
  // 值 0 或 -1=该条在 [hMin,h] 内随机，其余按数值取长。判定跟随每条实际长度与摆动位置。
  | { type: "vine"; location: ObjPos; h: number; hMin?: number; lens?: number[] }
  // 蹦菇：location=基部所在瓦片（下方须实心），帽顶可站、落下即弹起
  | { type: "shroom"; location: ObjPos }
  // 小树：location=树基所在空气格（下一格须实心）。灭泡泡、不影响蔓豆茎；不参与碰撞。
  // h 可选：显式指定树高（2~10，钳位）；缺省按坐标种子随机 2~5
  | { type: "tree"; location: ObjPos; h?: number }
  // 场景花卉/草类：纯装饰无碰撞，颜色受房间主题色（moss）渲染倾向。
  // variety 用中文品种名（属性栏下拉直选）：花=小花/向日葵/牡丹/油菜花；草=小草/灌木/蕨丛
  | { type: "flora"; location: ObjPos; variety?: string }
  | { type: "grass"; location: ObjPos; variety?: string }
  // 自定义物件：id 指向 propData.ts 里「新物品工坊」创造的定义（形状/材质/碰撞/发光都在那边）
  | { type: "prop"; id: string; location: ObjPos }
  // 悬浮荚（悬浮块）：location=左端格，1×w 的脆平台。逐格独立——踩上哪格哪格 1s 后碎、3s 后独立重生。
  // 不入存档：重进房间即复原。
  | { type: "crumble"; location: ObjPos; w: number }
  // 睡莲平台：location=初始格（起点），end=终点格，w 格宽的单向平台，搬运站上的角色。
  // patrol：在起点与终点之间以 speed px/s 来回平动；
  // switch：被 triggeredBy 里的开关触发后，延迟 delay 秒移到终点，触发结束（复位）后滑回起点。
  | { type: "lilypad"; location: ObjPos; end: ObjPos; w: number; mode: "patrol" | "switch"; speed?: number; delay?: number; id: string; triggeredBy?: string[] }
  // 地刺物件：location=左端格，1×w 的一排地刺（獠牙造型+红色警示光）。碰撞判定占满整格行。
  // 全井地刺一律用它表达——地图字符里没有尖刺。
  | { type: "spike"; location: ObjPos; w?: number }
  // 光源类：蜡烛（壁面）/ 吊灯（天花板垂下）/ 发光晶石（地面）/ 萤火虫群（空中）。
  // 自带光源（位置即光源中心）：radius=光照半径(px)、intensity=亮度(0~1+)，留空用各类默认。
  | { type: "candle"; location: ObjPos; radius?: number; intensity?: number }
  | { type: "lamp"; location: ObjPos; radius?: number; intensity?: number }
  | { type: "glowstone"; location: ObjPos; radius?: number; intensity?: number }
  | { type: "fireflies"; location: ObjPos; radius?: number; intensity?: number }
  // 猪笼草电梯：location=笼口格（身体向下 1×2），end=终点笼口格（room_id 可跨房）。
  // 单程：角色站上笼口自动乘坐送到另一端放下；被 triggeredBy 里的开关触发时无客也走一趟单程。
  // 没有自动回航/往返——要回去就再乘坐或再用开关触发一趟。
  // back=true：送客到站（出舱后）1s 空笼沿原路返回；缺省 false=停在到站端。
  // 到站状态持久（默认行为）：无论 back，电梯停在哪一端就一直在哪——跨房间/读档不复位，
  // 直到被乘坐或机关再触发。flags 键 lift:<id>。
  | { type: "elevator"; location: ObjPos; end: ObjPos; id: string; speed?: number; dwell?: number; triggeredBy?: string[]; back?: boolean }
  // 存档花：location=花所在空气格（下一格须实心）。靠近按使用键=回满血+设为重生点；
  // 激活后按 S 打开地图在各存档花之间传送。激活态存 flags（键=房号#序号）。
  | { type: "savepoint"; location: ObjPos };

/** 全物件通用外观：视觉缩放（0.3~3）。纯渲染——碰撞/判定不受影响。 */
export type ObjDef = RawObj & {
  /** 缩放倍率（1=原始大小） */
  scale?: number;
  /** 缩放随机幅度（±比例，按房间+序号确定性随机），实际 = scale × (1 ± scaleJit) */
  scaleJit?: number;
};

export interface RoomDef {
  /** 房间唯一 id：3 位字符（R01 起）。物件坐标里的 room_id 就填它。 */
  id: string;
  /** 井壁网格坐标（col,row）：相邻性/房间转换按它算。 */
  x: number;
  y: number;
  map: string[];
  objects?: ObjDef[];
  /** 房间自带的固定光源（如井口的天光），世界坐标按本房间像素。 */
  lights?: { x: number; y: number; r: number }[];
  /** 发光苔藓的颜色（"#hex"）。缺省按生物群系底色+房间种子微调。 */
  moss?: string;
}

// ============ 多地图 ============
// 一张地图 = 房间集 + 出生点（spawn.room 填房间 id，不是网格键）。

export interface SpawnPoint {
  /** 出生房间 id（RoomDef.id） */
  room: string;
  /** 房间内像素坐标 */
  x: number;
  y: number;
}

export interface MapDef {
  /** 地图唯一 id（2~4 位大写字母/数字，如 M01）。存档与跨图传送（预留）按它区分。 */
  id: string;
  /** 显示名（编辑器下拉里看的）。 */
  name: string;
  spawn: SpawnPoint;
  rooms: RoomDef[];
}

// 全部地图：编译期收集 maps/ 目录下的 .json（一张图一个文件，编辑器保存直接落这里；
// 新建/删除 JSON 文件后 dev server 自动感知，无需改本文件）。
const mapMods = import.meta.glob("./maps/*.json", { eager: true }) as Record<string, { default: MapDef }>;
export const MAP_LIST: MapDef[] = Object.values(mapMods).map((m) => m.default);

// 游戏采用哪张地图：编辑器顶栏「★ 设为游戏地图」保存时改写 gameMap.json。
export const GAME_MAP_ID: string = gameMeta.gameMapId;

// ===== 以下全部由 GAME_MAP 派生（游戏运行时只消费这一段，手工别改） =====

export const GAME_MAP: MapDef = MAP_LIST.find((m) => m.id === GAME_MAP_ID) ?? MAP_LIST[0];

/** 当前游戏地图的房间列表（数据真身在 maps/*.json，这里是游戏侧的便捷别名）。 */
export const ROOM_LIST = GAME_MAP.rooms;

// 房间 id（"R12"）→ 房间定义：游戏与编辑器**统一且唯一**的房间标识（v40 起全面取代网格键 "m,n"）。
// 房间的网格坐标是 def.x/def.y 数据，只用于邻接换房与相机/世界偏移换算。
export const ROOMS: Record<string, RoomDef> = Object.fromEntries(
  ROOM_LIST.map((r) => [r.id, r]),
);

/** 网格坐标（"m,n"）→ 房间 id：按坐标找邻房时用（换房/邻接判定）。 */
export const ROOM_ID_BY_POS: Record<string, string> = Object.fromEntries(
  ROOM_LIST.map((r) => [`${r.x},${r.y}`, r.id]),
);

/** 房间 id → 网格坐标：世界偏移/小地图换算用（等价于 ROOMS[id].x/.y 的便捷表）。 */
export const ROOM_POS: Record<string, { x: number; y: number }> = Object.fromEntries(
  ROOM_LIST.map((r) => [r.id, { x: r.x, y: r.y }]),
);

/** 被控物件的 id → 种类：触发方（开关/压力板）据此决定触发方式——
 *  door=写 flag 永久开 / TTL 瞬时开；mover（电梯/睡莲）=只喂边沿脉冲（它们自己查总线）。
 *  全图查重：所有可绑定物件（门/电梯/睡莲）与开关/压力板的 id 两两不同。 */
export const BINDING_KIND: Record<string, "door" | "mover"> = (() => {
  const out: Record<string, "door" | "mover"> = {};
  for (const def of Object.values(ROOMS)) {
    for (const o of def.objects ?? []) {
      if (o.type === "door") out[o.id] = "door";
      else if ((o.type === "elevator" || o.type === "lilypad") && o.id) out[o.id] = "mover";
    }
  }
  return out;
})();

/** 出生点：spawn.room 即房间 id（Rxx），世界代码直接消费。 */
export const SPAWN = (() => {
  const id = GAME_MAP.spawn.room;
  if (!ROOMS[id]) throw new Error(`地图 ${GAME_MAP.id} 的出生点房间 "${id}" 不存在`);
  return { room: id, x: GAME_MAP.spawn.x, y: GAME_MAP.spawn.y };
})();

/** 源种总数 = 本图源种最大编号（HUD 槽位数）。 */
export const SEED_TOTAL = (() => {
  let max = 0;
  for (const def of Object.values(ROOMS)) {
    for (const o of def.objects ?? []) {
      if (o.type === "seed") max = Math.max(max, o.id);
    }
  }
  return max;
})();
