// 画布与像素完美缩放。
//
// 内部分辨率固定 320×180，往窗口放大时只取整数倍：
// 每个游戏像素始终对应相同数量的屏幕像素，斜线不会忽粗忽细。
// 非整数缩放（比如 2.37 倍）会让某些像素行比别的亮，像素画大忌。
export const SCREEN_W = 320;
export const SCREEN_H = 180;

export function createDisplay(): CanvasRenderingContext2D {
  const canvas = document.querySelector<HTMLCanvasElement>("#screen")!;
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;

  const ctx = canvas.getContext("2d")!;
  // drawImage / 图形放大的插值关掉，保住硬边像素
  ctx.imageSmoothingEnabled = false;

  const resize = () => {
    const scale = Math.max(
      1,
      Math.floor(Math.min(innerWidth / SCREEN_W, innerHeight / SCREEN_H)),
    );
    canvas.style.width = `${SCREEN_W * scale}px`;
    canvas.style.height = `${SCREEN_H * scale}px`;
  };
  addEventListener("resize", resize);
  resize();

  return ctx;
}
