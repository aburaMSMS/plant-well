// 验证 BGM 曲目系统：首次按键响起标题曲 → 进井切游戏曲 → 暂停+T 退回标题切回标题曲。
// 前置：dev 服务器在 :5199。运行：node scripts/music-check.mjs
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e)));

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
};
const music = () =>
  page.evaluate(() => {
    const a = window.__pw.audio;
    return { track: a.trackName, playing: a.musicPlaying };
  });

await page.goto("http://localhost:5199/?debug=1");
await page.waitForTimeout(600);

// 任意键 → 标题曲开始加载并循环播放（WAV 约 2.9MB，留足加载余量）
await page.keyboard.press("KeyA");
await page.waitForTimeout(1500);
let m = await music();
check(`标题界面响起标题曲（track=${m.track} playing=${m.playing}）`, m.track === "title" && m.playing);

// Enter 进井 → 切游戏曲
await page.keyboard.press("Enter");
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.__pw.mode)) === "game") break;
}
await page.waitForTimeout(1200);
m = await music();
check(`进入游戏切到游戏曲（track=${m.track} playing=${m.playing}）`, m.track === "game" && m.playing);

// Esc 暂停 + T 退回标题 → 切回标题曲
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.keyboard.press("KeyT");
await page.waitForTimeout(1200);
m = await music();
check(`退回标题切回标题曲（track=${m.track} playing=${m.playing}）`, m.track === "title" && m.playing);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
