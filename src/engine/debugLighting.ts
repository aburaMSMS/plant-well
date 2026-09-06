import type { World } from "../game/world";

const STORAGE_KEY = "plantwell.debugLighting.v4";

// Debug-only：只应用调好的光照参数，不再渲染滑杆面板（已按用户要求移除）。
// 数值来源：localStorage 里此前调好的档位；没有就用 World 字段默认值（sceneDark 0.82）。
export function applyDebugLighting(world: World): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Partial<{ sceneDark: number; playerGlow: number }>;
    if (typeof data.sceneDark === "number") world.debugSceneDark = Math.max(0, Math.min(1, data.sceneDark));
    if (typeof data.playerGlow === "number") world.debugPlayerGlow = Math.max(0, Math.min(1, data.playerGlow));
  } catch {
    /* 解析失败就用世界默认值 */
  }
}
