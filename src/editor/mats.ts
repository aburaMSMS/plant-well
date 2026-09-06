// 编辑器的活数据：材质表 + 自定义物件表的内存副本。
// 游戏读 data/materialData.ts 与 data/propData.ts；编辑器改这里、保存时整文件写回。
import type { ObjMaterial } from "../data/materials";
import { mat as gameMat, shade as gameShade } from "../data/materials";
import type { PropDef, PropShape } from "../data/props";
import { MATERIALS, PROPS } from "./dataBridge";

/** 材质文档：内置物件类型名 → 材质（自定义物件的材质在 propDoc 里，不在这里）。 */
export const matDoc: Record<string, ObjMaterial> = {};
for (const [k, v] of Object.entries(MATERIALS)) matDoc[k] = { ...v };

/** 自定义物件文档：id → 定义（深拷贝，含材质）。 */
export const propDoc: Record<string, PropDef> = {};
for (const [k, v] of Object.entries(PROPS)) {
  propDoc[k] = { ...v, material: { ...v.material }, light: v.light ? { ...v.light } : undefined };
}

const FALLBACK: ObjMaterial = { base: "#9aa4b2", accent: "#cfd8e3", glow: "150,164,178", glowStrength: 0 };

/** 编辑器绘制用：物件类型的当前材质（自定义物件取其定义里的材质）。 */
export function matOf(type: string): ObjMaterial {
  if (matDoc[type]) return matDoc[type];
  if (type === "prop") return FALLBACK;
  return gameMat(type);
}

export function propByIdDoc(id: string): PropDef | undefined {
  return propDoc[id];
}

export function allPropIds(): string[] {
  return Object.keys(propDoc);
}

export function firstPropId(): string {
  return Object.keys(propDoc)[0] ?? "";
}

export function shade(hex: string, k: number): string {
  return gameShade(hex, k);
}

export const PROP_SHAPES: { id: PropShape; label: string }[] = [
  { id: "tree", label: "树" },
  { id: "crystal", label: "晶簇" },
  { id: "mushroom", label: "蘑菇" },
  { id: "rock", label: "岩石" },
  { id: "flower", label: "花" },
  { id: "torch", label: "火把" },
  { id: "block", label: "方块" },
];

let propSeq = 1;
export function nextPropId(): string {
  while (propDoc[`prop${propSeq}`]) propSeq++;
  return `prop${propSeq}`;
}

export function newPropDefaults(id: string): PropDef {
  return {
    id,
    label: "新物件",
    shape: "crystal",
    w: 1,
    h: 2,
    solid: false,
    light: { r: 40, strength: 0.6 },
    material: { base: "#b48ae0", accent: "#e6d6ff", glow: "180,140,255", glowStrength: 0.6 },
  };
}
