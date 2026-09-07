// Plant Well 地图编辑器：可视化的房间/物件编辑 + 一键写回 maps/ 目录的地图 JSON。
// 布局：顶栏（地图选择 + 房间导航 + 工具条 + 文件操作），左侧物件调色板，中间世界画布，
// 右侧「物件 / 房间」分页（检查器 vs 井结构/光源/苔藓/地图），底栏坐标与日志。
// 多地图：文档里可有任意多张地图（maps[]），编辑的是其中一张；游戏运行的是「★游戏地图」那一张。
// 工具：选择（点选/拖动/框选多选）· 放置/画笔 · 矩形（建筑类拖拽画矩形填充）。橡皮已并入「空气」材料。
import { EditorDoc } from "./doc";
import {
  ATTACH_ERASE_CH,
  BUILD_TILES,
  CATEGORIES,
  ITEM_IDS,
  OBJ_SPECS,
  defaultsFor,
  footprint,
  num,
  objPos,
  objSpec,
  TILES,
  type FieldSpec,
  type ObjRec,
} from "./palette";
import { allPropIds, firstPropId, propByIdDoc } from "./mats";
import { openWorkshop, type WorkshopHooks } from "./workshop";
import { EditorRenderer } from "./render";
import { downloadText, serializeMap } from "./exporter";
import { saveHash } from "./dataBridge";
import { ROOM_COLS, ROOM_ROWS } from "../game/constants";

// ---- DOM 工具 ----

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}
function clampNum(v: number, f: FieldSpec): number {
  if (f.min != null) v = Math.max(f.min, v);
  if (f.max != null) v = Math.min(f.max, v);
  return Math.round(v);
}

// ---- 状态 ----

type Tool = "select" | "rect" | "place";

const doc = new EditorDoc();
const canvas = $("#view") as HTMLCanvasElement;
const renderer = new EditorRenderer(canvas);

// 当前编辑房间持久化（按地图分键 "地图id|房间键"）：保存会触发 vite 全页刷新（地图 JSON 变更冒泡到入口），
// 不记住的话每次保存完都被弹回出生点房间
const ROOM_KEY_STORE = "plantwell.editor.room";

function spawnRoomKey(): string {
  const sp = doc.spawn();
  return doc.rooms[sp.room] ? sp.room : doc.idOrder[0] ?? "";
}

function bootRoom(): string {
  try {
    const saved = localStorage.getItem(ROOM_KEY_STORE) ?? "";
    const [mid, key] = saved.split("|");
    if (mid === doc.editMapId && key && doc.rooms[key]) return key;
  } catch {
    /* ignore */
  }
  return spawnRoomKey();
}
let curKey = bootRoom();
let tool: Tool = "select";
let brushTile = "#";
let placeType = "tree";
// 🎯 选点模式：为哪个坐标字段（location/end）选点 + 目标物件所在房/序号；点房间画布落点、点小地图切房、Esc 取消
let pickField: string | null = null;
/** 📍 出生点选点模式：armed 时下一次房间画布点击 = 出生点落点（房+像素一次定）。 */
let spawnPick = false;
let pickIndex: number | null = null;
let pickHome: string | null = null;
let placePropId = firstPropId(); // 放置「自定义物件」时挂的 id
// 放置/画笔工具的当前选中项：建筑瓦片 → 长按铺设；物件 → 点击放置
let palSel: { kind: "tile" | "obj"; ch?: string; type?: string } = { kind: "tile", ch: "#" };
let selection: number | null = null;
/** 框选集合（选择工具拖拽产生）：物件定位跨房唯一键 "房键#序号"；与单选 selection 并存（单选=检查器对象）。 */
let multiSel = new Set<string>();
/** 框选拖拽进行中的世界格矩形（render 画虚线框）。 */
let marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
let hover: { x: number; y: number } | null = null;
let hoverKey: string | null = null; // hover 命中的房间键（邻房淡显也可命中）
let lastTile: { x: number; y: number } | null = null; // 拖拽中途移出画布也不丢终点

let paintValue: string | null = null;
let paintPre: string | null = null;
let lastPaint: { x: number; y: number } | null = null;
let rectAnchor: { x: number; y: number } | null = null;
let dragObj: { roomId: string; index: number; startX: number; startY: number; ox: number; oy: number; pre: string } | null = null;
// 画布平移（右键/中键拖动）：panState 非空=正在拖
let panState: { x: number; y: number; camX: number; camY: number } | null = null;
// 🔗 绑定点选模式：记录发起端（开关/压力板 或 门/电梯/睡莲），下一次画布点击落在配对物件上即完成双向绑定
let bindPick: { roomId: string; index: number } | null = null;

function ensureKey(key: string): string {
  return doc.rooms[key] ? key : doc.idOrder[0] ?? "";
}

// ---- 自动保存（页面崩溃/HMR 兜底） ----

const AUTOSAVE_KEY = "plantwell.editor.v1";
let autosaveTimer = 0;
function autosaveNow(): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, doc.snapshot());
  } catch {
    /* 存不进就算了 */
  }
}
function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(autosaveNow, 400);
}

// ---- 日志 ----

function log(msg: string, level: "info" | "ok" | "warn" | "err" = "info"): void {
  const box = $("#log");
  const div = document.createElement("div");
  div.className = `issue ${level === "ok" ? "ok" : level}`;
  const time = new Date().toTimeString().slice(0, 8);
  div.textContent = `${time} ${msg}`;
  box.prepend(div);
  while (box.childElementCount > 60) box.lastChild?.remove();
  const line = $("#stLog");
  if (line) line.textContent = msg;
}

// ---- 房间导航 ----

function centerCameraOnRoom(key: string): void {
  const r = doc.rooms[key];
  if (!r) return;
  const cx = r.x, cy = r.y;
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 360;
  renderer.camX = (cx + 0.5) * ROOM_COLS * renderer.ts - w / 2;
  renderer.camY = (cy + 0.5) * ROOM_ROWS * renderer.ts - h / 2;
}

function gotoRoom(key: string): void {
  if (!doc.rooms[key]) return;
  curKey = key;
  try {
    localStorage.setItem(ROOM_KEY_STORE, `${doc.editMapId}|${key}`);
  } catch {
    /* 存不进就算了 */
  }
  selection = null;
  multiSel.clear();
  centerCameraOnRoom(key);
  mmEnsureVisible(key);
  refreshAll();
}

/** 工作房切换（视角不动）：编辑操作落到邻房时用它——画布里的邻房本来就在眼前，
 *  瞬移镜头反而打断构图；只切工作房 + 井图高亮/必要时滚动井图视口。 */
function switchWorkRoom(key: string): void {
  if (!doc.rooms[key] || key === curKey) return;
  curKey = key;
  try {
    localStorage.setItem(ROOM_KEY_STORE, `${doc.editMapId}|${key}`);
  } catch {
    /* 存不进就算了 */
  }
  selection = null;
  multiSel.clear();
  mmEnsureVisible(key);
  refreshAll();
}

/** 切换正在编辑的地图：房间键失效就落回该图出生点房。 */
function applyEditMap(mid: string): void {
  if (!doc.switchMap(mid)) return;
  // 房间 id 跨图可能撞名（各图都从 R01 起分配）：切图一律落到该图出生点房，避免歧义
  curKey = spawnRoomKey();
  selection = null;
  multiSel.clear();
  centerCameraOnRoom(curKey);
  mmEnsureVisible(curKey);
  refreshAll();
  const m = doc.maps.find((mm) => mm.id === mid);
  log(`已切到地图 ${m?.name ?? mid}（${mid}）——共 ${doc.idOrder.length} 房${doc.gameMapId === mid ? "，★游戏地图" : ""}。`, "ok");
}

function stepRoom(dir: -1 | 1): void {
  const i = doc.idOrder.indexOf(curKey);
  const n = doc.idOrder.length;
  if (n === 0) return;
  gotoRoom(doc.idOrder[(i + dir + n) % n]);
}

function createRoom(cx: number, cy: number): void {
  if (doc.roomAt(doc.curMap(), cx, cy)) {
    log(`网格 (${cx},${cy}) 已有房间`, "warn");
    return;
  }
  const rid = doc.addRoom(cx, cy);
  if (rid) {
    log(`已新建房间 ${rid} @ (${cx},${cy})（封闭边框+全空气，自行开洞）`, "ok");
    gotoRoom(rid);
  }
}

// ---- 编辑操作 ----

function paintRaw(x: number, y: number, v: string): void {
  const room = doc.rooms[curKey];
  if (!room) return;
  // 附着类画笔（@=黑幕 / 空格=清除附着）：写 attach 网格——与瓦片层独立，不取代底下内容
  if (v === "@" || v === ATTACH_ERASE_CH) {
    const atRow = room.attach[y] ?? "";
    if (atRow[x] === v) return;
    room.attach[y] = atRow.slice(0, x) + v + atRow.slice(x + 1);
    return;
  }
  const row = room.map[y];
  if (row[x] === v) return;
  room.map[y] = row.slice(0, x) + v + row.slice(x + 1);
}

function paintLine(a: { x: number; y: number }, b: { x: number; y: number }, v: string): void {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
    paintRaw(x, y, v);
  }
  doc.touch();
}

function fillRect(x0: number, y0: number, x1: number, y1: number, v: string): void {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  doc.mutate(() => {
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) paintRaw(x, y, v);
    }
  });
}

// ---- 绑定 ID：6 位不重复短码（门用 id，机关/载具用 bind），开关 target 填它即可绑定 ----

const ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉易混的 I L O 0 1

function idExists(id: string): boolean {
  for (const m of doc.maps) {
    for (const room of Object.values(m.rooms)) {
      for (const o of room.objects) {
        if (String(o.id ?? "") === id) return true;
      }
    }
  }
  return false;
}

function gen6(): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    if (!idExists(id)) return id;
  }
}

function nextDoorId(): string {
  return gen6();
}

function nextSeedId(): number {
  const used = new Set<number>();
  for (const m of doc.maps) {
    for (const room of Object.values(m.rooms)) {
      for (const o of room.objects) if (o.type === "seed") used.add(num(o, "id"));
    }
  }
  let n = 1;
  while (used.has(n) && n < 10) n++;
  return n;
}

// gen6/nextSeedId 都要全文档扫描，别在渲染帧里重算：缓存，refreshAll（=每次 doc 变化/切房）时刷新
let ctxCache: { nextDoorId: string; nextSeedId: number; propId: string; roomId: string } | null = null;
function refreshPlaceCtx(): void {
  ctxCache = {
    nextDoorId: nextDoorId(),
    nextSeedId: nextSeedId(),
    propId: placePropId,
    roomId: curKey,
  };
}
function placeCtx(): { nextDoorId: string; nextSeedId: number; propId: string; roomId: string } {
  if (!ctxCache) refreshPlaceCtx();
  return ctxCache!;
}

function hitObject(key: string, x: number, y: number): number | null {
  const room = doc.rooms[key];
  if (!room) return null;
  for (let i = room.objects.length - 1; i >= 0; i--) {
    const fp = footprint(room.objects[i]);
    if (x >= fp.x && x < fp.x + fp.w && y >= fp.y && y < fp.y + fp.h) return i;
  }
  return null;
}

