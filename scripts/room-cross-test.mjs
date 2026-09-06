import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://localhost:5199/?debug=1");
await page.waitForTimeout(500);
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲过门
await page.waitForTimeout(900);
await page.keyboard.press("Enter"); // 菜单确认
await page.waitForTimeout(700);
await page.keyboard.press("BracketRight"); // (2,0) → (1,0)
await page.keyboard.press("BracketRight"); // (1,0) → (1,1)
await page.waitForTimeout(900);
const probe = () => page.evaluate(() => {
  const w = window.__pw.world;
  const p = w.player;
  return { room: `${w.cx},${w.cy}`, x: Math.round(p.x), y: Math.round(p.y), grounded: p.grounded, dead: p.deadT > 0, embedded: w.solidAtPx(p.x, p.y) };
});
console.log("spawn in (1,1):", JSON.stringify(await probe()));
// 拿鞭、砍藤，再跳上左块顶向左走到 (0,1)
await page.keyboard.press("KeyG");
await page.waitForTimeout(200);
await page.keyboard.down("KeyA");
await page.waitForTimeout(1000); // 走到藤墙根（x=103 被挡住）
await page.keyboard.up("KeyA");
await page.keyboard.press("KeyJ"); // 贴脸砍藤
await page.waitForTimeout(500);
await page.keyboard.down("KeyA");
for (let i = 0; i < 12; i++) {
  await page.keyboard.down("KeyK");
  await page.waitForTimeout(270);
  await page.keyboard.up("KeyK");
  await page.waitForTimeout(220);
  console.log(`t+${i + 1}`, JSON.stringify(await probe()));
}
await page.keyboard.up("KeyA");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
