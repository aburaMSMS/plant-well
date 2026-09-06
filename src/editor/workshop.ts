// 引擎工坊：材质定制 + 新物品创造。
// 「材质」页改 15 类内置物件的主色/高光/自发光；「新物品」页创造数据驱动的自定义物件
// （形状 7 选 1、占地、碰撞、发光、材质），保存即写回 data/materialData.ts 与 data/propData.ts。
import { drawPropShape } from "../game/entities";
import { PROP_SHAPES, matDoc, propDoc, nextPropId, newPropDefaults } from "./mats";
import { objSpec } from "./palette";
import { saveHash } from "./dataBridge";
import type { ObjMaterial } from "../data/materials";
import type { PropDef } from "../data/props";

export interface WorkshopHooks {
  log(msg: string, level: "info" | "ok" | "warn" | "err"): void;
  /** 新物品保存成功后回调（重建物件调色板等） */
  onPropsChanged(): void;
  /** 「放置到地图」：切到放置工具并选中该 prop */
  requestPlace(propId: string): void;
}

const BUILTIN_TYPES = Object.keys(matDoc);

let hooks: WorkshopHooks = {
  log: () => {},
  onPropsChanged: () => {},
  requestPlace: () => {},
};

let root: HTMLElement;
let tab: "materials" | "props" = "materials";
// 材质页
let matSel = BUILTIN_TYPES[0];
// 新物品页
let propSel = "";
let unsaved = false;

export function openWorkshop(
  el: HTMLElement,
  h: WorkshopHooks,
  tabName?: "materials" | "props",
  focus?: { matType?: string; propId?: string },
): void {
  root = el;
  hooks = h;
  tab = tabName ?? tab;
  if (focus?.matType && matDoc[focus.matType]) matSel = focus.matType;
  if (focus?.propId && propDoc[focus.propId]) propSel = focus.propId;
  if (tab === "props" && (!propSel || !propDoc[propSel])) propSel = Object.keys(propDoc)[0] ?? "";
  root.hidden = false;
  render();
}

export function closeWorkshop(): void {
  if (unsaved && !window.confirm("工坊里有未保存的修改，确定关闭？")) return;
  unsaved = false;
  if (root) root.hidden = true;
}

// ---- 序列化写盘 ----

function q(s: string): string {
  return JSON.stringify(s);
}

function serializeMaterial(m: ObjMaterial): string {
  return `{ base: ${q(m.base)}, accent: ${q(m.accent)}, glow: ${q(m.glow)}, glowStrength: ${m.glowStrength} }`;
}

function materialsSource(): string {
  const L: string[] = [
    "// ⚠ 本文件由引擎编辑器生成（编辑器「材质工坊」全量重写）；手工修改会在下次保存时被覆盖。",
    "// 字段：base 主色 / accent 高光 / glow 光色(\"r,g,b\") / glowStrength 自发光强度(0~1)",
    'import type { ObjMaterial } from "./materials";',
    "",
    "export const MATERIALS: Record<string, ObjMaterial> = {",
  ];
  for (const [k, m] of Object.entries(matDoc)) L.push(`  ${k}: ${serializeMaterial(m)},`);
  L.push("};", "");
  return L.join("\n");
}

function serializeProp(id: string, p: PropDef): string {
  const light = p.light ? `light: { r: ${p.light.r}, strength: ${p.light.strength} }, ` : "";
  return `  ${id}: { id: ${q(p.id)}, label: ${q(p.label)}, shape: ${q(p.shape)}, w: ${p.w}, h: ${p.h}, solid: ${p.solid}, ${light}material: ${serializeMaterial(p.material)} },`;
}

function propsSource(): string {
  const L: string[] = [
    "// ⚠ 本文件由引擎编辑器生成（编辑器「新物品工坊 → 保存」全量重写）；手工修改会被覆盖。",
    "// 每个物件=形状+占地+碰撞+发光+材质；rooms.ts 里 { type: \"prop\", id, location: { room_id, x, y } } 引用。",
    'import type { PropDef } from "./props";',
    "",
    "export const PROPS: Record<string, PropDef> = {",
  ];
  for (const [k, p] of Object.entries(propDoc)) L.push(serializeProp(k, p));
  L.push("};", "");
  return L.join("\n");
}

