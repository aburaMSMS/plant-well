// 瓦片地图与静态几何查询。
// 出界视为空气：房间靠"在边缘挖洞"连接，洞口处玩家必须能走出房间；
// 没有洞口的边缘由地图数据自身的边界砖封闭（scripts/validate-rooms.ts 保证）。
// Ice=可站立的冰面（滑）。@（黑幕）是附着层不是瓦片——Tilemap 不存它，
// 由 RoomInst.voidGrid 单独持有（可叠在岩壁/物品之上，渲染时整屏涂黑只抠玩家所在区域）。
export const enum Tile {
  Air = 0,
  Solid = 1,
  Spike = 2,
  Ice = 3,
}

export class Tilemap {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;

  constructor(cols: number, rows: number, asciiRows: readonly string[]) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      const line = asciiRows[y] ?? "";
      for (let x = 0; x < cols; x++) {
        const ch = line[x];
        this.cells[y * cols + x] =
          ch === "#" ? Tile.Solid
          : ch === "^" ? Tile.Spike
          : ch === "*" ? Tile.Ice
          : Tile.Air;
      }
    }
  }

  get(cx: number, cy: number): Tile {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return Tile.Air;
    return this.cells[cy * this.cols + cx] as Tile;
  }

  solidAtPx(x: number, y: number): boolean {
    const t = this.get(Math.floor(x / 10), Math.floor(y / 10));
    return t === Tile.Solid || t === Tile.Ice;
  }
}