// ---- 双向绑定（多对多）：开关/压力板 ↔ 门/电梯/睡莲 ----
// 触发方存 controls（binding id 列表），被控方存 triggeredBy（触发方 flagKey "房#序号" 列表）。
// 绑定/解除永远同时写两端；任意一端都能发起。

const TRIGGER_TYPES = new Set(["switch", "plate"]);
const CONTROLLED_TYPES = new Set(["door", "elevator", "lilypad"]);

function isTrigger(o: ObjRec | undefined): boolean {
  return !!o && TRIGGER_TYPES.has(o.type);
}
function isControlled(o: ObjRec | undefined): boolean {
  return !!o && CONTROLLED_TYPES.has(o.type);
}
/** 可绑物件（触发方+被控方）统一的自身 id 属性：全类型都是 `id`。 */
function bindingIdOf(o: ObjRec): string {
  return String(o.id ?? "");
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === "string") : [];
}

/** 双向绑定 trigger↔target：trigger.controls += target.id；target.triggeredBy += trigger.id。
 *  任一端缺 id 就现场分配（在 mutate 内做，撤销能完整回退）。 */
function tryBind(src: { roomId: string; index: number }, dst: { roomId: string; index: number }): void {
  const a = doc.rooms[src.roomId]?.objects[src.index];
  const b = doc.rooms[dst.roomId]?.objects[dst.index];
  if (!a || !b) return;
  if (isTrigger(a) === isTrigger(b)) {
    log("绑定必须是 开关/压力板 ↔ 门/电梯/睡莲 的组合。", "err");
    return;
  }
  const trig = isTrigger(a) ? { ...src } : { ...dst };
  const targ = isTrigger(a) ? { ...dst } : { ...src };
  let trigId = "";
  let targId = "";
  doc.mutate(() => {
    const t = doc.rooms[trig.roomId]?.objects[trig.index];
    const g = doc.rooms[targ.roomId]?.objects[targ.index];
    if (!t || !g) return;
    trigId = String(t.id ?? "") || gen6();
    t.id = trigId;
    targId = String(g.id ?? "") || gen6();
    g.id = targId;
    const cs = strList(t.controls);
    if (!cs.includes(targId)) cs.push(targId);
    t.controls = cs;
    const tb = strList(g.triggeredBy);
    if (!tb.includes(trigId)) tb.push(trigId);
    g.triggeredBy = tb;
  });
  if (trigId) log(`已双向绑定：${trigId} → ${targId}`, "ok");
}

/** 双向解除：从 src 列表摘掉 id，并在配对端摘掉对端的引用。 */
function unbind(srcKey: string, srcIndex: number, id: string): void {
  const src = doc.rooms[srcKey]?.objects[srcIndex];
  if (!src) return;
  const srcIsTrig = isTrigger(src);
  const myId = bindingIdOf(src);
  doc.mutate(() => {
    const s = doc.rooms[srcKey]?.objects[srcIndex];
    if (!s) return;
    if (srcIsTrig) {
      // id = 被控方 id：摘 controls，再摘被控方 triggeredBy 里的本触发方 id
      s.controls = strList(s.controls).filter((x) => x !== id);
      for (const room of Object.values(doc.rooms)) {
        for (const o of room.objects) {
          if (!isControlled(o)) continue;
          if (bindingIdOf(o) === id) o.triggeredBy = strList(o.triggeredBy).filter((x) => x !== myId);
        }
      }
    } else {
      // id = 触发方 id：摘 triggeredBy，再摘触发方 controls 里的本物件 id
      s.triggeredBy = strList(s.triggeredBy).filter((x) => x !== id);
      for (const room of Object.values(doc.rooms)) {
        for (const o of room.objects) {
          if (!isTrigger(o)) continue;
          if (bindingIdOf(o) === id) o.controls = strList(o.controls).filter((x) => x !== myId);
        }
      }
    }
  });
  log("已解除双向绑定。", "warn");
}

function placeObject(x: number, y: number): void {
  const spec = objSpec(placeType);
  const obj = defaultsFor(spec, x, y, placeCtx());
  // 可绑定物件统一 6 位 id（门/开关/压力板/电梯/睡莲——全类型同一属性名 `id`）
  if (["door", "switch", "plate", "elevator", "lilypad"].includes(placeType)) {
    obj.id = gen6();
  }
  // 道具类：每种道具全局一件（鞭/泡/笛/豆各一），确认后一次变更里搬走，避免撤销只撤一半
  if (placeType === "item") {
    const itemId = String(obj.item);
    let prev: { room: string; index: number } | null = null;
    for (const [k, room] of Object.entries(doc.rooms)) {
      const idx = room.objects.findIndex((o) => o.type === "item" && String(o.item) === itemId);
      if (idx >= 0) {
        prev = { room: k, index: idx };
        break;
      }
    }
    if (prev && !window.confirm(`「${itemId}」全局只能放一处（目前在 ${prev.room}）。移动到 (${x},${y})？`)) return;
    doc.mutate(() => {
      if (prev) doc.rooms[prev.room]?.objects.splice(prev.index, 1);
      doc.rooms[curKey]?.objects.push(obj);
    });
  } else if (placeType === "seed") {
    const obj2 = obj as { id?: number };
    const used = new Set<number>();
    for (const room of Object.values(doc.rooms)) {
      for (const o of room.objects) if (o.type === "seed") used.add(num(o, "id"));
    }
    if (used.has(Number(obj2.id))) {
      log("源种 1~10 已全部放置：先删一颗再放。", "err");
      return;
    }
    doc.mutate(() => {
      doc.rooms[curKey]?.objects.push(obj);
    });
  } else {
    doc.mutate(() => {
      doc.rooms[curKey]?.objects.push(obj);
    });
  }
  const room = doc.rooms[curKey];
  selection = room ? room.objects.length - 1 : null;
  refreshInspector();
  log(`已放置 ${spec.label} @ (${x},${y})——检查器中调参数`);
}

/** 批量删除框选集合：一次 mutate 整体撤销；绑定引用联动清理；序号位移警告一次。 */
function deleteMulti(): void {
  if (!multiSel.size) return;
  const victims = [...multiSel]
    .map((id) => {
      const rid = id.slice(0, id.lastIndexOf("#"));
      return { roomId: rid, index: Number(id.slice(id.lastIndexOf("#") + 1)) };
    })
    .filter((v) => doc.rooms[v.roomId]?.objects[v.index]);
  if (!victims.length) {
    multiSel.clear();
    return;
  }
  doc.mutate(() => {
    // 从后往前删（同房间内序号前移不影响前面的索引）
    for (const { roomId, index } of [...victims].sort((a, b) => b.index - a.index)) {
      const room = doc.rooms[roomId];
      const o = room?.objects[index];
      if (!o) continue;
      room.objects.splice(index, 1);
      const vid = String((o as { id?: unknown })?.id ?? "");
      const isTrig = TRIGGER_TYPES.has(o.type);
      const isCtrl = CONTROLLED_TYPES.has(o.type);
      if (vid && (isTrig || isCtrl)) {
        for (const r of Object.values(doc.rooms)) {
          for (const oo of r.objects) {
            if (isCtrl && isTrigger(oo)) oo.controls = strList(oo.controls).filter((x) => x !== vid);
            if (isTrig && isControlled(oo)) oo.triggeredBy = strList(oo.triggeredBy).filter((x) => x !== vid);
          }
        }
      }
    }
  });
  log(`已批量删除 ${victims.length} 个物件——其后物件序号前移，旧存档 flag 会错位。`, "warn");
  multiSel.clear();
  refreshInspector();
}

function deleteSelected(): void {
  if (selection == null) return;
  const room = doc.rooms[curKey];
  if (!room) return;
  const idx = selection;
  const victim = room.objects[idx];
  const vid = String((victim as { id?: unknown })?.id ?? "");
  const isTrig = !!victim && TRIGGER_TYPES.has(victim.type);
  const isCtrl = !!victim && CONTROLLED_TYPES.has(victim.type);
  doc.mutate(() => {
    room.objects.splice(idx, 1);
    // 绑定联动清理：删被控方→各触发方 controls 摘掉它；删触发方→各被控方 triggeredBy 摘掉它。
    // 不清理会留下悬空引用（校验报错、开关按了没反应）。
    if (vid && (isTrig || isCtrl)) {
      for (const r of Object.values(doc.rooms)) {
        for (const o of r.objects) {
          if (isCtrl && isTrigger(o)) o.controls = strList(o.controls).filter((x) => x !== vid);
          if (isTrig && isControlled(o)) o.triggeredBy = strList(o.triggeredBy).filter((x) => x !== vid);
        }
      }
    }
  });
  if (idx < room.objects.length) {
    // 中间删除：其后物件序号前移，既有存档 flag（bud/vinebud/switch/sp…）指向会错位
    log("已删除中间物件：其后物件序号前移，旧存档里的对应 flag 会错位。", "warn");
  }
  if (vid && (isTrig || isCtrl)) log("已同步清理双向绑定引用。", "info");
  selection = null;
  multiSel.clear();
}

function setProp(idx: number, key: string, value: unknown): void {
  const room = doc.rooms[curKey];
  if (!room) return;
  doc.mutate(() => {
    const o = room.objects[idx];
    if (o) {
      if (value === undefined) delete o[key];
      else o[key] = value;
    }
  });
}

// ---- 保存 / 复制 / 还原 ----

// 写回通道探测：dev server 带中间件时 GET /__save/* 返回哈希，不带则 404。
// 旧进程（vite.config.ts 创建之前启动的）没有这个接口，保存会静默退回剪贴板——必须让它显眼。
let channelOK: boolean | null = null;

async function probeChannel(): Promise<void> {
  try {
    let ok = true;
    const fetchHash = async (route: string): Promise<string> => {
      const res = await fetch(`/__save/${route}`);
      if (res.status === 404) ok = false;
      if (!res.ok) return "";
      return String(((await res.json()) as { hash?: string }).hash ?? "");
    };
    saveHash.game = await fetchHash("game");
    for (const m of doc.maps) saveHash.map[m.id] = await fetchHash(`map/${m.id}`);
    saveHash.materials = await fetchHash("materials");
    saveHash.props = await fetchHash("props");
    channelOK = ok;
  } catch {
    channelOK = false;
  }
  $("#channelWarn").hidden = !!channelOK;
}

