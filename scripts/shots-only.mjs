import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5199/?debug=1");
await page.waitForTimeout(500);
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲过门
await page.waitForTimeout(900);
await page.keyboard.press("Enter"); // 菜单确认
await page.waitForTimeout(900);
for (let i = 0; i < 14; i++) {
  await page.screenshot({ path: `D:/tmp/pw-shots/r${String(i).padStart(2, "0")}.png` });
  await page.keyboard.press("BracketRight");
  await page.waitForTimeout(380);
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
