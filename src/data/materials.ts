// 物件材质系统：每个可放置物件的 2~3 个主色槽 + 自发光参数。
// 数据在 materialData.ts（引擎编辑器生成），本文件只放类型与工具——手改不会被覆盖。
import { MATERIALS } from "./materialData";

export interface ObjMaterial {
  /** 主色：物件读得出来的那个大体色 */
  base: string;
  /** 高光/点缀色：眼睛、鞘翅、亮斑 */
  accent: string;
  /** 自发光/光源色，"r,g,b" */
  glow: string;
  /** 自发光强度 0~1（0=不额外发光） */
  glowStrength: number;
}

const DEFAULT_MAT: ObjMaterial = { base: "#9aa4b2", accent: "#cfd8e3", glow: "150,164,178", glowStrength: 0 };

export function mat(type: string): ObjMaterial {
  return MATERIALS[type] ?? DEFAULT_MAT;
}

/** 颜色明度缩放：k<1 变暗，k>1 提亮（hex 进出）。 */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** hex → "r,g,b"（拼 rgba 用）。 */
export function rgbOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export { MATERIALS };