async function saveFile(route: string, src: string, what: string): Promise<boolean> {
  try {
    const key = route as "materials" | "props";
    const res = await fetch(`/__save/${route}`, {
      method: "POST",
      headers: { "x-pw-base": saveHash[key] ?? "" },
      body: src,
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; stale?: boolean; hash?: string };
    if (res.status === 409 || data.stale) {
      hooks.log(`保存 ${what} 被拒（409）：文件在编辑器外被修改过——请刷新页面载入最新内容再保存。`, "err");
      return false;
    }
    if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (data.hash) saveHash[key] = data.hash;
    hooks.log(`已写回 ${what}，游戏页会自动刷新。`, "ok");
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    hooks.log(`保存 ${what} 失败（${reason}）：请重启 dev server 后重试。`, "err");
    return false;
  }
}

// ---- DOM 小工具 ----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function colorRow(label: string, value: string, on: (v: string) => void): HTMLElement {
  const row = el("label", "wsrow");
  row.append(el("span", "", label));
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => {
    on(input.value);
    unsaved = true;
    refreshPreview();
  });
  row.append(input);
  return row;
}

function rangeRow(label: string, value: number, min: number, max: number, on: (v: number) => void): HTMLElement {
  const row = el("label", "wsrow");
  row.append(el("span", "", label));
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = "0.01";
  input.value = String(value);
  const num = el("span", "wsnum", `${Math.round(value * 100)}%`);
  input.addEventListener("input", () => {
    num.textContent = `${Math.round(Number(input.value) * 100)}%`;
    on(Number(input.value));
    unsaved = true;
    refreshPreview();
  });
  row.append(input, num);
  return row;
}

function textRow(label: string, value: string, on: (v: string) => void): HTMLElement {
  const row = el("label", "wsrow");
  row.append(el("span", "", label));
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("change", () => {
    on(input.value);
    unsaved = true;
    refreshLists();
    refreshPreview();
  });
  row.append(input);
  return row;
}

function checkRow(label: string, value: boolean, on: (v: boolean) => void): HTMLElement {
  const row = el("label", "wsrow");
  row.append(el("span", "", label));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => {
    on(input.checked);
    unsaved = true;
    refreshPreview();
  });
  row.append(input);
  return row;
}

function chipEl(color: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "chip";
  s.style.background = color;
  return s;
}

// ---- 布局 ----

export function render(): void {
  if (!root || root.hidden) return;
  root.innerHTML = "";

  const panel = el("div", "wsPanel");
  const head = el("div", "wsHead");
  const title = el("b", "", "工坊");
  const closeBtn = el("button", "mini", "× 关闭");
  closeBtn.addEventListener("click", closeWorkshop);
  const tabs = el("div", "wsTabs");
  for (const [id, label] of [["materials", "材质工坊"], ["props", "新物品工坊"]] as const) {
    const b = el("button", tab === id ? "active" : "", label);
    b.addEventListener("click", () => {
      tab = id;
      if (tab === "props" && (!propSel || !propDoc[propSel])) propSel = Object.keys(propDoc)[0] ?? "";
      render();
    });
    tabs.append(b);
  }
  head.append(title, tabs, closeBtn);
  panel.append(head);
  const body = el("div", "wsBody");
  panel.append(body);
  root.append(panel);

  if (tab === "materials") renderMaterialsTab(body);
  else renderPropsTab(body);
}

function refreshLists(): void {
  render();
}

function refreshPreview(): void {
  // 只重画预览画布：找到 .wsPreview 画布并按当前选择重绘
  const cv = root.querySelector("canvas.wsPreview") as HTMLCanvasElement | null;
  if (cv) drawPreview(cv);
}

