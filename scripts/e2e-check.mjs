// 前置：先 npm run dev（脚本假定 dev 服务器在 5173/5199 端口，见下方 URL）
// 需要无头浏览器：npx playwright install chromium --only-shell（或本机 Edge）
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

mkdirSync("D:/tmp/pw-shots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e)));

await page.goto("http://localhost:5199/?debug=1");
await page.waitForTimeout(800);
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲 + 过场
await page.waitForTimeout(1300);    // 等过场播完再截标题
await page.screenshot({ path: "/tmp/pw-shots/00-title.png" });

// 新游戏
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/pw-shots/01-mouth.png" });

// 走动 + 跳跃
await page.keyboard.down("KeyD");
await page.waitForTimeout(500);
await page.keyboard.press("KeyK");
await page.waitForTimeout(400);
await page.keyboard.up("KeyD");
await page.waitForTimeout(300);

// 逐房间传送截图（按 ROOMS 键序：2,0 → 1,6）
const names = ["01-mouth", "02-entry", "03-vines", "04-swing", "05-shaft", "06-bubbles", "07-spores", "08-switch", "09-wispseed", "10-budshaft", "11-secret", "12-wispnest", "13-approach", "14-bottom"];
for (let i = 1; i <= 13; i++) {
  await page.keyboard.press("BracketRight");
  await page.waitForTimeout(450);
  await page.screenshot({ path: `/tmp/pw-shots/${String(i + 1).padStart(2, "0")}-${names[i]}.png` });
}

// 拿全部道具+源种，传到井底，走向巨花触发结局
await page.keyboard.press("KeyG");
await page.keyboard.press("BracketRight"); // 从 1,6 绕回 2,0
await page.waitForTimeout(200);
for (let i = 0; i < 13; i++) {
  await page.keyboard.press("BracketRight");
  await page.waitForTimeout(60);
}
await page.waitForTimeout(800);
await page.keyboard.down("KeyD");
await page.waitForTimeout(1600);
await page.keyboard.up("KeyD");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/pw-shots/15-ending.png" });
await page.waitForTimeout(4500);
await page.screenshot({ path: "/tmp/pw-shots/16-epilogue.png" });

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