let toastTimer = 0;
function toast(msg: string, level: "ok" | "warn" | "err"): void {
  let el = document.getElementById("toast") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    $("#center").appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${level} show`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), 3000);
}

async function saveToSource(): Promise<void> {
  // 只写与装载基线不同的文件：每张图一个 JSON（src/data/maps/<id>.json）+ gameMap.json。
  try {
    if (channelOK == null) await probeChannel();
    const jobs: { route: string; base: string; body: string; label: string }[] = [];
    for (const id of doc.dirtyMapIds()) {
      const m = doc.maps.find((mm) => mm.id === id)!;
      jobs.push({ route: `map/${id}`, base: saveHash.map[id] ?? "", body: serializeMap(m), label: `maps/${id}.json` });
    }
    if (doc.gameDirty()) {
      jobs.push({
        route: "game",
        base: saveHash.game,
        body: JSON.stringify({ gameMapId: doc.gameMapId }, null, 2) + "\n",
        label: "gameMap.json",
      });
    }
    if (!jobs.length) {
      doc.markClean();
      autosaveNow();
      toast("内容与已保存版本一致，没有要写的文件。", "ok");
      log("保存：无改动（所有文件与基线一致）。", "info");
      return;
    }
    // 页面刚装载、探测还没回来时哈希是空的：上面已先等探测完成，免得被 409 误报。
    const failed: string[] = [];
    for (const j of jobs) {
      const res = await fetch(`/__save/${j.route}`, {
        method: "POST",
        headers: { "x-pw-base": j.base, "content-type": "application/json" },
        body: j.body,
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; stale?: boolean; hash?: string };
      if (res.status === 409 || data.stale) {
        failed.push(j.label); // 只是"内容过期"，通道本身是好的——别动 channelOK/红色横幅的语义
        continue;
      }
      if (!res.ok || !data.ok) {
        failed.push(j.label);
        log(`写入 ${j.label} 失败：${data.error ?? res.status}`, "err");
        continue;
      }
      if (data.hash) {
        if (j.route === "game") saveHash.game = data.hash;
        else saveHash.map[j.route.slice(4)] = data.hash;
      }
    }
    if (failed.length) {
      toast(`✗ ${failed.length} 个文件保存被拒：${failed.join("、")} 在编辑器装载后被外部改过。请刷新编辑器页面！`, "err");
      log(`保存被拒（409）：${failed.join("、")} 已在外部被修改——旧页面保存会覆盖新数据，必须先刷新。`, "err");
      return;
    }
    doc.markBasesClean();
    doc.markClean();
    autosaveNow();
    channelOK = true;
    $("#channelWarn").hidden = true;
    toast(`✓ 已写回 ${jobs.length} 个文件（maps/ 目录），游戏页会自动刷新`, "ok");
    log(`已写回 ${jobs.map((j) => j.label).join("、")}（共 ${jobs.reduce((n, j) => n + j.body.length, 0)} 字符）——游戏页会自动刷新。`, "ok");
  } catch (err) {
    // 写回通道不可用（多半是 dev server 启动早于 vite.config.ts）→ 退回复制/下载
    channelOK = false;
    $("#channelWarn").hidden = false;
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await navigator.clipboard.writeText(doc.exportMap());
      toast("✗ 没保存上：写回通道不可用，重启 dev server 后再点保存。当前地图 JSON 已复制到剪贴板。", "err");
      log(`写回通道不可用（${reason}）：请重启 dev server（npx vite --port 5199 --force）后重试；已复制当前地图 JSON 到剪贴板。`, "warn");
    } catch {
      downloadText(`plantwell-map-${doc.editMapId}.json`, doc.exportMap());
      toast("✗ 没保存上：已下载当前地图 JSON，请手动放入 src/data/maps/。", "err");
      log(`写回通道不可用（${reason}）：已下载当前地图 JSON，请手动放入 src/data/maps/。`, "warn");
    }
  }
}

/** 复制当前编辑地图的 JSON（= maps/<id>.json 的文件内容）。 */
async function copyRooms(): Promise<void> {
  const m = doc.curMap();
  try {
    await navigator.clipboard.writeText(serializeMap(m));
    log(`已复制 ${m.id}（${m.name}）的地图 JSON（${serializeMap(m).length} 字符）。`, "ok");
  } catch {
    downloadText(`plantwell-map-${m.id}.json`, serializeMap(m));
    log("剪贴板不可用，已改为下载当前地图 JSON。", "warn");
  }
}

// ---- 地图导入 / 导出（单张地图 JSON 文件） ----

function exportMapFile(): void {
  const m = doc.curMap();
  downloadText(`plantwell-map-${m.id}.json`, doc.exportMap());
  log(`已导出地图 ${m.name}（${m.id}，${m.idOrder.length} 房）→ plantwell-map-${m.id}.json`, "ok");
}

function importMapFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const res = doc.importMap(String(reader.result ?? ""));
    if (!res.ok) {
      log(`导入失败：${res.error}`, "err");
      toast(`✗ 导入失败：${res.error}`, "err");
      return;
    }
    curKey = spawnRoomKey();
    selection = null;
    multiSel.clear();
    centerCameraOnRoom(curKey);
    mmEnsureVisible(curKey);
    refreshAll();
    log(`已导入「${doc.curMap().name}」为 ${doc.curMap().id}（${doc.idOrder.length} 房）。${res.warn ?? ""}`, "ok");
    if (res.warn) toast(`⚠ ${res.warn}`, "warn");
  };
  reader.readAsText(file, "utf8");
}

// ---- UI 构建 ----

const TOOLS: { id: Tool; key: string; label: string }[] = [
  { id: "select", key: "V", label: "选择/移动/框选" },
  { id: "place", key: "B", label: "放置/画笔" },
  { id: "rect", key: "R", label: "矩形填充" },
];

const TOOL_LABEL: Record<Tool, string> = {
  select: "选择/移动/框选",
  rect: "矩形填充",
  place: "放置/画笔",
};

function buildTools(): void {
  const box = $("#tools");
  const short: Record<Tool, string> = { select: "选择", place: "放置", rect: "矩形" };
  box.innerHTML = TOOLS.map(
    (t) => `<button data-tool="${t.id}" title="${t.label}（${t.key}）">${short[t.id]}<kbd>${t.key}</kbd></button>`,
  ).join("");
  box.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => setTool((b as HTMLElement).dataset.tool as Tool));
  });
}

function setTool(t: Tool): void {
  tool = t;
  selection = null;
  multiSel.clear();
  marquee = null;
  showRightTab("obj");
  refreshAll();
}

// 分类折叠状态（内存态；建筑类默认展开）
const expandedCats = new Set<string>(["build"]);

/** 建筑类特例：画笔瓦片（岩壁/空气/冰块/黑幕）不是物件，与分类一起列出。空气=擦除（画笔/矩形通用）。
 *  单一来源 = palette.TILES，这里只做展示映射——新增瓦片改 TILES 一处即可。 */
const BUILD_ENTRIES = BUILD_TILES.map((t) => ({ ch: t.ch, label: t.short, color: t.color }));
/** 附着类画笔：附着物品（@…）+ 擦除（空格清掉该格附着物）。 */
const ATTACH_ENTRIES = [
  ...TILES.filter((t) => t.layer === "attach").map((t) => ({ ch: t.ch, label: t.short, color: t.color })),
  { ch: ATTACH_ERASE_CH, label: "清除附着", color: "rgba(96,106,120,0.18)" },
];

function tileLabel(ch: string): string {
  return TILES.find((t) => t.ch === ch)?.short ?? (ch === ATTACH_ERASE_CH ? "清除附着" : ch);
}

function catCount(catId: string): number {
  if (catId === "build") return BUILD_ENTRIES.length;
  if (catId === "attach") return ATTACH_ENTRIES.length;
  return OBJ_SPECS.filter((sp) => sp.cat === catId && !sp.hidden).length;
}

function buildObjPalette(): void {
  const box = $("#objPalette");
  box.innerHTML = "";
  for (const cat of CATEGORIES) {
    const open = expandedCats.has(cat.id);
    const head = document.createElement("button");
    head.className = "catHead";
    head.title = cat.hint;
    head.innerHTML = `<span class="catArrow">${open ? "▾" : "▸"}</span>${cat.label}<span class="catCount">${catCount(cat.id)}</span>`;
    head.addEventListener("click", () => {
      if (open) expandedCats.delete(cat.id);
      else expandedCats.add(cat.id);
      buildObjPalette();
    });
    box.append(head);
    if (!open) continue;

    if (cat.id === "build") {
      for (const t of BUILD_ENTRIES) {
        const b = document.createElement("button");
        b.dataset.ch = t.ch;
        b.innerHTML = `<span class="chip" style="background:${t.color}"></span>${t.label}<kbd>${t.ch}</kbd>`;
        b.addEventListener("click", () => {
          brushTile = t.ch;
          palSel = { kind: "tile", ch: t.ch };
          // 只换材料不抢工具：已在 画笔/矩形 时保持（矩形=拖拽填充该材料）；
          // 在选择等其它工具时才切到画笔（点新材料直接开画的直觉）
          if (tool !== "place" && tool !== "rect") setTool("place");
          else refreshAll();
        });
        box.append(b);
      }
      continue;
    }

    if (cat.id === "attach") {
      // 附着类：画进房间 attach 网格（叠在瓦片/物件之上，不取代底下内容）
      for (const t of ATTACH_ENTRIES) {
        const b = document.createElement("button");
        b.dataset.ch = t.ch;
        b.innerHTML = `<span class="chip" style="background:${t.color}"></span>${t.label}<kbd>${t.ch === ATTACH_ERASE_CH ? "␣" : t.ch}</kbd>`;
        b.addEventListener("click", () => {
          brushTile = t.ch;
          palSel = { kind: "tile", ch: t.ch };
          if (tool !== "place" && tool !== "rect") setTool("place");
          else refreshAll();
        });
        box.append(b);
      }
      continue;
    }

    const specs = OBJ_SPECS.filter((sp) => sp.cat === cat.id && !sp.hidden);
    for (const sp of specs) {
      const b = document.createElement("button");
      b.dataset.type = sp.type;
      b.title = escapeHtml(sp.hint ?? "");
      b.innerHTML = `<span class="chip" style="background:${sp.color}"></span>${sp.label}`;
      b.addEventListener("click", () => {
        placeType = sp.type;
        palSel = { kind: "obj", type: sp.type };
        setTool("place");
      });
      box.append(b);
    }
  }
  refreshStatusStatic();
}

function refreshRoomSelect(): void {
  const sel = $("#roomSelect") as HTMLSelectElement;
  sel.innerHTML = doc.idOrder.map((k) => `<option value="${k}">${k}</option>`).join("");
  sel.value = curKey;
}

// ---- 地图级 UI：顶栏选择器 + 「房间」页的地图面板 ----

function refreshMapSelect(): void {
  const sel = $("#mapSelect") as HTMLSelectElement;
  sel.innerHTML = doc.maps
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)} · ${escapeHtml(m.name)}${m.id === doc.gameMapId ? " ★" : ""}</option>`,
    )
    .join("");
  sel.value = doc.editMapId;
  const gameBtn = $("#mapGame");
  gameBtn.classList.toggle("active", doc.editMapId === doc.gameMapId);
  gameBtn.title =
    doc.editMapId === doc.gameMapId
      ? `游戏地图就是当前编辑的 ${doc.editMapId}`
      : `把当前编辑的 ${doc.editMapId} 设为游戏地图（保存时写进 gameMap.json）`;
}

function refreshMapPanel(): void {
  const m = doc.curMap();
  ($("#mapName") as HTMLInputElement).value = m.name;
  ($("#spawnX") as HTMLInputElement).value = String(m.spawn.x);
  ($("#spawnY") as HTMLInputElement).value = String(m.spawn.y);
  $("#mapMeta").textContent = `${m.id} · ${m.idOrder.length} 房 · 出生房 ${m.spawn.room}`;
}

