// 内容扩展回归：蔓豆种植攀爬、蹦菇弹跳、地图开关与迷雾、21 房巡检、迁移源种可达。
// 前置：dev 服务器在 :5199。运行：node scripts/content-test.mjs
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
await page.keyboard.press("KeyG");
await page.waitForTimeout(300);

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
};

// 1) 蔓豆：长按 K 扎根 → 按住 W 指挥生长（玩家原地） → J 结束 → 抓茎攀爬 → J 跳出
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(2, 0);
  w.player.spawnAt(200, 135);
  w.activeItem = "bean";
  w.snapCamera();
});
await page.waitForTimeout(400);
await page.keyboard.down("KeyJ"); // 长按扎根；继续按住 = 生长窗口
await page.waitForTimeout(500);
const s1 = await page.evaluate(() => {
  const w = window.__pw.world;
  return { stalks: w.room.entities.filter((e) => e.constructor.name === "VineStalk").length };
});
check(`蔓豆长按扎根（stalks=${s1.stalks}）`, s1.stalks === 1);
await page.keyboard.down("KeyW"); // J+W：按住才生长，1 格 / 0.5s
await page.waitForTimeout(2000);
const g1 = await page.evaluate(() => {
  const w = window.__pw.world;
  const st = w.room.entities.find((e) => e.constructor.name === "VineStalk");
  return { tiles: st ? st.chain.length : 0, y: Math.round(w.player.y), growing: st ? st.growing : false };
});
check(
  `按方向茎生长、玩家原地（tiles=${g1.tiles}，y=${g1.y}）`,
  g1.tiles >= 4 && g1.y >= 133 && g1.y <= 137,
);
await page.keyboard.up("KeyJ"); // 松开 J：恢复移动；W 还按着 → 顺势抓茎开爬
await page.waitForTimeout(900);
const s2 = await page.evaluate(() => {
  const w = window.__pw.world;
  return { y: Math.round(w.player.y), climbing: !!w.player.climb };
});
check(`抓茎攀爬上升（y=${s2.y}，climbing=${s2.climbing}）`, s2.climbing && s2.y < 115);
await page.keyboard.up("KeyW");
await page.keyboard.press("KeyK");
await page.waitForTimeout(400);
const s3 = await page.evaluate(() => !!window.__pw.world.player.climb);
check(`J 跳出茎（climbing=${s3}）`, !s3);

// 2) 蹦菇：落上被弹起 ≈5.5 格
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(3, 2);
  w.player.spawnAt(155, 148); // 正对首菇 (15,15) 上方（旧点位 x=135 离菇 20px，接不住）
  w.snapCamera();
});
await page.waitForTimeout(200);
let minY = 999;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(120);
  minY = Math.min(minY, await page.evaluate(() => Math.round(window.__pw.world.player.y)));
  if (minY < 110) break;
}
check(`蹦菇弹起（最低 y=${minY}）`, minY < 110);

// 3) 地图：Tab 开 → 再按关；到访 flag 已入 flags
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const mo1 = await page.evaluate(() => window.__pw.world.mapOpen);
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const mo2 = await page.evaluate(() => window.__pw.world.mapOpen);
const seenCount = await page.evaluate(() => [...window.__pw.world.flags].filter((f) => f.startsWith("seen:")).length);
check(`地图开关（开=${mo1} 关=${mo2}，到访记录 ${seenCount} 房）`, mo1 && !mo2 && seenCount >= 1);

// 4) 全图巡检：debugTeleport 轮完 21 房，无崩溃
const visited = new Set();
for (let i = 0; i < 21; i++) {
  await page.evaluate(() => window.__pw.world.debugTeleport(1));
  await page.waitForTimeout(90);
  visited.add(await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`));
}
check(`全图巡检 ${visited.size}/20 房无异常`, visited.size === 20);

// 5) 迁移后的源种站在拾取半径内即可拿
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(3, 1);
  w.player.spawnAt(92, 96); // 悬圃石台，种子6 在旁边
});
await page.waitForTimeout(400);
check("源种6 在悬圃可拾取", await page.evaluate(() => window.__pw.world.seeds.has(6)));

await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(-1, 2);
  w.player.spawnAt(25, 146); // 西苔洞底层，种子5 在脚边
});
await page.waitForTimeout(400);
check("源种5 在西苔洞可拾取", await page.evaluate(() => window.__pw.world.seeds.has(5)));

await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(2, 6);
  w.player.spawnAt(272, 66); // 井底东窟高台，种子10 在左边缘
});
await page.waitForTimeout(400);
check("源种10 在井底东窟可拾取", await page.evaluate(() => window.__pw.world.seeds.has(10)));

// 6) 蔓豆是四件套：HUD/循环里都在
const items = await page.evaluate(() => {
  const w = window.__pw.world;
  return { order: w.items.size, has: w.items.has("bean") };
});
check(`debugGrantAll 发满四件套（${items.order} 件，bean=${items.has}）`, items.order === 4 && items.has);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