function drawPreview(cv: HTMLCanvasElement): void {
  const c = cv.getContext("2d")!;
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = "#14181f";
  c.fillRect(0, 0, cv.width, cv.height);
  if (tab === "materials") {
    // 材质页：光斑示意——base 大圆 + accent 高光 + glow 光晕
    const m = matDoc[matSel];
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    if (m.glowStrength > 0) {
      const g = c.createRadialGradient(cx, cy, 2, cx, cy, 34);
      g.addColorStop(0, `rgba(${m.glow},${(0.5 * m.glowStrength).toFixed(2)})`);
      g.addColorStop(1, `rgba(${m.glow},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, cv.width, cv.height);
    }
    c.fillStyle = m.base;
    c.beginPath();
    c.arc(cx, cy, 12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = m.accent;
    c.beginPath();
    c.arc(cx - 4, cy - 4, 4, 0, Math.PI * 2);
    c.fill();
  } else {
    // 新物品页：直接跑游戏侧的参数化形状
    const p = propDoc[propSel];
    if (!p) return;
    const scale = 4;
    const w = p.w * 10 * scale;
    const h = p.h * 10 * scale;
    const k = Math.min((cv.width - 12) / w, (cv.height - 12) / h, scale);
    drawPropShape(c, p, { x: (cv.width - w * k) / 2, y: (cv.height - h * k) / 2, w: w * k, h: h * k }, 1.2);
  }
}

// ---- 材质工坊 ----

function renderMaterialsTab(body: HTMLElement): void {
  const left = el("div", "wsList");
  for (const type of BUILTIN_TYPES) {
    const m = matDoc[type];
    const b = el("button", type === matSel ? "active" : "");
    b.append(chipEl(m.base));
    b.append(el("span", "", objSpec(type).label));
    b.addEventListener("click", () => {
      matSel = type;
      render();
    });
    left.append(b);
  }
  const right = el("div", "wsEdit");
  const m = matDoc[matSel];
  right.append(
    el("h3", "", `材质 · ${objSpec(matSel).label}`),
    colorRow("主色 base", m.base, (v) => (m.base = v)),
    colorRow("高光 accent", m.accent, (v) => (m.accent = v)),
    colorRow("光色 glow", `#${m.glow.split(",").map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`, (v) => {
      m.glow = v.slice(1).match(/../g)!.map((h) => parseInt(h, 16)).join(",");
    }),
    rangeRow("自发光强度", m.glowStrength, 0, 1, (v) => (m.glowStrength = v)),
  );
  const cv = document.createElement("canvas");
  cv.className = "wsPreview";
  cv.width = 120;
  cv.height = 90;
  right.append(cv);
  const save = el("button", "primary", "保存材质（写回 materialData.ts）");
  save.addEventListener("click", async () => {
    if (await saveFile("materials", materialsSource(), "materialData.ts")) {
      unsaved = false;
      closeWorkshopForce();
    }
  });
  right.append(save);
  const hint = el("p", "hint", "改完地图画布与游戏里即刻生效（保存后游戏页自动刷新）。自定义物件的材质在「新物品工坊」里逐个配。");
  right.append(hint);
  body.append(left, right);
  drawPreview(cv);
}

// ---- 新物品工坊 ----

