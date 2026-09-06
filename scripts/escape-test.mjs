// 验证 (1,4) 无笛子逃生路线：面朝左吹泡泡（落在顶洞 col4 正下方）→ 乘泡一路穿顶洞回 (1,3)
// （(5,2) 石台供从 (1,3) 跳下来的方向落脚；乘泡上行走 col4 洞柱，头顶无遮挡）
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://localhost:5199/?debug=1");
// 等模块加载完并真正进入游戏（固定延时会在首次冷加载时丢失 Enter）
await page.waitForFunction(() => window.__pw && window.__pw.mode === "title", null, { timeout: 15000 });
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲过门
await page.waitForTimeout(900);
await page.keyboard.press("Enter"); // 菜单确认
await page.waitForFunction(() => window.__pw.mode === "game", null, { timeout: 5000 });
await page.waitForTimeout(400);
await page.keyboard.press("KeyG");          // 给道具（模拟已拿鞭+泡）
await page.waitForTimeout(200);
await page.keyboard.press("KeyL");          // 切到泡泡
await page.waitForTimeout(200);
// 传到 (1,4) 入口高台，面朝左：泡泡落在 x=45（col4）——顶洞正下方那一列
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(1, 4);
  w.player.spawnAt(51, 66);   // 高台（顶 y=70）
  w.player.facing = -1;
  w.lastSafeX = 51; w.lastSafeY = 66;
});
await page.waitForTimeout(400);
const s = () => page.evaluate(() => {
  const w = window.__pw.world;
  return { room: `${w.cx},${w.cy}`, x: Math.round(w.player.x), y: Math.round(w.player.y), g: w.player.grounded, items: [...w.items].length };
});
console.log("start:", JSON.stringify(await s()));
// K 吹泡泡 → 按住 J 跳上泡泡 → 乘泡上升，穿过顶洞（y<-6）触发房间转换
await page.keyboard.press("KeyJ");
await page.waitForTimeout(80);
await page.keyboard.down("KeyK");   // 按住 = 大跳，才能跳上泡泡顶
let fin = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(150);
  fin = await s();
  if (i % 4 === 0) console.log(`ride ${i}:`, JSON.stringify(fin));
  if (fin.room === "1,3") break;
}
await page.keyboard.up("KeyK");
console.log("RESULT:", fin.room === "1,3" ? "ESCAPE OK" : "FAILED", JSON.stringify(fin));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
