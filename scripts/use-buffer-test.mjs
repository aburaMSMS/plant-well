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
await page.keyboard.press("KeyG");
await page.waitForTimeout(300);
await page.keyboard.press("KeyL");
await page.waitForTimeout(200);
for (let i = 0; i < 3; i++) { await page.keyboard.press("BracketRight"); await page.waitForTimeout(400); }
// 走向尖刺，轮询到 dead=true 的瞬间按 K（严格落在死亡窗口内）
await page.keyboard.down("KeyA");
let pressed = false;
for (let i = 0; i < 40; i++) {
  const dead = await page.evaluate(() => window.__pw.world.player.deadT > 0);
  if (dead && !pressed) {
    await page.keyboard.press("KeyJ");
    pressed = true;
    console.log(`K pressed during death at sample ${i}`);
  }
  await page.waitForTimeout(30);
}
await page.keyboard.up("KeyA");
await page.waitForTimeout(800);
const st = await page.evaluate(() => {
  const w = window.__pw.world;
  return {
    buf: Math.round(w.useBuf * 1000),
    bubbles: w.room.entities.filter((e) => e.constructor.name === "Bubble").length,
    dead: w.player.deadT > 0,
  };
});
console.log("result:", JSON.stringify(st), "K was pressed during death:", pressed);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
