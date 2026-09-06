// 持续旋转回归：按住 K 藤鞭一直转、鞭长 3s 线性长满（屏宽一半）→ 鞭身任何一处扫过钩环立刻挂上拉过去 → 左右交互泵摆荡过尖刺坑
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

// 场景：(1,1) 主地面，站在坑左沿 col16（环在 (195,115)，距离约 36 > 基础索距 28）
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(1, 1);
  w.player.spawnAt(165, 136);
  w.items.add("whip");
  w.activeItem = "whip";
});
await page.waitForTimeout(500);

// 面向右侧（D 轻点一次定朝向）
await page.keyboard.press("KeyD");
await page.waitForTimeout(80);
await page.keyboard.up("KeyD");

// 按住 K：藤鞭持续旋转，鞭长线性增长——鞭身（整段，不只是鞭梢）扫过钩环 (205,115) 就挂上拉过去起摆
await page.keyboard.down("KeyJ");
let swung = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(100);
  swung = await page.evaluate(() => !!window.__pw.world.player.swing);
  if (swung) break;
}
await page.keyboard.up("KeyJ");
const sw = await page.evaluate(() => {
  const w = window.__pw.world;
  return { swing: !!w.player.swing, x: Math.round(w.player.x), y: Math.round(w.player.y) };
});
check(`按住旋转挂上钩环并拉拽起摆（swing=${sw.swing} @ ${sw.x},${sw.y}）`, swung);
// 荡秋千：左右交互泵摆（ω 变号就换边），向前上升段（x≥200、vy<-10、ω≥3.2）按 J 脱手飞过坑
let released = false;
let maxY = 999;
let lastT = -1;
let frozenAt = -1;
let heldKey = null;
const trace = [];
for (let i = 0; i < 110; i++) {
  await page.waitForTimeout(30);
  const smp = await page.evaluate(() => {
    const w = window.__pw.world;
    const p = w.player;
    return {
      x: Math.round(p.x),
      y: Math.round(p.y),
      sw: !!p.swing,
      om: Math.round((p.swing ? p.swing.omega : 0) * 10) / 10,
      vy: Math.round(p.vy),
      t: Math.round(w.time * 60),
      dead: p.deadT > 0,
    };
  });
  if (smp.t === lastT && frozenAt < 0) frozenAt = i; // 循环冻结检测
  lastT = smp.t;
  maxY = Math.min(maxY, smp.y);
  trace.push(`${smp.x},${smp.y},${smp.sw ? smp.om : "X"}${smp.dead ? "D" : ""}`);
  if (!released && smp.sw && !smp.dead) {
    if (smp.om >= 3.2 && smp.x >= 200 && smp.vy < -10) {
      await page.keyboard.press("KeyK");
      released = true;
      trace.push("<<R>>");
    } else {
      // 左右交互：顺着当前摆向按同侧方向，ω 变号就换边（人类玩家的泵摆节奏）
      const want = smp.om >= 0 ? "KeyD" : "KeyA";
      if (heldKey !== want) {
        if (heldKey) await page.keyboard.up(heldKey);
        await page.keyboard.down(want);
        heldKey = want;
      }
    }
  }
}
if (heldKey) await page.keyboard.up(heldKey);
console.log("循环冻结于采样:", frozenAt, "| 最高点:", maxY, "| 释放:", released);
console.log(trace.join(" | "));
await page.waitForTimeout(500);
const land = await page.evaluate(() => {
  const w = window.__pw.world;
  return { room: `${w.cx},${w.cy}`, x: Math.round(w.player.x), y: Math.round(w.player.y), dead: w.player.deadT > 0 };
});
// 甩过尖刺坑即算渡过：落 (1,1) 东侧，或经 (1,1) 右缘门荡进 (2,1) 落点室（存活、无死局）
check(`荡过尖刺坑（落点 ${land.room} @ ${land.x},${land.y}，${land.dead ? "阵亡" : "存活"}）`, !land.dead && ((land.room === "1,1" && land.x > 210) || land.room === "2,1"));

// 场景2：满屏扫击命中身边的机关（鞭身扫过即中，扇面覆盖全方向）
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(2, 3);
  w.player.spawnAt(190, 135); // 开关 (20,13) 在右手边 9px
  w.activeItem = "whip";
});
await page.waitForTimeout(400);
await page.keyboard.down("KeyJ");
await page.waitForTimeout(400);
await page.keyboard.up("KeyJ");
const sw2 = await page.evaluate(() => {
  const w = window.__pw.world;
  return { door: w.flags.has("door:13"), x: Math.round(w.player.x), dead: w.player.deadT > 0 };
});
check(`扫击命中机关开门（door:13=${sw2.door}）`, sw2.door && !sw2.dead);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