// ---- 井结构小地图：固定大小视口 + 场景缩略图选房/建房 ----
// 世界无限大：房间包围盒四周各扩 MM_MARGIN 格作为"可探索余量"，余量随房间生长而外扩——
// 右键/中键拖动可以平移进没有房间的空区，左键点空位确认后直接创建新房间。

const CELL_W = 38;
const CELL_H = 24; // 32×18 房间按 1px/格 画，留边距
const MM_VIEW_W = 248;
const MM_VIEW_H = 168; // 视口上限（px）：更大的世界靠平移看
const MM_MARGIN = 4; // 可平移出房间包围盒的余量（格）：往任何方向都能看到/点出 4 格新区
let mmX = 0;
let mmY = 0; // 视口左上角在可平移范围像素系里的偏移（范围小于视口时为负=居中）
let mmPan: { x: number; y: number; mmX: number; mmY: number } | null = null;
let mapHover: { cx: number; cy: number } | null = null;

function mapBounds(): { minCx: number; maxCx: number; minCy: number; maxCy: number } {
  const rs = Object.values(doc.rooms);
  if (!rs.length) return { minCx: 0, maxCx: 0, minCy: 0, maxCy: 0 };
  return {
    minCx: Math.min(...rs.map((r) => r.x)),
    maxCx: Math.max(...rs.map((r) => r.x)),
    minCy: Math.min(...rs.map((r) => r.y)),
    maxCy: Math.max(...rs.map((r) => r.y)),
  };
}

/** 可平移范围 = 房间包围盒向四周各扩 MM_MARGIN 格（世界"无限大"的动态表达：房间建到哪，余量就跟到哪）。 */
function panBounds(): { minCx: number; maxCx: number; minCy: number; maxCy: number } {
  const b = mapBounds();
  return {
    minCx: b.minCx - MM_MARGIN,
    maxCx: b.maxCx + MM_MARGIN,
    minCy: b.minCy - MM_MARGIN,
    maxCy: b.maxCy + MM_MARGIN,
  };
}

const mmWorldPx = (b: ReturnType<typeof panBounds>): { w: number; h: number } => ({
  w: (b.maxCx - b.minCx + 1) * CELL_W,
  h: (b.maxCy - b.minCy + 1) * CELL_H,
});

/** 视口偏移钳进可平移范围（范围比视口小则固定居中）。 */
function mmClamp(): void {
  const cv = $("#roomMap") as HTMLCanvasElement;
  const { w, h } = mmWorldPx(panBounds());
  mmX = w <= cv.width ? (w - cv.width) / 2 : Math.max(0, Math.min(w - cv.width, mmX));
  mmY = h <= cv.height ? (h - cv.height) / 2 : Math.max(0, Math.min(h - cv.height, mmY));
}

function refreshWorldGrid(): void {
  if ($("#mapDock").classList.contains("collapsed")) return;
  const cv = $("#roomMap") as HTMLCanvasElement;
  const b = panBounds();
  const { w, h } = mmWorldPx(b);
  cv.width = Math.max(1, Math.min(w, MM_VIEW_W));
  cv.height = Math.max(1, Math.min(h, MM_VIEW_H));
  mmClamp();
  const c = cv.getContext("2d")!;
  c.fillStyle = "#0b0e13";
  c.fillRect(0, 0, cv.width, cv.height);
  c.save();
  c.translate(-mmX, -mmY);
  const c0 = Math.max(0, Math.floor(mmX / CELL_W));
  const c1 = Math.min(b.maxCx - b.minCx, Math.ceil((mmX + cv.width) / CELL_W));
  const r0 = Math.max(0, Math.floor(mmY / CELL_H));
  const r1 = Math.min(b.maxCy - b.minCy, Math.ceil((mmY + cv.height) / CELL_H));
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      drawMapCell(c, b.minCx + cx, b.minCy + cy, cx * CELL_W, cy * CELL_H);
    }
  }
  c.restore();
}

/** 当前房不在小地图视口内时，把视口滚到以它为中心（贴边平滑的简化版：直接居中）。 */
function mmEnsureVisible(key: string): void {  if ($("#mapDock").classList.contains("collapsed")) return;
  const cv = $("#roomMap") as HTMLCanvasElement;
  const b = panBounds();
  const rr = doc.rooms[key];
  if (!rr) return;
  const cx = rr.x, cy = rr.y;
  const px = (cx - b.minCx) * CELL_W;
  const py = (cy - b.minCy) * CELL_H;
  const m = 6;
  const outside =
    px < mmX + m || px + CELL_W > mmX + cv.width - m || py < mmY + m || py + CELL_H > mmY + cv.height - m;
  if (!outside) return;
  const { w, h } = mmWorldPx(b);
  if (w > cv.width) mmX = px + CELL_W / 2 - cv.width / 2;
  if (h > cv.height) mmY = py + CELL_H / 2 - cv.height / 2;
  mmClamp();
  refreshWorldGrid();
}

/** 小地图视口无条件以某格为中心（打开编辑器时用；切房中的"必要时才滚"是 mmEnsureVisible）。 */
function mmCenterOn(key: string): void {
  if ($("#mapDock").classList.contains("collapsed")) return;
  const cv = $("#roomMap") as HTMLCanvasElement;
  const b = panBounds();
  const rr = doc.rooms[key];
  if (!rr) return;
  const cx = rr.x, cy = rr.y;
  mmX = (cx - b.minCx) * CELL_W + CELL_W / 2 - cv.width / 2;
  mmY = (cy - b.minCy) * CELL_H + CELL_H / 2 - cv.height / 2;
  mmClamp();
  refreshWorldGrid();
}

function drawMapCell(c: CanvasRenderingContext2D, cx: number, cy: number, px: number, py: number): void {
  const found = doc.roomAt(doc.curMap(), cx, cy);
  const key = found?.id ?? "";
  const room = found;
  const hovered = mapHover?.cx === cx && mapHover?.cy === cy;

  if (!room) {
    // 空位：可探索余量里的待建格。悬停高亮＋提示"可点此创建"
    c.strokeStyle = hovered ? "rgba(127,212,160,0.6)" : "rgba(255,255,255,0.07)";
    c.lineWidth = 1;
    if (hovered) c.setLineDash([3, 2]);
    c.strokeRect(px + 2.5, py + 2.5, CELL_W - 5, CELL_H - 5);
    c.setLineDash([]);
    if (hovered) {
      const mx = px + CELL_W / 2;
      const my = py + CELL_H / 2;
      c.strokeStyle = "rgba(127,212,160,0.9)";
      c.beginPath();
      c.moveTo(mx - 5, my);
      c.lineTo(mx + 5, my);
      c.moveTo(mx, my - 5);
      c.lineTo(mx, my + 5);
      c.stroke();
    }
    return;
  }

  // 场景缩略图：瓦片 1px/格，画在格子中央
  const ox = px + Math.floor((CELL_W - 32) / 2);
  const oy = py + Math.floor((CELL_H - 18) / 2);
  for (let ty = 0; ty < 18; ty++) {
    const row = room.map[ty] ?? "";
    for (let tx = 0; tx < 32; tx++) {
      const ch = row[tx] ?? ".";
      c.fillStyle = ch === "#" ? "#3d4653" : ch === "*" ? "#7fb2cc" : "#10151c";
      c.fillRect(ox + tx, oy + ty, 1, 1);
    }
  }
  // 附着层（黑幕等）：半透明灰盖在缩略图上
  for (let ty = 0; ty < 18; ty++) {
    const arow = room.attach?.[ty] ?? "";
    for (let tx = 0; tx < 32; tx++) {
      if (arow[tx] !== "@") continue;
      c.fillStyle = "rgba(96,106,120,0.6)";
      c.fillRect(ox + tx, oy + ty, 1, 1);
    }
  }
  // 洞口：青绿刻度标出连通方向
  c.fillStyle = "#46d47a";
  for (let y = 0; y < 18; y++) {
    if (room.map[y]?.[0] === ".") c.fillRect(ox - 1, oy + y, 1, 1);
    if (room.map[y]?.[31] === ".") c.fillRect(ox + 32, oy + y, 1, 1);
  }
  for (let x = 0; x < 32; x++) {
    if (room.map[0]?.[x] === ".") c.fillRect(ox + x, oy - 1, 1, 1);
    if (room.map[17]?.[x] === ".") c.fillRect(ox + x, oy + 18, 1, 1);
  }
  // 出生点标记
  const sp = doc.spawn();
  if (sp.room === key) {
    c.fillStyle = "#ffe9a8";
    c.fillRect(ox + Math.floor(sp.x / 10), oy + Math.floor(sp.y / 10), 2, 2);
  }
  // 边框层级：当前房 > 悬停 > 普通
  if (key === curKey) {
    c.strokeStyle = "#7fd4a0";
    c.lineWidth = 1;
    c.strokeRect(px + 1, py + 1, CELL_W - 2, CELL_H - 2);
    c.fillStyle = "#a8e8c0";
    c.font = "9px ui-monospace, monospace";
    c.fillText(key, px + 3, py + 10);
  } else {
    c.strokeStyle = hovered ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.14)";
    c.lineWidth = 1;
    c.strokeRect(px + 1.5, py + 1.5, CELL_W - 3, CELL_H - 3);
  }
}

/** 鼠标 → 井图格（含空位；空位即潜在的新房间位）。范围外返回 null。 */
function cellFromMouse(e: MouseEvent): { cx: number; cy: number } | null {
  const cv = $("#roomMap") as HTMLCanvasElement;
  const r = cv.getBoundingClientRect();
  const b = panBounds();
  const px = ((e.clientX - r.left) / r.width) * cv.width + mmX;
  const py = ((e.clientY - r.top) / r.height) * cv.height + mmY;
  const cx = b.minCx + Math.floor(px / CELL_W);
  const cy = b.minCy + Math.floor(py / CELL_H);
  if (cx < b.minCx || cx > b.maxCx || cy < b.minCy || cy > b.maxCy) return null;
  return { cx, cy };
}

