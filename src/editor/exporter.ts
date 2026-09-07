// 地图数据的 JSON 序列化。存储格式（src/data/maps/<id>.json）与导入/导出文件格式完全相同：
// { kind: "plantwell-map", version: 1, id, name, spawn, rooms }。
// 旧的 TS 字面量生成/注释回填/源码拼接已随 rooms.ts 一起退役——JSON 无注释，文档在文件头与 HANDOFF。
import type { MapRec } from "./doc";

/** 一张地图的 JSON 文件内容（编辑器保存、导入导出共用同一序列化，保证脏比较稳定）。 */
export function serializeMap(m: MapRec): string {
  const rooms = m.idOrder
    .map((rid) => {
      const r = m.rooms[rid];
      if (!r) return null;
      const out: Record<string, unknown> = { id: r.id, x: r.x, y: r.y, map: r.map, objects: r.objects };
      if (r.lights?.length) out.lights = r.lights;
      if (r.roomColor) out.roomColor = r.roomColor;
      return out;
    })
    .filter((r) => r != null);
  return (
    JSON.stringify(
      { kind: "plantwell-map", version: 1, id: m.id, name: m.name, spawn: m.spawn, rooms },
      null,
      2,
    ) + "\n"
  );
}

export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
