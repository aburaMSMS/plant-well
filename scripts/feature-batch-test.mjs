// 本批新特性回归：
// 1) 跨房跳转保持速度方向（水平转 y 不变、垂直转 x 不变、vx/vy 原样）
// 2) 骑泡泡垂直跨房：泡泡随身携带、继续上升、倒计时不重置
// 3) 未安抚游魂碰身 → 退回房间入口（不掉命）
// 4) 小树灭泡泡；树旁蔓豆茎照常生长（树不影响茎）
// 5) 蹦菇戳破泡泡
// 6) (1,3)/(2,3) 荆棘门：右侧可鞭破、左侧免疫
// 7) 地图：QE 缩放、WASD 平移、无房间绿框
// 前置：dev 服务器在 :5199。运行：node scripts/feature-batch-test.mjs
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://localhost:5199/?debug=1");
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲过门
await page.waitForTimeout(900);     // 过场吞键窗
await page.keyboard.press("Enter"); // 菜单确认
await page.waitForFunction(() => window.__pw && window.__pw.mode === "game", null, { timeout: 10000 }).catch(async () => {
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__pw.mode === "game", null, { timeout: 5000 });
});
await page.keyboard.press("KeyG"); // 四件套
await page.waitForTimeout(300);

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
};
const loadRoom = (cx, cy) =>
  page.evaluate(([x, y]) => {
    window.__pw.world.loadRoom(x, y);
    window.__pw.world.snapCamera();
  }, [cx, cy]);

// ---- 1) 跳转保持速度方向：从 (1,0) 空中平移跨入 (2,0)，y 与 vx/vy 都不许动 ----
await loadRoom(1, 0);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.player.spawnAt(300, 90); // 右缘洞口 rows8-10（y 80-110）：平抛起点须落在带内，否则撞洞口上沿的墙
  w.player.vx = 200; // 12 步内越过 x=324，此时 y≈97 还在空中
  w.player.invuln = 99;
  w.lastSafeX = 300;
  w.lastSafeY = 90;
});
await page.waitForFunction(() => `${window.__pw.world.cx},${window.__pw.world.cy}` === "2,0", null, { timeout: 4000 });
const t1 = await page.evaluate(() => {
  const w = window.__pw.world;
  const p = w.player;
  return { x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), dead: p.deadT > 0 };
});
check(
  `水平跳转 y 不变 vx 保持（x=${t1.x} y=${t1.y} vx=${t1.vx} vy=${t1.vy}）`,
  t1.x < 20 && Math.abs(t1.y - 97) <= 5 && Math.abs(t1.vx - 200) <= 10 && t1.vy > 60 && !t1.dead,
);

// ---- 2) 骑泡泡从 (1,3) 升入 (1,2)：泡泡跟人走、继续上升、寿命继续走 ----
await page.waitForTimeout(500); // 等场景 1 的相机过渡完全收尾
await loadRoom(1, 3);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.activeItem = "bubble";
  w.player.spawnAt(85, 146); // col8 上方全开阔（col10 有岩檐会夹爆泡泡）
  w.lastSafeX = 85;
  w.lastSafeY = 146;
});
await page.waitForTimeout(300);
await page.keyboard.press("KeyJ"); // 吹泡（站位远离毒雾）
await page.waitForTimeout(400);
await page.evaluate(() => {
  // 直接把泡泡放到顶洞下方、玩家放到泡顶，省去 10 秒上升等待
  const w = window.__pw.world;
  const b = w.room.entities.find((e) => e.constructor.name === "Bubble");
  b.x = 130;
  b.y = 20;
  b.life = 5;
  w.player.x = 130;
  w.player.y = 11; // 站上泡顶（top=15，feet=15）
  w.player.vy = 0;
});
// 泡泡顶人过界与房间切换在同一逻辑帧内完成，y<-6 的中间态帧间不可见——直接等房间翻转
await page.waitForFunction(() => `${window.__pw.world.cx},${window.__pw.world.cy}` === "1,2", null, { timeout: 5000 });
await page.waitForTimeout(600);
const t2 = await page.evaluate(() => {
  const w = window.__pw.world;
  const b = w.room.entities.find((e) => e.constructor.name === "Bubble");
  const y0 = b ? Math.round(b.y) : -1;
  return { bubbles: w.room.entities.filter((e) => e.constructor.name === "Bubble").length, y0, riding: b ? b.riding : false };
});
await page.waitForTimeout(400);
const t2b = await page.evaluate(() => {
  const b = window.__pw.world.room.entities.find((e) => e.constructor.name === "Bubble");
  return b ? Math.round(b.y) : -1;
});
check(
  `骑泡泡跨房不消失且继续上升（bubbles=${t2.bubbles} y ${t2.y0}→${t2b} riding=${t2.riding}）`,
  t2.bubbles === 1 && t2.riding && t2b < t2.y0,
);