const roomMapEl = $("#roomMap") as HTMLCanvasElement;
roomMapEl.addEventListener("contextmenu", (e) => e.preventDefault());
roomMapEl.addEventListener("pointerdown", (e) => {
  // 右键/中键拖动 = 平移小地图视口（空余量区域也能移过去看）
  if (e.button !== 2 && e.button !== 1) return;
  e.preventDefault();
  mmPan = { x: e.clientX, y: e.clientY, mmX, mmY };
  try {
    roomMapEl.setPointerCapture(e.pointerId);
  } catch {
    /* 合成事件/指针已释放：捕获失败不影响后续分支 */
  }
});
roomMapEl.addEventListener("pointermove", (e) => {
  if (mmPan) {
    const r = roomMapEl.getBoundingClientRect();
    const sx = roomMapEl.width / r.width;
    const sy = roomMapEl.height / r.height;
    mmX = mmPan.mmX - (e.clientX - mmPan.x) * sx;
    mmY = mmPan.mmY - (e.clientY - mmPan.y) * sy;
    mmClamp();
    refreshWorldGrid();
    return;
  }
  const cell = cellFromMouse(e);
  const changed = (cell?.cx !== mapHover?.cx) || (cell?.cy !== mapHover?.cy);
  mapHover = cell;
  if (changed) refreshWorldGrid();
});
roomMapEl.addEventListener("pointerup", () => {
  mmPan = null;
});
roomMapEl.addEventListener("mouseleave", () => {
  mapHover = null;
  refreshWorldGrid();
});
roomMapEl.addEventListener("click", (e) => {
  const cell = cellFromMouse(e);
  if (!cell) return;
  const found = doc.roomAt(doc.curMap(), cell.cx, cell.cy);
  if (found) {
    gotoRoom(found.id);
    if (pickField != null) log(`已切到房间 ${found.id}：点房间画布为「${pickField}」落点。`, "warn");
    return;
  }
  // 空位：左键点击 = 确认后创建新房间（选点/绑定点选进行中时不打断）
  if (pickField != null || bindPick) return;
  if (!window.confirm(`在 (${cell.cx},${cell.cy}) 创建新房间？（封闭边框+全空气，自行开洞）`)) return;
  createRoom(cell.cx, cell.cy);
  const created = doc.roomAt(doc.curMap(), cell.cx, cell.cy);
  if (created) mmEnsureVisible(created.id);
});


function fieldRow(o: ObjRec, f: FieldSpec): string {
  const v = o[f.key];
  if (f.kind === "binding") {
    // 多对多绑定列表：触发方显示 controls（binding id），被控方显示 triggeredBy（触发方 flagKey）。
    // 🔗 绑定 = 进点选模式（画布上点配对物件，双向写入）；× = 双向解除。
    const list = strList(v);
    const armed = bindPick != null && bindPick.roomId === curKey && bindPick.index === selection;
    const chips = list
      .map(
        (id) =>
          `<span class="bindchip">${escapeHtml(id)}<button type="button" class="bindX" data-unbind="${escapeHtml(id)}" title="解除双向绑定">×</button></span>`,
      )
      .join("");
    return `<label class="bindfield">${f.label}<span class="bindlist">${chips || `<span class="dim">(无——点下方按钮，再到画布上点配对物件${o.type === "switch" || o.type === "plate" ? "：门/电梯/睡莲" : "：开关/压力板"})</span>`}</span>` +
      `<button type="button" class="bindBtn${armed ? " armed" : ""}" data-bindpick="1">${armed ? "点画布上的目标…（Esc 取消）" : "🔗 绑定"}</button></label>`;
  }
  if (f.kind === "bool") {
    const on = v === true;
    return `<label class="boolfield"><input type="checkbox" data-k="${f.key}"${on ? " checked" : ""}><span>${f.label}${f.optional ? "" : ""}</span></label>`;
  }
  if (f.kind === "string" && f.readonly) {
    // 只读展示：绑定 id 由放置/绑定自动分配，不允许手改
    return `<label class="roidfield">${f.label}<span class="roid" title="自动分配的绑定 id（只读）">${escapeHtml(String(v ?? ""))}</span></label>`;
  }
  if (f.kind === "location") {
    const pos = objPos(o, f.key);
    const armed = pickField === f.key && pickIndex === selection;
    return `<label class="locfield">${f.label}<span class="locrow">` +
      `<input class="loc-room" data-k="${f.key}" data-lk="room_id" type="text" value="${escapeHtml(pos.room_id)}" title="房间 id（3 位，如 R05）">` +
      `<input class="loc-xy" data-k="${f.key}" data-lk="x" type="number" min="0" max="31" value="${pos.x}" title="格 x">` +
      `<input class="loc-xy" data-k="${f.key}" data-lk="y" type="number" min="0" max="17" value="${pos.y}" title="格 y">` +
      `<button type="button" class="pickBtn${armed ? " armed" : ""}" data-pick="${f.key}" title="点房间画布选点（点小地图切房间，Esc 取消）">` +
      `${armed ? "选点中" : "选点"}</button>` +
      `</span></label>`;
  }
  if (f.kind === "number") {
    return `<label>${f.label}<input data-k="${f.key}" type="number" value="${v ?? ""}"${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.optional ? ` placeholder="留空"` : ""}></label>`;
  }
  if (f.kind === "string") {
    return `<label>${f.label}<input data-k="${f.key}" type="text" value="${escapeHtml(String(v ?? ""))}"></label>`;
  }
  if (f.kind === "intarray") {
    const arr = Array.isArray(v) ? (v as unknown[]).join(",") : "";
    return `<label>${f.label}<input data-k="${f.key}" type="text" value="${escapeHtml(arr)}" placeholder="-1=随机，如 3,-1,4"></label>`;
  }
  if (f.kind === "propid") {
    const cur = String(v ?? "");
    const opts = allPropIds();
    return `<label>${f.label}<select data-k="${f.key}">${opts
      .map((id) => {
        const pd = propByIdDoc(id)!;
        return `<option value="${id}"${id === cur ? " selected" : ""}>${escapeHtml(pd.label)} (${id})</option>`;
      })
      .join("")}</select></label>`;
  }
  const opts: readonly string[] = f.kind === "item" ? ITEM_IDS : (f.options ?? []);
  const cur = String(v ?? "");
  return `<label>${f.label}<select data-k="${f.key}">${f.optional ? `<option value="">(无)</option>` : ""}${opts
    .map((op) => `<option value="${op}"${op === cur ? " selected" : ""}>${op}</option>`)
    .join("")}</select></label>`;
}

function showRightTab(id: "obj" | "room"): void {
  document.querySelectorAll("#rightTabs button").forEach((b) => {
    b.classList.toggle("active", (b as HTMLElement).dataset.tab === id);
  });
  $("#rightObj").hidden = id !== "obj";
  $("#rightRoom").hidden = id !== "room";
}

