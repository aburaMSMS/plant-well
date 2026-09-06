// 编辑器访问游戏数据文件的唯一入口 + HMR 边界。
// 「保存」落盘后：本桥模块被 Vite 热替换（旧引用不变），
// 编辑器页因此保持内存态、不整页刷新；游戏页没有这个边界，会自动刷新看到新数据。
// 地图数据是 JSON（src/data/maps/<id>.json + gameMap.json），由 src/data/maps.ts 收编并派生索引。
import { MAP_LIST, GAME_MAP_ID, ROOMS, SPAWN, SEED_TOTAL } from "../data/maps";
import { MATERIALS } from "../data/materials";
import { PROPS } from "../data/props";

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    /* 保内存态：不刷新、不替换 */
  });
}

export { MAP_LIST, GAME_MAP_ID, ROOMS, SPAWN, SEED_TOTAL, MATERIALS, PROPS };

/** 写回 If-Match：装载时的磁盘哈希。保存时带上它，不在保存当下现取（现取会让旧页面把新文件盖掉）。
 *  game=gameMap.json；map[id]=单张地图 JSON（新图无文件时为空串=可创建）。 */
export const saveHash: { game: string; map: Record<string, string>; materials: string; props: string } = {
  game: "",
  map: {},
  materials: "",
  props: "",
};
