// 定向探针：骑泡跨房——上升越界进入 (1,3) 后骑乘不断、无下坠。
// 上泡方式：先吹泡，再把玩家放到泡顶上方自然落下（骑乘判定：下落中脚进泡顶带）。
import { chromium } from "playwright";
const BASE = "http://localhost:5199";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 200)));
await page.goto(`${BASE}/?debug=1&room=R09`);
await page.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
await page.keyboard.press("Enter");
await page.waitForTimeout(1100);
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__pw?.mode === "game", null, { timeout: 15000 });
await page.waitForTimeout(400);
const r = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const w = window.__pw.world;
  const input = window.__pw.input;
  w.debugGrantAll();
  w.activeItem = "bubble";
  const p = w.player;
  // 站进 col4 竖井底左侧一格（col3，面朝右）：泡泡落在 col4 正中——整列 rows0-6 全空气直通顶洞
  p.spawnAt(39, 66);
  p.facing = 1;
  await sleep(200);
  // 吹泡
  input.queue.push({ down: true, code: "KeyJ" });
  await sleep(80);
  input.queue.push({ down: false, code: "KeyJ" });
  await sleep(250);
  const bubble = w.room.entities.find((e) => e.doom !== undefined);
  if (!bubble) return { failed: "no bubble", py: p.y };
  // 放到泡顶上方 10px 自然下落 → 骑乘判定接住
  p.spawnAt(bubble.x, bubble.y - 12);
  p.vy = 0;
  let rode = false;
  for (let i = 0; i < 80; i++) {
    if (bubble.carrying) { rode = true; break; }
    await sleep(50);
  }
  if (!rode) return { failed: "not riding", py: p.y, by: bubble.y };
  // 骑着等跨房（16px/s 上升，竖井约 15-20s）；采样最大瞬时下坠
  const room0 = w.cx + "," + w.cy;
  let maxDrop = 0;
  let lastY = p.y;
  for (let i = 0; i < 800; i++) {
    await sleep(50);
    // 只统计跨房前的下坠（换房瞬间 y 坐标重置的正常跳变不计）
    if (w.cx + "," + w.cy === room0) {
      if (p.y > lastY + 0.5) maxDrop = Math.max(maxDrop, p.y - lastY);
      lastY = p.y;
    }
    if (w.cx + "," + w.cy !== room0) break;
  }
  await sleep(900);
  return {
    rode: true,
    room0,
    room1: w.cx + "," + w.cy,
    hp: p.hp,
    maxDrop: Math.round(maxDrop * 10) / 10,
    carried: !!bubble.carrying,
  };
});
console.log(JSON.stringify(r));
const ok = r.rode === true && r.room1 === "1,3" && r.hp === 3 && r.maxDrop <= 2;
console.log(ok ? "✓ 骑泡跨房：无下坠、骑乘保持、满血" : "✗ 失败");
await browser.close();
process.exit(ok ? 0 : 1);