function refreshInspector(): void {
  const box = $("#inspector");
  const banner = $("#pickBanner");
  if (banner) {
    banner.hidden = pickField == null;
    if (pickField && pickHome && pickHome !== curKey) {
      banner.textContent = `选点中 · 物件在 ${pickHome} · 点画布落点 · Esc 取消`;
    } else if (pickField) {
      banner.textContent = "选点中 · 点画布落点 · Esc 取消";
    }
  }
  const room = doc.rooms[curKey];
  // 框选多选：显示批量操作卡片（数量/类型汇总 + Del 删除 + Esc 清空）
  if (multiSel.size && selection == null) {
    const byType = new Map<string, number>();
    for (const id of multiSel) {
      const [k, i] = [id.slice(0, id.lastIndexOf("#")), Number(id.slice(id.lastIndexOf("#") + 1))];
      const t = doc.rooms[k]?.objects[i]?.type ?? "?";
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const summary = [...byType.entries()].map(([t, n]) => `${objSpec(t).label}×${n}`).join("、");
    box.innerHTML = `<div class="empty">
        <h3>框选 ${multiSel.size} 个物件</h3>
        <p class="dim">${escapeHtml(summary)}</p>
        <div class="row"><button id="multiDel" class="danger" style="flex:1">删除所选（Del）</button><button id="multiClear" class="ghost">清空选择（Esc）</button></div>
        <p class="hint">拖拽单个物件可移动它；框选集合不跟随单物件拖动。撤销（Ctrl+Z）可整体回退批量删除。</p>
      </div>`;
    box.querySelector("#multiDel")?.addEventListener("click", deleteMulti);
    box.querySelector("#multiClear")?.addEventListener("click", () => {
      multiSel.clear();
      refreshInspector();
    });
    return;
  }
  const sel = selection != null && room ? room.objects[selection] : undefined;
  if (!sel) {
    const placing = tool === "place" || tool === "rect";
    let title = "检查器";
    let cardLabel = objSpec(placeType).label;
    let cardHint = objSpec(placeType).hint ?? "";
    if (palSel.kind === "tile") {
      const isAttach = brushTile === "@" || brushTile === ATTACH_ERASE_CH;
      title = tool === "rect" ? "矩形填充" : placing ? (isAttach ? "涂抹附着" : "铺设") : "检查器";
      cardLabel = tileLabel(brushTile);
      cardHint = isAttach
        ? brushTile === "@"
          ? tool === "rect"
            ? "拖拽画矩形涂黑幕。附着层独立于瓦片：不取代底下的岩壁/物件。"
            : "长按拖动涂黑幕（附着层）。连通的黑幕视为一块：不在其中时该块完全涂黑，进入才显形且其余区域全黑。"
          : tool === "rect"
            ? "拖拽矩形清除该区域附着物。"
            : "长按拖动清除附着物（不动底下瓦片/物件）。"
        : brushTile === "#"
          ? tool === "rect"
            ? "拖拽画矩形填充实心岩。长按铺设请用「放置」。"
            : "长按拖动铺设实心岩。右键拖动可平移画布看到邻房。"
          : brushTile === "*"
            ? tool === "rect"
              ? "拖拽画矩形铺冰面。"
              : "长按拖动铺冰面（走上去更快，松手会滑）。"
            : tool === "rect"
              ? "拖拽画矩形擦成空气。"
              : "长按拖动把涂到的格变成空气（原橡皮）。";
    } else {
      title = placing ? "放置" : "检查器";
    }
    box.innerHTML = `<div class="empty">
        <h3>${title}</h3>
        <p class="dim">${placing ? "在画布上拖动或点击；右键/中键拖动平移画布。" : "用「选择」点击物件可编辑属性；空白处拖拽=框选多选。"}</p>
        <div class="placeCard"><b>${escapeHtml(cardLabel)}</b><p class="hint" style="margin:4px 0 0">${escapeHtml(cardHint)}</p></div>
      </div>`;
    return;
  }
  showRightTab("obj");
  const spec = objSpec(sel.type);
  const scaleV = num(sel, "scale", 1);
  const jitV = num(sel, "scaleJit", 0);
  const isVine = sel.type === "vine";
  const isVinebud = sel.type === "vinebud";
  box.innerHTML = `
    <h3>检查器</h3>
    <div class="objhead"><span class="chip" style="background:${spec.color}"></span>
      <b>${spec.label}</b><span class="dim">#${selection} · ${spec.solid ? "交互体" : "装饰"}</span></div>
    <div class="grid">${spec.fields.map((f) => fieldRow(sel, f)).join("")}</div>
    <h3>外观</h3>
    <div class="grid">
      <label>缩放 scale<input data-sk="scale" type="number" step="0.05" min="0.3" max="3" value="${scaleV}" placeholder="1"></label>
      <label>随机 ±<input data-sk="scaleJit" type="number" step="0.05" min="0" max="0.6" value="${jitV}" placeholder="0"></label>
    </div>
    <p class="hint dim">随机幅度：放置加载时在 scale × (1 ± 幅度) 内按房间确定性取值，纯视觉不碰判定。</p>
    ${spec.hint ? `<p class="hint">${escapeHtml(spec.hint)}</p>` : ""}
    <div class="row">
      <button id="matObj" title="打开材质工坊并定位到这类物件">🎨 材质</button>
      ${["door", "elevator", "lilypad", "switch", "plate"].includes(sel.type) && String(sel.id ?? "") ? `<button id="copyId" title="复制自身 ID——开关 controls / 被控 triggeredBy 里记录的就是它">📋 复制 ID</button>` : ""}
      ${isVine ? `<button id="morphObj" title="变成可砍断/可攀爬的藤墙（vinebud）">→ 藤荚模式</button>` : ""}
      ${isVinebud ? `<button id="morphObj" title="变回纯装饰的摆动藤蔓（vine）">→ 装饰藤模式</button>` : ""}
    </div>
    <p class="hint dim">存档标记按列表序号索引：新增物件总是追加到末尾；在中间插入或删除，其后物件的存档序号会整体位移。</p>
    <button id="delObj" class="danger">删除物件（Del）</button>`;
  box.querySelectorAll("input[data-k],select[data-k]").forEach((el) => {
    el.addEventListener("change", () => {
      const f = spec.fields.find((ff) => ff.key === (el as HTMLElement).dataset.k);
      const idx = selection;
      if (!f || idx == null) return;
      // 语义坐标（location/end）：room_id / x / y 三个子输入分别落进同一个对象
      const lk = (el as HTMLElement).dataset.lk;
      if (f.kind === "location" && lk) {
        const room = doc.rooms[curKey];
        const o = room?.objects[idx];
        if (!o) return;
        const pos = { ...objPos(o, f.key) };
        if (lk === "room_id") {
          const sv = (el as HTMLInputElement).value.trim();
          if (!sv) {
            log("room_id 不能为空（本房坐标请填当前房间代号）", "warn");
            refreshInspector();
            return;
          }
          pos.room_id = sv;
        } else {
          const n = Number((el as HTMLInputElement).value);
          if (!Number.isFinite(n)) return;
          pos[lk === "x" ? "x" : "y"] = Math.round(Math.max(0, Math.min(lk === "x" ? 31 : 17, n)));
        }
        doc.mutate(() => {
          const oo = doc.rooms[curKey]?.objects[idx];
          if (oo) oo[f.key] = pos;
        });
        return;
      }
      let v: unknown;
      if (f.kind === "number") {
        const raw = (el as HTMLInputElement).value.trim();
        if (raw === "") {
          if (!f.optional) return;
          v = undefined;
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          v = clampNum(n, f);
        }
      } else if (f.kind === "bool") {
        v = (el as HTMLInputElement).checked;
      } else if (f.kind === "string") {
        const s = (el as HTMLInputElement).value.trim();
        if (!s) {
          log(`${f.label} 不能为空`, "warn");
          refreshInspector();
          return;
        }
        v = s;
      } else if (f.kind === "intarray") {
        const raw = (el as HTMLInputElement).value.trim();
        if (raw === "") {
          v = undefined;
        } else {
          const arr = raw.split(/[,，\s]+/).map(Number).filter((n) => Number.isFinite(n));
          if (!arr.length) {
            log("lens 格式：逗号分隔的数字，如 3,1,4", "warn");
            return;
          }
          v = arr;
        }
      } else {
        const s = (el as HTMLSelectElement).value;
        v = s === "" ? undefined : s;
      }
      setProp(idx, f.key, v);
    });
  });
  box.querySelectorAll("input[data-sk]").forEach((el) => {
    el.addEventListener("change", () => {
      const key = (el as HTMLElement).dataset.sk!;
      const idx = selection;
      const room = doc.rooms[curKey];
      if (idx == null || !room) return;
      const raw = (el as HTMLInputElement).value.trim();
      doc.mutate(() => {
        const o = room.objects[idx];
        if (!o) return;
        if (raw === "") {
          delete o[key];
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        if (key === "scale") o[key] = Math.min(3, Math.max(0.3, Math.round(n * 100) / 100));
        else o[key] = Math.min(0.6, Math.max(0, Math.round(n * 100) / 100));
      });
    });
  });
  (box.querySelector("#copyId") as HTMLButtonElement | null)?.addEventListener("click", () => {
    const id = String(sel.id ?? "");
    if (!id) return;
    void navigator.clipboard.writeText(id).then(
      () => log(`已复制绑定 ID：${id}`),
      () => log("复制失败：剪贴板不可用", "warn"),
    );
  });
  (box.querySelector("#matObj") as HTMLButtonElement | null)?.addEventListener("click", () => {
    if (sel.type === "prop") openWorkshop($("#workshop"), wsHooks, "props", { propId: String(sel.id ?? "") });
    else openWorkshop($("#workshop"), wsHooks, "materials", { matType: sel.type });
  });
  (box.querySelector("#morphObj") as HTMLButtonElement | null)?.addEventListener("click", () => {
    const idx = selection;
    const room = doc.rooms[curKey];
    if (idx == null || !room) return;
    doc.mutate(() => {
      const o = room.objects[idx];
      if (!o) return;
      const h = num(o, "h", 3);
      const next: ObjRec =
        o.type === "vine" ? { type: "vinebud", location: o.location, h } : { type: "vine", location: o.location, h };
      // 通用外观属性跨形态保留（scale/scaleJit 是全物件通用的）
      for (const k of ["scale", "scaleJit"] as const) {
        if (o[k] !== undefined) next[k] = o[k];
      }
      room.objects[idx] = next;
    });
    log(sel.type === "vine" ? "已切换为藤荚模式（可砍断/攀爬）" : "已切换回装饰藤");
  });
  box.querySelectorAll("button[data-pick]").forEach((b) => {
    b.addEventListener("click", () => {
      const key = (b as HTMLElement).dataset.pick!;
      if (pickField === key && pickIndex === selection) {
        pickField = null;
        pickIndex = null;
        pickHome = null;
      } else {
        pickField = key;
        pickIndex = selection;
        pickHome = curKey;
        log(key === "end" ? "选点模式：点房间画布落终点，点小地图切房间（可跨房），Esc 取消。" : "选点模式：点本房间画布落点。本体位置不能跨房，Esc 取消。", "warn");
      }
      refreshInspector();
    });
  });
  // 🔗 绑定：进入点选模式（可跨房）；× 双向解除
  box.querySelectorAll("button[data-bindpick]").forEach((b) => {
    b.addEventListener("click", () => {
      if (selection == null) return;
      if (bindPick && bindPick.roomId === curKey && bindPick.index === selection) {
        bindPick = null;
        log("已取消绑定。", "warn");
      } else {
        bindPick = { roomId: curKey, index: selection };
        const o = doc.rooms[curKey]?.objects[selection];
        log(
          isTrigger(o)
            ? "绑定点选中：点画布上的 门/电梯/睡莲（可右键拖到别的房间再点），Esc 取消。"
            : "绑定点选中：点画布上的 开关/压力板（可右键拖到别的房间再点），Esc 取消。",
          "warn",
        );
      }
      refreshInspector();
    });
  });
  box.querySelectorAll("button[data-unbind]").forEach((b) => {
    b.addEventListener("click", () => {
      if (selection == null) return;
      unbind(curKey, selection, (b as HTMLElement).dataset.unbind!);
      refreshInspector();
    });
  });
  (box.querySelector("#delObj") as HTMLButtonElement | null)?.addEventListener("click", deleteSelected);
}

function refreshLights(): void {
  const box = $("#lights");
  const room = doc.rooms[curKey];
  refreshRoomColor(room); // 房间配色必须独立于光源列表刷新——“无光源早退”曾把面板冻在旧色（黑色 bug 根因）
  const ls = room?.lights ?? [];
  if (!ls.length) {
    box.innerHTML = `<p class="dim">无固定光源。</p>`;
    return;
  }
  box.innerHTML = ls
    .map(
      (l, i) =>
        `<div class="light"><span class="dim">#${i}</span><input data-i="${i}" data-k="x" type="number" value="${l.x}" title="x (px)"><input data-i="${i}" data-k="y" type="number" value="${l.y}" title="y (px)"><input data-i="${i}" data-k="r" type="number" value="${l.r}" title="半径 r (px)"><button data-del="${i}" class="mini" title="删除光源">×</button></div>`,
    )
    .join("");
  box.querySelectorAll("input[data-k]").forEach((el) => {
    el.addEventListener("change", () => {
      const room2 = doc.rooms[curKey];
      const i = Number((el as HTMLElement).dataset.i);
      const k = (el as HTMLElement).dataset.k!;
      const n = Number((el as HTMLInputElement).value);
      if (!room2 || !room2.lights?.[i] || !Number.isFinite(n)) return;
      doc.mutate(() => {
        const l = room2.lights![i];
        l[k as "x" | "y" | "r"] = Math.max(0, Math.round(n));
      });
    });
  });
  box.querySelectorAll("button[data-del]").forEach((el) => {
    el.addEventListener("click", () => {
      const room2 = doc.rooms[curKey];
      const i = Number((el as HTMLElement).dataset.del);
      if (!room2?.lights) return;
      doc.mutate(() => {
        room2.lights!.splice(i, 1);
      });
    });
  });
}

function refreshStatusStatic(): void {
  $("#dirty").hidden = !doc.dirty;
  ($("#undo") as HTMLButtonElement).disabled = !doc.canUndo();
  ($("#redo") as HTMLButtonElement).disabled = !doc.canRedo();
  let toolText = `${TOOL_LABEL[tool]}`;
  if (tool === "place") {
    toolText += palSel.kind === "tile"
      ? `：${tileLabel(brushTile)}（长按${brushTile === "@" || brushTile === ATTACH_ERASE_CH ? "涂抹" : "铺设"}）`
      : placeType === "prop"
        ? `：自定义物件 ${propByIdDoc(placePropId)?.label ?? placePropId}`
        : `：${objSpec(placeType).label}`;
  } else if (tool === "rect" && palSel.kind === "tile") {
    toolText += `：${tileLabel(brushTile)}（拖拽画矩形）`;
  }
  $("#stTool").textContent = toolText;
  const issues = doc.validate();
  const errs = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warn").length;
  const stIss = $("#stIssues");
  stIss.classList.remove("err", "warn", "ok");
  if (errs) {
    stIss.textContent = `校验 ${errs} 错`;
    stIss.classList.add("err");
  } else if (warns) {
    stIss.textContent = `校验 ${warns} 警告`;
    stIss.classList.add("warn");
  } else {
    stIss.textContent = "校验 OK";
    stIss.classList.add("ok");
  }
  document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.tool === tool));
  document.querySelectorAll("#objPalette button[data-ch]").forEach((b) => b.classList.toggle("active", tool === "place" && palSel.kind === "tile" && (b as HTMLElement).dataset.ch === brushTile));
  document.querySelectorAll("#objPalette button").forEach((b) => {
    const el = b as HTMLElement;
    b.classList.toggle(
      "active",
      tool === "place" && palSel.kind === "obj" && el.dataset.type === placeType,
    );
  });
  ($("#playLink") as HTMLAnchorElement).href = `/?debug=1&room=${encodeURIComponent(curKey)}`;
  const mk = $("#mapKey");
  if (mk) mk.textContent = curKey;
}

function refreshAll(): void {
  curKey = ensureKey(curKey);
  refreshPlaceCtx();
  refreshMapSelect();
  refreshRoomSelect();
  refreshMapPanel();
  refreshWorldGrid();
  refreshInspector();
  refreshLights();
  refreshStatusStatic();
}