function renderPropsTab(body: HTMLElement): void {
  const left = el("div", "wsList");
  for (const [id, p] of Object.entries(propDoc)) {
    const b = el("button", id === propSel ? "active" : "");
    b.append(chipEl(p.material.base));
    b.append(el("span", "", `${p.label} (${id})`));
    b.addEventListener("click", () => {
      propSel = id;
      render();
    });
    left.append(b);
  }
  const newBtn = el("button", "", "＋ 新建物件");
  newBtn.addEventListener("click", () => {
    const id = nextPropId();
    propDoc[id] = newPropDefaults(id);
    propSel = id;
    unsaved = true;
    render();
  });
  left.append(newBtn);

  const right = el("div", "wsEdit");
  const p = propDoc[propSel];
  // 保存按钮常驻：删光最后一个物件后也得能把空状态写回 propData.ts
  const btns = el("div", "wsBtns");
  const save = el("button", "primary", "保存物件（写回 propData.ts）");
  save.addEventListener("click", async () => {
    if (await saveFile("props", propsSource(), "propData.ts")) {
      unsaved = false;
      hooks.onPropsChanged();
      // 保存成功即收工：列表已刷新，留在弹窗里容易误改
      closeWorkshopForce();
    }
  });
  btns.append(save);
  if (!p) {
    right.append(el("p", "hint", "还没有自定义物件——点「＋ 新建物件」开始创造。"));
    right.append(btns);
    body.append(left, right);
    return;
  }

  right.append(el("h3", "", `新物品 · ${p.label} (${p.id})`));
  right.append(
    textRow("名称 label", p.label, (v) => {
      p.label = v || p.label;
    }),
  );
  // 形状
  const shapeRow = el("label", "wsrow");
  shapeRow.append(el("span", "", "形状 shape"));
  const shapeSel = document.createElement("select");
  for (const s of PROP_SHAPES) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    if (p.shape === s.id) opt.selected = true;
    shapeSel.append(opt);
  }
  shapeSel.addEventListener("change", () => {
    p.shape = shapeSel.value as PropDef["shape"];
    unsaved = true;
    refreshPreview();
  });
  shapeRow.append(shapeSel);
  right.append(shapeRow);
  // 占地
  const whRow = el("div", "wsrow wswh");
  const mkNum = (label: string, v: number, min: number, max: number, on: (n: number) => void) => {
    const lab = el("label", "");
    lab.append(el("span", "", label));
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(v);
    inp.addEventListener("change", () => {
      const n = Math.max(min, Math.min(max, Math.round(Number(inp.value) || min)));
      inp.value = String(n);
      on(n);
      unsaved = true;
      refreshPreview();
    });
    lab.append(inp);
    return lab;
  };
  whRow.append(mkNum("宽 w(格)", p.w, 1, 8, (n) => (p.w = n)), mkNum("高 h(格)", p.h, 1, 10, (n) => (p.h = n)));
  right.append(whRow);
  right.append(
    checkRow("实心 solid（参与碰撞/挡泡泡/挡鞭）", p.solid, (v) => (p.solid = v)),
  );
  // 发光
  const hasLight = !!p.light;
  right.append(
    checkRow("自发光 light", hasLight, (v) => {
      p.light = v ? { r: 40, strength: 0.6 } : undefined;
      render();
    }),
  );
  if (p.light) {
    right.append(
      rangeRow("光半径 r(px)", p.light.r, 8, 160, (v) => (p.light!.r = Math.round(v))),
      rangeRow("光强度 strength", p.light.strength, 0, 1, (v) => (p.light!.strength = v)),
    );
  }
  // 材质
  right.append(
    colorRow("主色 base", p.material.base, (v) => (p.material.base = v)),
    colorRow("高光 accent", p.material.accent, (v) => (p.material.accent = v)),
    colorRow("光色 glow", `#${p.material.glow.split(",").map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`, (v) => {
      p.material.glow = v.slice(1).match(/../g)!.map((h) => parseInt(h, 16)).join(",");
    }),
    rangeRow("材质自发光", p.material.glowStrength, 0, 1, (v) => (p.material.glowStrength = v)),
  );

  const cv = document.createElement("canvas");
  cv.className = "wsPreview";
  cv.width = 120;
  cv.height = 90;
  right.append(cv);

  const place = el("button", "", "放置到地图");
  place.addEventListener("click", () => {
    hooks.requestPlace(p.id);
    closeWorkshopForce();
  });
  const del = el("button", "danger", "删除");
  del.addEventListener("click", () => {
    const used = Object.keys(propDoc).length;
    if (!window.confirm(`删除物件「${p.label}」？${used <= 1 ? "（这是最后一个自定义物件）" : ""}`)) return;
    delete propDoc[propSel];
    propSel = Object.keys(propDoc)[0] ?? "";
    unsaved = true;
    hooks.onPropsChanged();
    render();
  });
  btns.append(place, del);
  right.append(btns);
  const hint = el("p", "hint", "id 是地图引用键（propData 里唯一）；改外观用材质三色+形状，行为只有「实心/发光」两个开关——纯装饰就都关。");
  right.append(hint);

  body.append(left, right);
  drawPreview(cv);
}

function closeWorkshopForce(): void {
  unsaved = false;
  root.hidden = true;
}
