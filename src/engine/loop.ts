// 固定时间步游戏循环。
//
// 逻辑永远以 60Hz 演进，渲染跟随屏幕刷新率：
// - 确定性：同样的输入序列永远得到同样的世界状态，物理才稳、调试才可能
// - 144Hz 高刷屏不会让游戏变快，掉帧到 30 也不会让游戏变慢
//
// 机制：requestAnimationFrame 给的真实时间是不均匀的，
// 累加器把它攒起来，攒够一个 STEP 就演进一步，攒几步演几步。
// MAX_FRAME_TIME 把单帧计入的时间封顶——切后台半小时后回来，
// 不然要"追赶"几千步，表现为卡死螺旋。
export interface Scene {
  update(): void;
  render(ctx: CanvasRenderingContext2D): void;
}

const STEP = 1 / 60;
const MAX_FRAME_TIME = 0.25;

export function startLoop(ctx: CanvasRenderingContext2D, scene: Scene): void {
  let last = performance.now();
  let accumulated = 0;

  const frame = (now: number) => {
    accumulated += Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;

    while (accumulated >= STEP) {
      scene.update();
      accumulated -= STEP;
    }

    scene.render(ctx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