// ---- 画布交互 ----

function mouseTile(e: MouseEvent): { roomId: string; x: number; y: number } | null {
  const r = canvas.getBoundingClientRect();
  return renderer.toWorldTile(doc, e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 1) e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 合成事件/指针已释放：捕获失败不影响后续分支 */
  }
  // 右键 / 中键：开始平移画布（替代旧右键橡皮——擦除请选橡皮工具）
  if (e.button === 2 || e.button === 1) {
    panState = { x: e.clientX, y: e.clientY, camX: renderer.camX, camY: renderer.camY };
    return;
  }
  const wt = mouseTile(e);
  if (e.button !== 0 || !wt) {
    if (tool === "select") {
      selection = null;
      refreshInspector();
    }
    return;
  }
  // 🔗 绑定点选：下一次点击落在配对物件上即完成双向绑定；点空白/Esc 取消
  if (bindPick) {
    const src = bindPick;
    bindPick = null;
    const idx = wt ? hitObject(wt.roomId, wt.x, wt.y) : null;
    if (idx == null) log("已取消绑定（没点到物件）。", "warn");
    else tryBind(src, { roomId: wt.roomId, index: idx });
    refreshInspector();
    return;
  }
  // 📍 出生点选点：点哪格，出生点（房间+像素）就落到哪
  if (spawnPick) {
    spawnPick = false;
    doc.setSpawnRoom(wt.roomId);
    doc.setSpawnPos(wt.x * 10 + 5, wt.y * 10 + 5);
    log(`出生点 → ${wt.roomId} (${wt.x * 10 + 5},${wt.y * 10 + 5})`, "ok");
    refreshAll();
    return;
  }
  // 落到哪个房间，工作房就切到哪（点击别的房间的物件/落点=跨房编辑）
  const roomId = wt.roomId;
  const tile = { x: wt.x, y: wt.y };
  // 🎯 选点模式：location 只能点所在房；end 可跨房点选
  if (pickField != null && pickIndex != null && pickHome != null) {
    const idx = pickIndex;
    const key = pickField;
    const home = pickHome;
    if (key === "location" && roomId !== home) {
      log("本体位置属于所在房间，不能点到别的房间。跨房终点请用「终点」字段。", "warn");
    } else {
      const rid = doc.rooms[roomId]?.id ?? roomId;
      doc.mutate(() => {
        const o = doc.rooms[home]?.objects[idx];
        if (o) o[key] = { room_id: rid, x: tile.x, y: tile.y };
      });
      log(`已选点 ${roomId} (${tile.x},${tile.y}) → ${key}`, "ok");
    }
    pickField = null;
    pickIndex = null;
    pickHome = null;
    refreshInspector();
    return;
  }
  switch (tool) {
    case "rect": {
      // 矩形填充：建筑材料（岩壁/空气）拖拽画矩形，材料=调色板当前选中的瓦片。
      // 落在邻房=直接切工作房执行（视角不动，井图高亮跟随）
      if (roomId !== curKey) switchWorkRoom(roomId);
      rectAnchor = tile;
      break;
    }
    case "place": {
      if (palSel.kind === "tile") {
        if (roomId !== curKey) switchWorkRoom(roomId);
        // 建筑类：长按拖动铺设（空气=擦除）
        paintValue = brushTile;
        paintPre = doc.beginLive();
        paintRaw(tile.x, tile.y, paintValue);
        lastPaint = tile;
        doc.touch();
      } else {
        // 物件放置：可放到视野里任意房间（跨房装电梯/睡莲的正路）；视角不动
        if (roomId !== curKey) switchWorkRoom(roomId);
        placeObject(tile.x, tile.y);
      }
      break;
    }
    case "select": {
      // 框选或单选：按下点在物件上=单选+拖动；在空白处=框选多选（建筑瓦片不参与）
      const idx = hitObject(roomId, tile.x, tile.y);
      if (idx == null) {
        // 框选开始：清单选，marquee 随拖拽更新（pointermove）
        selection = null;
        multiSel.clear();
        marquee = { x0: tile.x, y0: tile.y, x1: tile.x, y1: tile.y };
        refreshInspector();
        return;
      }
      if (roomId !== curKey) switchWorkRoom(roomId);
      selection = idx;
      const o = doc.rooms[roomId]!.objects[idx];
      const pos = objPos(o);
      dragObj = {
        roomId: roomId,
        index: idx,
        startX: tile.x,
        startY: tile.y,
        ox: pos.x,
        oy: pos.y,
        pre: doc.beginLive(),
      };
      refreshInspector();
      break;
    }
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (panState) {
    // 平移画布
    const s = panState;
    renderer.camX = s.camX - (e.clientX - s.x);
    renderer.camY = s.camY - (e.clientY - s.y);
    hover = null;
    return;
  }
  const wt = mouseTile(e);
  hover = wt ? { x: wt.x, y: wt.y } : null;
  hoverKey = wt ? wt.roomId : null;
  if (wt) lastTile = { x: wt.x, y: wt.y };
  if (wt && marquee) {
    // 框选拖拽：矩形随鼠标更新（跨房坐标各自成立，pointerup 时统一收集）
    marquee.x1 = wt.x;
    marquee.y1 = wt.y;
  }
  if (wt && paintValue) {
    if (wt.roomId !== curKey) return; // 铺设中拖出房界就不继续画
    const tile = { x: wt.x, y: wt.y };
    if (lastPaint) paintLine(lastPaint, tile, paintValue);
    else paintRaw(tile.x, tile.y, paintValue);
    lastPaint = tile;
    doc.touch();
  }
  if (wt && dragObj) {
    const o = doc.rooms[dragObj.roomId]?.objects[dragObj.index];
    if (o) {
      const loc = { ...objPos(o) };
      // 拖到别的房间：坐标跟随新房间并更新 room_id
      const dx = wt.x - dragObj.startX;
      const dy = wt.y - dragObj.startY;
      const nx = dragObj.ox + dx;
      const ny = dragObj.oy + dy;
      if (nx < -4 || ny < -4 || nx > 35 || ny > 21) return; // 拖太远就不动（防误丢）
      loc.room_id = doc.rooms[wt.roomId]?.id ?? loc.room_id;
      loc.x = Math.max(0, Math.min(31, nx));
      loc.y = Math.max(0, Math.min(17, ny));
      o.location = loc;
      doc.touch();
    }
  }
});

canvas.addEventListener("pointerup", () => {
  if (panState) {
    panState = null;
    return;
  }
  if (paintValue) {
    if (paintPre) doc.commitLive(paintPre);
    paintValue = null;
    paintPre = null;
    lastPaint = null;
  }
  if (rectAnchor) {
    if (lastTile) fillRect(rectAnchor.x, rectAnchor.y, lastTile.x, lastTile.y, brushTile);
    rectAnchor = null;
  }  if (marquee) {
    // 框选结束：收集矩形覆盖的所有物件（当前房间、建筑瓦片除外）；与单选互斥。
    // 坐标是当前房局部格——只和本房物件比。曾错误地遍历全部房间：局部坐标跨房比较，
    // 把邻房同位置的东西全抓了（框一个萤火虫显示选中 9 个就是这个 bug）。
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    multiSel.clear();
    for (const k of [curKey]) {
      const room = doc.rooms[k];
      if (!room) continue;
      room.objects.forEach((o, i) => {
        const fp = footprint(o);
        // 命中=重叠 ≥ 物件面积的一半（或被框完全包含）——边角相蹭不算，
        // 否则路过的大框会把沿途小物件全卷进来（框一个萤火虫卷走 9 个的教训）
        const ox0 = Math.max(fp.x, x0);
        const ox1 = Math.min(fp.x + fp.w, x1 + 1);
        const oy0 = Math.max(fp.y, y0);
        const oy1 = Math.min(fp.y + fp.h, y1 + 1);
        if (ox0 >= ox1 || oy0 >= oy1) return; // 不相交
        if ((ox1 - ox0) * (oy1 - oy0) * 2 < fp.w * fp.h) return;
        multiSel.add(`${k}#${i}`);
      });
    }
    marquee = null;
    selection = null;
    refreshInspector();
    if (multiSel.size) log(`框选了 ${multiSel.size} 个物件——Del 批量删除，或按住框内拖动整体移动。`, "ok");
    return;
  }
  if (dragObj) {
    const o = doc.rooms[dragObj.roomId]?.objects[dragObj.index];
    const moved = o && (objPos(o).x !== dragObj.ox || objPos(o).y !== dragObj.oy);
    if (moved) doc.commitLive(dragObj.pre);
    else doc.cancelLive();
    dragObj = null;
  }
});

canvas.addEventListener("pointerleave", () => {
  if (!panState) hover = null;
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ---- 键盘 ----

addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === "KeyS") {
    e.preventDefault();
    void saveToSource();
    return;
  }
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
    return;
  }
  if (mod && e.code === "KeyY") {
    e.preventDefault();
    doc.redo();
    return;
  }
  if (e.repeat) return;
  if (e.code === "Delete" || e.code === "Backspace") {
    if (multiSel.size) deleteMulti();
    else deleteSelected();
    return;
  }
  if (e.code === "Escape") {
    if (multiSel.size) {
      multiSel.clear();
      refreshInspector();
      log("已清空框选。", "info");
      return;
    }
    const help = $("#helpOverlay");
    if (help && !help.hidden) {
      help.hidden = true;
      return;
    }
    if (bindPick) {
      bindPick = null;
      log("已取消绑定。", "warn");
      refreshInspector();
      return;
    }
    if (spawnPick) {
      spawnPick = false;
      log("已取消出生点选点。", "warn");
      return;
    }
    if (pickField != null) {
      pickField = null;
      pickIndex = null;
      pickHome = null;
      log("已取消选点。", "warn");
    } else {
      selection = null;
    }
    refreshInspector();
    return;
  }
  if (e.code === "BracketLeft") {
    stepRoom(-1);
    return;
  }
  if (e.code === "BracketRight") {
    stepRoom(1);
    return;
  }
  switch (e.code) {
    case "KeyV":
      setTool("select");
      break;
    case "KeyB":
      setTool("place");
      break;
    case "KeyR":
      setTool("rect");
      break;
  }
});

