// 自定义物件（「新物品工坊」创造的东西）的类型与工具。
// 数据在 propData.ts（引擎编辑器生成），本文件只放类型——手改不会被覆盖。
import { PROPS } from "./propData";
import type { ObjMaterial } from "./materials";

export type PropShape = "tree" | "crystal" | "mushroom" | "rock" | "flower" | "torch" | "block";

export interface PropDef {
  id: string;
  label: string;
  shape: PropShape;
  /** 占地（格） */
  w: number;
  h: number;
  /** 实心 = 参与碰撞、挡泡泡、挡鞭子视线 */
  solid: boolean;
  /** 自发光光源（可选） */
  light?: { r: number; strength: number };
  material: ObjMaterial;
}

export function propById(id: string): PropDef | undefined {
  return PROPS[id];
}

export { PROPS };