// ---- 3) 游魂碰身 → 退回房间入口 ----
await loadRoom(3, 3);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.player.spawnAt(120, 130); // 距游魂 ~47px，会被主动追击
  w.entryX = 120; // 模拟"从这个入口进的房"
  w.entryY = 135;
  w.player.invuln = 0; // 立刻可被触碰
});
await page.waitForTimeout(3200); // 游魂贴身 → 被送回
const t3 = await page.evaluate(() => {
  const w = window.__pw.world;
  const p = w.player;
  return { x: Math.round(p.x), y: Math.round(p.y), dead: p.deadT > 0, room: `${w.cx},${w.cy}` };
});
check(
  `游魂碰身退回入口不掉命（${t3.room} ${t3.x},${t3.y} dead=${t3.dead}）`,
  t3.room === "3,3" && Math.abs(t3.x - 120) <= 4 && Math.abs(t3.y - 135) <= 10 && !t3.dead,
);

// ---- 4a) 小树灭泡泡 ----
await loadRoom(1, 1);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.activeItem = "bubble";
  w.player.spawnAt(110, 133);
  w.player.facing = 1;
  w.lastSafeX = 110;
  w.lastSafeY = 133;
});
await page.waitForTimeout(300);
await page.keyboard.press("KeyJ"); // 泡泡落在树旁
await page.waitForTimeout(400);
const t4 = await page.evaluate(
  () => window.__pw.world.room.entities.filter((e) => e.constructor.name === "Bubble").length,
);
check(`小树蹭破旁边的泡泡（bubbles=${t4}）`, t4 === 0);

// ---- 4b) 树旁蔓豆茎照常生长（树完全不影响茎） ----
await loadRoom(1, 1);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.activeItem = "bean";
  w.player.spawnAt(125, 135); // 树基正上方
  w.lastSafeX = 125;
  w.lastSafeY = 135;
});
await page.waitForTimeout(300);
await page.keyboard.down("KeyJ"); // 扎根并保持按住（生长窗口）
await page.waitForTimeout(500);
await page.keyboard.down("KeyW");
await page.waitForTimeout(1400);
const t4b = await page.evaluate(() => {
  const w = window.__pw.world;
  const st = w.room.entities.find((e) => e.constructor.name === "VineStalk");
  return { tiles: st ? st.chain.length : 0, y: Math.round(w.player.y) };
});
await page.keyboard.up("KeyW");
check(
  `树旁蔓豆茎照常生长（tiles=${t4b.tiles}，y=${t4b.y}）`,
  t4b.tiles >= 3 && t4b.y >= 133 && t4b.y <= 137,
);

// ---- 5) 蹦菇戳破泡泡 ----
await loadRoom(0, 2);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.activeItem = "bubble";
  w.player.spawnAt(258, 152);
  w.player.facing = 1;
  w.lastSafeX = 258;
  w.lastSafeY = 152;
});
await page.waitForTimeout(300);
await page.keyboard.press("KeyJ");
await page.waitForTimeout(400);
const t5 = await page.evaluate(
  () => window.__pw.world.room.entities.filter((e) => e.constructor.name === "Bubble").length,
);
check(`蹦菇帽戳破泡泡（bubbles=${t5}）`, t5 === 0);

// ---- 6a) 荆棘门：从 (2,3) 右侧隔界鞭断 ----
await loadRoom(2, 3);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.flags.delete("door:13");
  w.activeItem = "whip";
  w.player.spawnAt(8, 95);
  w.lastSafeX = 8;
  w.lastSafeY = 95;
});
await page.waitForTimeout(300);
await page.keyboard.down("KeyJ"); // 鞭子向左越过边界抽到 (1,3) 的门
await page.waitForTimeout(600);
await page.keyboard.up("KeyJ");
const t6a = await page.evaluate(() => window.__pw.world.flags.has("door:13"));
check(`右侧隔界鞭断荆棘门（door:13=${t6a}）`, t6a);

// ---- 6b) 从 (1,3) 左侧怎么抽都不断 ----
await loadRoom(1, 3);
await page.evaluate(() => {
  const w = window.__pw.world;
  w.flags.delete("door:13");
  w.activeItem = "whip";
  w.player.spawnAt(280, 95);
  w.lastSafeX = 280;
  w.lastSafeY = 95;
});
await page.waitForTimeout(300);
await page.keyboard.down("KeyJ");
await page.waitForTimeout(900); // 鞭长转满也够到门
await page.keyboard.up("KeyJ");
const t6b = await page.evaluate(() => window.__pw.world.flags.has("door:13"));
check(`左侧免疫（door:13=${t6b}）`, !t6b);

// ---- 7) 地图：QE 缩放、WASD 平移、无绿框 ----
await loadRoom(2, 3);
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const z0 = await page.evaluate(() => window.__pw.world.mapZoom);
await page.keyboard.press("KeyE"); // 放大
await page.waitForTimeout(150);
const z1 = await page.evaluate(() => window.__pw.world.mapZoom);
await page.keyboard.press("KeyQ"); // 缩小
await page.waitForTimeout(150);
const z2 = await page.evaluate(() => window.__pw.world.mapZoom);
await page.keyboard.down("KeyA"); // 平移（向世界西侧；当前房偏东，向右会被边界夹住）
await page.waitForTimeout(500);
await page.keyboard.up("KeyA");
const pan = await page.evaluate(() => window.__pw.world.mapPanX);
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
check(`地图 QE 缩放（${z0}→${z1}→${z2}）`, z0 === 2 && z1 === 3 && z2 === 2);
check(`地图 WASD 平移（panX=${Math.round(pan)}）`, pan < -0.3);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