addEventListener("beforeunload", (e) => {
  if (doc.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---- 顶栏按钮 ----

const wsHooks: WorkshopHooks = {
  log: (msg, level) => log(msg, level),
  onPropsChanged: () => {
    if (placeType === "prop" && !propByIdDoc(placePropId)) placePropId = firstPropId();
    buildObjPalette();
    refreshAll();
  },
  requestPlace: (propId) => {
    placePropId = propId;
    placeType = "prop";
    // 画布落点与 ghost 预览都按 palSel 分流：不同步它，画布单击会落到上一次的调色板选择
    palSel = { kind: "obj", type: "prop" };
    setTool("place");
  },
};
$("#matBtn").addEventListener("click", () => openWorkshop($("#workshop"), wsHooks, "materials"));
$("#propBtn").addEventListener("click", () => openWorkshop($("#workshop"), wsHooks, "props"));

// ---- 地图操作（顶栏 + 房间页地图面板） ----

($("#mapSelect") as HTMLSelectElement).addEventListener("change", (e) => applyEditMap((e.target as HTMLSelectElement).value));
$("#mapNew").addEventListener("click", () => {
  const id = doc.addMap();
  curKey = spawnRoomKey();
  selection = null;
  centerCameraOnRoom(curKey);
  mmEnsureVisible(curKey);
  refreshAll();
  log(`已新建地图 ${id}（封闭起始房，出生点已就位）——改个名字就开画。`, "ok");
});
$("#mapExport").addEventListener("click", () => exportMapFile());
$("#mapFile").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) importMapFile(f);
  input.value = ""; // 允许连续导入同一文件
});
$("#mapImport").addEventListener("click", () => $("#mapFile").click());
$("#mapGame").addEventListener("click", () => {
  if (doc.gameMapId === doc.editMapId) {
    log(`${doc.editMapId} 已经是游戏地图。`, "info");
    return;
  }
  doc.setGameMap(doc.editMapId);
  refreshAll();
  log(`★ 已把 ${doc.editMapId} 设为游戏地图——点「保存」写进 gameMap.json，游戏页即切过去。`, "ok");
});
$("#mapName").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value.trim();
  if (!v) {
    refreshMapPanel();
    return;
  }
  doc.renameMap(doc.editMapId, v);
  log(`地图已改名：${v}`, "ok");
});
$("#pickSpawn").addEventListener("click", () => {
  spawnPick = true;
  log("出生点选点：点击房间画布任意一格，把出生点设到那（Esc 取消）。", "info");
});
$("#mapSetSpawn").addEventListener("click", () => {
  doc.setSpawnRoom(curKey);
  refreshAll();
  log(`出生点房间 → ${curKey}（${doc.spawnRaw().room}）。`, "ok");
});
for (const id of ["spawnX", "spawnY"] as const) {
  ($("#" + id) as HTMLInputElement).addEventListener("change", (e) => {
    const n = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(n)) return;
    const sp = doc.spawnRaw();
    doc.setSpawnPos(id === "spawnX" ? n : sp.x, id === "spawnY" ? n : sp.y);
    refreshAll();
  });
}
$("#mapDelete").addEventListener("click", () => {
  const m = doc.curMap();
  if (doc.maps.length <= 1) {
    log("最后一张地图不能删——建一张新的再删这张。", "warn");
    return;
  }
  if (!window.confirm(`删除地图「${m.name}」（${m.id}，${m.idOrder.length} 房）？不可撤销（除非保存前还原）。`)) return;
  const hadFile = !!saveHash.map[m.id];
  doc.deleteMap(m.id);
  curKey = spawnRoomKey();
  selection = null;
  centerCameraOnRoom(curKey);
  refreshAll();
  // 磁盘上已有这张图的文件（装载时就在，或本会话保存过）→ 连文件一起删（保存时不删文件）
  if (hadFile) {
    void fetch(`/__save/map/${m.id}`, { method: "DELETE", headers: { "x-pw-base": saveHash.map[m.id] } })
      .then((r) => (r.ok ? log(`已删除地图 ${m.id} 及其文件 maps/${m.id}.json。`, "warn") : log(`地图 ${m.id} 已从文档移除，但文件删除失败（HTTP ${r.status}）——可手动删 src/data/maps/${m.id}.json。`, "err")))
      .catch(() => log(`地图 ${m.id} 已从文档移除，但文件删除失败（通道不可用）——可手动删 src/data/maps/${m.id}.json。`, "err"));
  } else {
    log(`已删除地图 ${m.id}（本会话新建、从未保存，磁盘无文件）。`, "warn");
  }
});

let chromeReady = false;
function setupChrome(): void {
  if (chromeReady) return;
  chromeReady = true;
  document.querySelectorAll("#rightTabs button").forEach((b) => {
    b.addEventListener("click", () => {
      const id = (b as HTMLElement).dataset.tab === "room" ? "room" : "obj";
      showRightTab(id);
      if (id === "room") refreshWorldGrid();
    });
  });
  $("#helpBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const ov = $("#helpOverlay");
    ov.hidden = !ov.hidden;
  });
  $("#helpOverlay").addEventListener("click", (e) => {
    if (e.target === $("#helpOverlay")) $("#helpOverlay").hidden = true;
  });
  $("#stLogBtn").addEventListener("click", () => {
    const d = $("#logDrawer");
    d.hidden = !d.hidden;
  });
  $("#stIssues").addEventListener("click", () => {
    const issues = doc.validate();
    $("#logDrawer").hidden = false;
    if (!issues.length) {
      log("校验通过，没有问题。", "ok");
      return;
    }
    for (const i of issues.slice(0, 40)) {
      const loc = i.room ? `${i.room}${i.x != null ? ` (${i.x},${i.y})` : ""} ` : "";
      log(`${loc}${i.msg}`, i.level === "error" ? "err" : i.level === "warn" ? "warn" : "info");
    }
    if (issues.length > 40) log(`……还有 ${issues.length - 40} 条`, "info");
  });
  const MAP_OPEN_KEY = "plantwell.editor.mapOpen";
  const applyMapOpen = (open: boolean): void => {
    $("#mapDock").classList.toggle("collapsed", !open);
    $("#mapToggle").title = open ? "折叠井图" : "展开井图";
    try {
      localStorage.setItem(MAP_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (open) {
      refreshWorldGrid();
      mmCenterOn(curKey); // 展开井图同样以当前工作房间为中心
    }
  };
  applyMapOpen(localStorage.getItem(MAP_OPEN_KEY) !== "0");
  $("#mapToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    applyMapOpen($("#mapDock").classList.contains("collapsed"));
  });
  $("#mapDock").addEventListener("pointerdown", (e) => e.stopPropagation());
}

/** 房间配色输入框回显：无指定时显示该房深度的生物群系自动色（与游戏 defaultMoss 同源三档）。 */
function refreshRoomColor(room: { roomColor?: string; y?: number } | undefined): void {
  const mossInput = $("#mossColor") as HTMLInputElement;
  const v = room?.roomColor ?? "";
  const depth = (room?.y ?? 0) / 6;
  const auto = depth < 0.34 ? "#3a5828" : depth < 0.67 ? "#265248" : "#3e2c5c";
  mossInput.value = /^#[0-9a-fA-F]{6}$/.test(v) ? v : auto;
}
$("#mossColor").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).value;
  const room = doc.rooms[curKey];
  if (!room) return;
  doc.mutate(() => {
    room.roomColor = v;
  });
});
$("#mossAuto").addEventListener("click", () => {
  const room = doc.rooms[curKey];
  if (!room) return;
  doc.mutate(() => {
    delete room.roomColor;
  });
});

$("#saveBtn").addEventListener("click", () => void saveToSource());
$("#copyBtn").addEventListener("click", () => void copyRooms());
$("#undo").addEventListener("click", () => doc.undo());
$("#redo").addEventListener("click", () => doc.redo());
$("#prevRoom").addEventListener("click", () => stepRoom(-1));
$("#nextRoom").addEventListener("click", () => stepRoom(1));
($("#roomSelect") as HTMLSelectElement).addEventListener("change", (e) => gotoRoom((e.target as HTMLSelectElement).value));
$("#addLight").addEventListener("click", () => {
  const room = doc.rooms[curKey];
  if (!room) return;
  doc.mutate(() => {
    (room.lights ??= []).push({ x: 160, y: 90, r: 100 });
  });
});
$("#delRoom").addEventListener("click", () => {
  if (!doc.rooms[curKey]) return;
  const others = doc.idOrder.filter((k) => k !== curKey).length;
  if (!window.confirm(`删除房间 ${curKey}？${others === 0 ? "（这是最后一个房间！）" : ""}`)) return;
  doc.deleteRoom(curKey);
  curKey = ensureKey(curKey);
  selection = null;
  refreshAll();
  log(`已删除房间。`, "warn");
});
$("#resetBtn").addEventListener("click", () => {
  if (doc.dirty && !window.confirm("丢弃所有未保存修改，还原为页面加载时的源码数据？")) return;
  doc.resetFromSource();
  curKey = doc.rooms[curKey] ? curKey : spawnRoomKey();
  selection = null;
  centerCameraOnRoom(curKey);
  autosaveNow();
  refreshAll();
  log("已还原为源码数据。");
});

// ---- 启动 ----

buildTools();
buildObjPalette();
setupChrome();

doc.onChange(() => {
  scheduleAutosave();
  refreshAll();
});

// 上次会话的未保存编辑兜底（旧版单地图格式的备份会被忽略）
const savedDoc = localStorage.getItem(AUTOSAVE_KEY);
if (savedDoc && savedDoc !== doc.snapshot()) {
  $("#restoreBar").hidden = false;
  $("#restoreYes").addEventListener("click", () => {
    if (doc.restoreSnapshot(savedDoc)) {
      curKey = doc.rooms[curKey] ? curKey : spawnRoomKey();
      centerCameraOnRoom(curKey);
      log("已恢复上次未保存的编辑。", "ok");
    } else {
      log("浏览器里的备份是旧版格式（单地图时代），已忽略。", "warn");
    }
    selection = null;
    $("#restoreBar").hidden = true;
    autosaveNow();
    refreshAll();
  });
  $("#restoreNo").addEventListener("click", () => {
    $("#restoreBar").hidden = true;
    autosaveNow();
  });
}

new ResizeObserver(() => renderer.fit()).observe($("#center"));
addEventListener("resize", () => renderer.fit());
renderer.fit();
centerCameraOnRoom(curKey);

function frame(t: number): void {
  renderer.render(doc, {
    key: curKey,
    tool,
    brushTile,
    placeType,
    palSel,
    selection,
    hover,
    hoverKey,
    rect: rectAnchor && hover && hoverKey === curKey ? { x0: rectAnchor.x, y0: rectAnchor.y, x1: hover.x, y1: hover.y } : null,
    marquee,
    multiSel,
    placeCtx: placeCtx(),
  }, t);
  $("#stPos").textContent = hover
    ? `格 (${hover.x}, ${hover.y}) · ${hoverKey}${hoverKey === curKey ? "" : `（工作房 ${curKey}）`}`
    : `房间 ${curKey}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

refreshAll();
mmCenterOn(curKey); // 打开编辑器：井图以当前工作房间为中心
void probeChannel();
// 自动化冒烟探针（只读）
(window as unknown as Record<string, unknown>).__pwEditor = {
  get doc() { return doc; },
  get state() {
    return {
      key: curKey,
      objects: doc.rooms[curKey]?.objects.length ?? 0,
      tool,
      map: doc.editMapId,
      gameMap: doc.gameMapId,
      maps: doc.maps.map((m) => m.id),
      mm: { x: Math.round(mmX), y: Math.round(mmY) },
      hover: mapHover,
      multi: multiSel.size,
      // 画布相机（探针用）：世界格 → 屏幕px = (格+0.5)*ts - cam + camRoomOffset
      cam: { ts: renderer.ts, camX: Math.round(renderer.camX), camY: Math.round(renderer.camY) },
    };
  },
};
log("编辑器就绪。顶栏选地图；改完点「保存」（Ctrl+S）写回 maps/ 目录（地图 JSON）。");
