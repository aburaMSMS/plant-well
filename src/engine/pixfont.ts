// 3×5 像素字体，零素材。
// 每个字形 5 行、每行 3 位（bit2 = 左列），只用于标题/菜单/HUD 的少量文字。
// 游戏进行中保持无文字——这是 Animal Well 式"不解释"的底线。
const GLYPHS: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 7, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 2, 1],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7],
  V: [5, 5, 5, 5, 2],
  W: [5, 5, 5, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [6, 1, 2, 4, 7],
  "3": [7, 1, 3, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 6, 1, 6],
  "6": [3, 4, 7, 5, 7],
  "7": [7, 1, 2, 2, 2],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 6],
  " ": [0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 2],
  ":": [0, 2, 0, 2, 0],
  "-": [0, 0, 7, 0, 0],
  "/": [1, 1, 2, 4, 4],
  "!": [2, 2, 2, 0, 2],
  "^": [2, 5, 0, 0, 0], // 上箭头
  v: [0, 0, 0, 5, 2], // 下箭头
  "<": [1, 2, 4, 2, 1], // 左箭头
  ">": [4, 2, 1, 2, 4], // 右箭头
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;

export function textWidth(text: string, scale = 1, tracking = 1): number {
  if (text.length === 0) return 0;
  return (text.length * (GLYPH_W + tracking) - tracking) * scale;
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale = 1,
  color = "#fff",
  tracking = 1,
): void {
  ctx.fillStyle = color;
  let pen = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = g[row];
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits & (4 >> col)) {
          ctx.fillRect(pen + col * scale, y + row * scale, scale, scale);
        }
      }
    }
    pen += (GLYPH_W + tracking) * scale;
  }
}

export function drawTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  scale = 1,
  color = "#fff",
  tracking = 1,
): void {
  drawText(ctx, text, Math.round(cx - textWidth(text, scale, tracking) / 2), y, scale, color, tracking);
}
