// 编辑器：瓦片与物件的元数据（调色板、字段表、放置规则提示）。
// 字段顺序即导出 rooms.ts 的键序——与既有数据写法保持一致。
import { firstPropId, propByIdDoc } from "./mats";

export interface FieldSpec {
  key: string;
  label: string;
  kind: "number" | "string" | "enum" | "item" | "propid" | "intarray" | "location" | "binding" | "bool";
  optional?: boolean;
  /** 只读展示（如绑定 id：由放置/绑定自动分配，不允许手改） */
  readonly?: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export interface ObjSpec {
  type: string;
  label: string;
  color: string;
  /** true = 有碰撞/交互体（实线描边）；false = 纯视觉装饰（虚线描边） */
  solid: boolean;
  cat: CatId;
  /** 调色板隐藏（仍可在检查器里编辑已放置的物件） */
  hidden?: boolean;
  hint?: string;
  fields: FieldSpec[];
}

export type ObjRec = { type: string } & Record<string, unknown>;

export const ITEM_IDS = ["whip", "bubble", "flute", "bean"] as const;

/** 物件分类：编辑器调色板按类折叠，展开方可放置。 */
export const CATEGORIES = [
  { id: "build", label: "建筑类", hint: "地形砖与结构" },
  { id: "switch", label: "开关类", hint: "机关与触发源" },
  { id: "scene", label: "场景类", hint: "无碰撞或弱交互的摆设" },
  { id: "light", label: "光源类", hint: "自带光源的发光物：位置即光源中心，半径/亮度可调" },
  { id: "move", label: "移动类", hint: "无伤害、辅助角色移动" },
  { id: "item", label: "道具类", hint: "全局唯一，一件只能放一处" },
  { id: "damage", label: "伤害类", hint: "接触会受伤/死亡" },
  { id: "life", label: "生命类", hint: "有行为的生物" },
  { id: "trigger", label: "道具作用类", hint: "需要道具互动的机关" },
] as const;
export type CatId = (typeof CATEGORIES)[number]["id"];

export const TILES = [
  { ch: "#", label: "实心岩壁", color: "#454f5e" },
  { ch: ".", label: "空气", color: "#14181f" },
] as const; // 尖刺不是瓦片：一律用伤害类的地刺物件

export const OBJ_SPECS: ObjSpec[] = [
  {
    type: "item", label: "道具", color: "#e8c878", solid: false,
    cat: "item",
    hint: "道具拾取点（藤鞭/泡泡荚/孢子笛/蔓豆）。",
    fields: [
      { key: "item", label: "道具", kind: "item" },
      { key: "location", label: "位置", kind: "location" },
      { key: "r", label: "吸附半径 r", kind: "number", optional: true, min: 0, max: 200 },
    ],
  },
  {
    type: "seed", label: "源种", color: "#e8c860", solid: false,
    cat: "item",
    hint: "源种：编号 1~10，全局唯一。",
    fields: [
      { key: "id", label: "编号", kind: "number", min: 1, max: 10 },
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "ring", label: "钩环", color: "#5a9ae0", solid: true,
    cat: "trigger",
    hint: "钩环：藤鞭扫过即挂上摆荡。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "switch", label: "开关", color: "#e08a3c", solid: true,
    cat: "switch",
    hint: "机关：鞭击触发 controls 里绑定的被控物件（门/电梯/睡莲，可多个）；配 reset 秒=瞬时触发（到期自动复位，门跟着关上），不配=一次性。用「绑定」按钮点选建立双向绑定。",
    fields: [
      { key: "id", label: "自身 ID", kind: "string", readonly: true },
      { key: "location", label: "位置", kind: "location" },
      { key: "controls", label: "控制 (controls)", kind: "binding" },
      { key: "reset", label: "复位 reset (s, 空=一次性)", kind: "number", optional: true, min: 1, max: 60 },
    ],
  },
  {
    type: "plate", label: "压力板", color: "#e0a23c", solid: true,
    cat: "switch",
    hint: "压力板：所在格须空气、下一格须实心；踩上触发 controls 里绑定的被控物件。配 reset 秒=瞬时触发（门跟随开合），不配=永久打开。",
    fields: [
      { key: "id", label: "自身 ID", kind: "string", readonly: true },
      { key: "location", label: "位置", kind: "location" },
      { key: "controls", label: "控制 (controls)", kind: "binding" },
      { key: "reset", label: "复位 reset (s, 空=一次性)", kind: "number", optional: true, min: 1, max: 60 },
    ],
  },
  {
    type: "door", label: "荆棘门", color: "#58c7d8", solid: true,
    cat: "trigger",
    hint: "门体 w×h。fragile=可从哪侧鞭断；dir=开门收缩方向（v 沉入地底 / h 缩入侧墙）。被开关/压力板触发开门：用「绑定」把开关指向它（双向）。",
    fields: [
      { key: "id", label: "门 id", kind: "string", readonly: true },
      { key: "location", label: "位置", kind: "location" },
      { key: "w", label: "宽 w", kind: "number", min: 1, max: 32 },
      { key: "h", label: "高 h", kind: "number", min: 1, max: 18 },
      { key: "fragile", label: "可破面", kind: "enum", optional: true, options: ["left", "right"] },
      { key: "dir", label: "收缩方向", kind: "enum", optional: true, options: ["v", "h"] },
      { key: "triggeredBy", label: "被触发 (triggeredBy)", kind: "binding" },
    ],
  },
  {
    type: "vinebud", label: "天花藤（藤荚）", color: "#8fd44a", solid: true,
    cat: "scene",
    hidden: true,
    hint: "藤墙：可砍断、可攀爬（砍断状态按列表序号存档）。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "h", label: "高 h", kind: "number", min: 1, max: 18 },
    ],
  },
  {
    type: "bud", label: "花苞", color: "#e58ab4", solid: true,
    cat: "trigger",
    hint: "花苞：孢子笛吹开后成为平台（可按 S 下落）；盛开状态按列表序号存档。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "spores", label: "毒孢子", color: "#b06ad0", solid: false,
    cat: "damage",
    hint: "毒孢子云：无护罩接触即死，需乘泡泡罩身过境。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "w", label: "宽 w", kind: "number", min: 1, max: 32 },
      { key: "h", label: "高 h", kind: "number", min: 1, max: 18 },
    ],
  },
  {
    type: "wisp", label: "游魂", color: "#9a7ae0", solid: false,
    cat: "life",
    hint: "游魂：未安抚时碰身掉 1 血并击退（血尽回存档花）。孢子笛可安抚 8 秒。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "savepoint", label: "存档花", color: "#5fe0a8", solid: false,
    cat: "life",
    hint: "存档点：下一格须实心。靠近按使用键=回满血+设为重生点；激活后按 S 在各存档花之间传送。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "ledge", label: "吊台", color: "#b08a5a", solid: true,
    cat: "move",
    hint: "单边平台：可从下方跳上、按 S 下穿。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "w", label: "宽 w", kind: "number", min: 1, max: 32 },
    ],
  },
  {
    type: "flower", label: "巨花", color: "#e07ab0", solid: false,
    cat: "scene",
    hint: "井底巨花（终点装饰）。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "vine", label: "天花藤", color: "#4aa88a", solid: false,
    cat: "scene",
    hint: "天花藤：锚点上一行两格须实心。lens 条数=根数，值 -1=该条在 [下限,上限] 内随机，其余按数值；上限 h、下限 hMin（留空≈上限55%）。判定跟随每条实际长度，画布实时预览。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "h", label: "长度上限 h", kind: "number", min: 1, max: 18 },
      { key: "hMin", label: "长度下限 hMin", kind: "number", optional: true, min: 1, max: 18 },
      { key: "lens", label: "各条长度（0/-1=随机）", kind: "intarray", optional: true },
    ],
  },
  {
    type: "shroom", label: "蹦菇", color: "#d05a5a", solid: true,
    cat: "move",
    hint: "蹦菇：可悬空放置（无需贴地）；帽顶可站、落下弹起（也会戳破泡泡）。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "tree", label: "小树", color: "#58a860", solid: false,
    cat: "scene",
    hint: "小树：位置=树根所在的空气格（树从这里向上长）。灭泡泡、无碰撞。h 留空=按坐标随机 2~5。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "h", label: "高 h（可留空）", kind: "number", optional: true, min: 2, max: 10 },
    ],
  },
  {
    type: "candle", label: "蜡烛", color: "#ffd88a", solid: false, cat: "light",
    hint: "光源类：壁面蜡烛，暖光烛焰摇曳。位置即光源中心；半径/亮度可调，留空用默认。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "radius", label: "光照半径 (px)", kind: "number", optional: true, min: 4, max: 200 },
      { key: "intensity", label: "亮度 (0~1+)", kind: "number", optional: true, min: 0, max: 2 },
    ],
  },
  {
    type: "lamp", label: "吊灯", color: "#ffe0a0", solid: false, cat: "light",
    hint: "光源类：天花板垂下的吊灯（链+灯罩，轻微摇摆）。位置即光源中心；半径/亮度可调。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "radius", label: "光照半径 (px)", kind: "number", optional: true, min: 4, max: 200 },
      { key: "intensity", label: "亮度 (0~1+)", kind: "number", optional: true, min: 0, max: 2 },
    ],
  },
  {
    type: "glowstone", label: "发光晶石", color: "#7ac0b8", solid: false, cat: "light",
    hint: "光源类：慢脉动的荧光晶簇。位置即光源中心；半径/亮度可调。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "radius", label: "光照半径 (px)", kind: "number", optional: true, min: 4, max: 200 },
      { key: "intensity", label: "亮度 (0~1+)", kind: "number", optional: true, min: 0, max: 2 },
    ],
  },
  {
    type: "fireflies", label: "萤火虫群", color: "#d8f0a0", solid: false, cat: "light",
    hint: "光源类：一小群游走明灭的萤火虫。位置即光源中心；半径/亮度可调。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "radius", label: "光照半径 (px)", kind: "number", optional: true, min: 4, max: 200 },
      { key: "intensity", label: "亮度 (0~1+)", kind: "number", optional: true, min: 0, max: 2 },
    ],
  },
  {
    type: "prop", label: "自定义物件", color: "#c8a0e8", solid: false,
    cat: "scene",
    hint: "id 指向「新物品」工坊里创造的物件——形状/材质/碰撞/发光都在那边配。",
    fields: [
      { key: "id", label: "物件 id", kind: "propid" },
      { key: "location", label: "位置", kind: "location" },
    ],
  },
  {
    type: "crumble", label: "悬浮荚", color: "#b8c070", solid: true, cat: "move",
    hint: "悬浮块（孢子荚）1×w：逐格独立——踩上哪格哪格 1s 后碎、3s 后独立重生。不入存档，重进房间复原。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "w", label: "宽 w（格数）", kind: "number", min: 1, max: 32 },
    ],
  },
  {
    type: "lilypad", label: "睡莲平台", color: "#4ea06a", solid: true, cat: "move",
    hint: "移动平台（睡莲），搬运站上的角色。patrol=在起点与终点间往返；switch=被触发的开关延迟 delay 秒后移到终点，触发结束滑回。被控端用「绑定」把开关指向它（双向）。",
    fields: [
      { key: "location", label: "起点", kind: "location" },
      { key: "end", label: "终点", kind: "location" },
      { key: "w", label: "宽 w", kind: "number", min: 1, max: 8 },
      { key: "mode", label: "模式", kind: "enum", options: ["patrol", "switch"] },
      { key: "speed", label: "速度 speed (px/s)", kind: "number", optional: true, min: 4, max: 200 },
      { key: "delay", label: "延迟 delay (s)", kind: "number", optional: true, min: 0, max: 10 },
      { key: "back", label: "送客后 1s 返回 (back)", kind: "bool", optional: true },
      { key: "id", label: "自身 ID", kind: "string", readonly: true },
      { key: "triggeredBy", label: "被触发 (triggeredBy)", kind: "binding" },
    ],
  },
  {
    type: "spike", label: "地刺", color: "#c05555", solid: true, cat: "damage",
    hint: "1×w 的一排地刺（獠牙造型+红色警示光），碰撞占满整格行。全井地刺都用它表达。",
    fields: [
      { key: "location", label: "位置", kind: "location" },
      { key: "w", label: "宽 w（格）", kind: "number", min: 1, max: 32 },
    ],
  },
  {
    type: "elevator", label: "猪笼草电梯", color: "#8ab050", solid: false, cat: "move",
    hint: "站上笼口自动吞入，送到终点放下——单程（不自动回航）。被控端用「绑定」把开关指向它即可遥控（单程）。终点 room_id 填其他房间=跨房电梯；终点可用 🎯 在画布上点选。",
    fields: [
      { key: "location", label: "起点（笼口）", kind: "location" },
      { key: "end", label: "终点（room_id 填其他房间=跨房）", kind: "location" },
      { key: "speed", label: "速度 speed (px/s)", kind: "number", optional: true, min: 8, max: 200 },
      { key: "dwell", label: "端点停留 dwell (s)", kind: "number", optional: true, min: 0, max: 5 },
      { key: "back", label: "送客后 1s 返回 (back)", kind: "bool", optional: true },
      { key: "id", label: "自身 ID", kind: "string", readonly: true },
      { key: "triggeredBy", label: "被触发 (triggeredBy)", kind: "binding" },
    ],
  },
];

export function objSpec(type: string): ObjSpec {
  const hit = OBJ_SPECS.find((s) => s.type === type);
  if (hit) return hit;
  // 未识别类型（数据里出现新物件时）仍可显示/移动/删除
  return { type, label: `未知：${type}`, color: "#9aa4b2", solid: false, cat: "scene", fields: [] };
}

export function num(o: ObjRec, key: string, dflt = 0): number {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

/** 读物件的语义坐标（"location" 或 "end"），缺失时按原点兜底。 */
export function objPos(o: ObjRec, key = "location"): { room_id: string; x: number; y: number } {
  const v = o[key] as { room_id?: unknown; x?: unknown; y?: unknown } | undefined;
  return {
    room_id: typeof v?.room_id === "string" ? v.room_id : "",
    x: typeof v?.x === "number" && Number.isFinite(v.x) ? v.x : 0,
    y: typeof v?.y === "number" && Number.isFinite(v.y) ? v.y : 0,
  };
}

/** 物件的占位包围盒（格），用于命中测试与绘制。 */
export function footprint(o: ObjRec): { x: number; y: number; w: number; h: number } {
  const pos = objPos(o);
  const x = pos.x;
  const y = pos.y;
  switch (o.type) {
    case "door":
    case "spores":
      return { x, y, w: num(o, "w", 1), h: num(o, "h", 1) };
    case "ledge":
      return { x, y, w: num(o, "w", 1), h: 1 };
    case "vine":
      return { x, y, w: 2, h: num(o, "h", 1) };
    case "vinebud":
      return { x, y, w: 1, h: num(o, "h", 1) };
    case "tree":
      // 位置=树根（底部）：占位盒从根向上延伸，命中/绘制与游戏一致
      return { x, y: y - num(o, "h", 3) + 1, w: 1, h: num(o, "h", 3) };
    case "prop": {
      const pd = propByIdDoc(String(o.id ?? ""));
      return { x, y, w: pd?.w ?? 1, h: pd?.h ?? 1 };
    }
    case "crumble":
      return { x, y, w: num(o, "w", 1), h: 1 };
    case "lilypad":
      return { x, y, w: num(o, "w", 2), h: 1 };
    case "spike":
      return { x, y, w: num(o, "w", 1), h: 1 };
    case "elevator":
      return { x, y, w: 1, h: 2 };
    default:
      return { x, y, w: 1, h: 1 };
  }
}

function defaultNum(type: string, key: string): number {
  if (type === "door") return key === "w" ? 1 : 3;
  if (type === "spores") return key === "w" ? 3 : 2;
  if (type === "ledge") return 2;
  if (type === "vine" || type === "vinebud") return 3;
  if (type === "crumble") return 3;
  if (type === "spike") return 1;
  if (type === "elevator") return key === "speed" ? 40 : 0; // dwell
  if (type === "lilypad") {
    if (key === "w") return 2;
    if (key === "speed") return 36;
    return 0; // delay
  }
  return 1;
}

export interface PlaceCtx {
  nextDoorId: string;
  nextSeedId: number;
  /** 放置自定义物件时挂的 prop id */
  propId: string;
  /** 放置目标房间的 id（"R05"）：location.room_id 写它 */
  roomId: string;
}

/** 新物件的默认字段：x/y 取放置格；可选字段留空（导出时省略）。 */
export function defaultsFor(spec: ObjSpec, x: number, y: number, ctx: PlaceCtx): ObjRec {
  const o: ObjRec = { type: spec.type };
  const rid = ctx.roomId;
  for (const f of spec.fields) {
    if (f.kind === "location") {
      // 起点=放置格；终点（end）缺省在起点右 3 格，可后续 🎯 点选或手填
      o[f.key] = f.key === "location" ? { room_id: rid, x, y } : { room_id: rid, x: x + 3, y };
      continue;
    }
    if (f.key === "lens") { o.lens = [-1, -1]; continue; } // 放置默认：两条随机藤
    if (f.optional) continue;
    if (f.key === "id" && f.kind === "propid") { o.id = ctx.propId || firstPropId(); continue; }
    if (f.key === "id" && f.kind === "string") { o.id = ctx.nextDoorId; continue; }
    if (f.key === "id") { o.id = ctx.nextSeedId; continue; }
    if (f.key === "controls") { o.controls = []; continue; }
    if (f.key === "triggeredBy") { o.triggeredBy = []; continue; }
    if (f.key === "item") { o.item = "whip"; continue; }
    if (f.kind === "enum") { o[f.key] = f.options?.[0]; continue; }
    if (f.kind === "number") o[f.key] = defaultNum(spec.type, f.key);
  }
  return o;
}
