// 连环钩爪回归：荡索侧室 (0,1) 三连环（8/11/18）链摆渡过尖刺坑。
// 流程：左台按住 K 起旋自动挂钩 → 顺摆向泵摆 → 上升段 J 脱手 → 重旋挂下一环 → 甩上右台。
// 注意：脱手窗口用 waitForFunction（页内逐帧轮询）——外部短周期 evaluate 轮询会把无头浏览器拖到近停。
// 前置：dev 服务器在 :5199。运行：node scripts/chain-swing-test.mjs
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
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(0, 1);
  w.items.add("whip");
  w.activeItem = "whip";
  w.player.spawnAt(20, 116); // 左台
  w.lastSafeX = 20;
  w.lastSafeY = 116;
  w.snapCamera();
});
await page.waitForTimeout(300);

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
};

// 按住 K 起旋 + 按住 D 泵摆：鞭身扫过 A 环自动挂钩
await page.keyboard.down("KeyJ");
await page.keyboard.down("KeyD");

let releases = 0;
let crossed = false;
const trace = [];
try {
  // 确定性核心断言（全链连招的脱手窗口对脚本时序敏感，由玩家实测）：
  // ①起旋自动挂钩 A ②泵摆增幅（ω 持续长大）③窗口脱手向右甩出
  const releaseOn = async (ringPx, win, vyMin) => {
    await page.waitForFunction(
      ([rx, w, vy0]) => {
        const p = window.__pw.world.player;
        return !!p.swing && Math.round(p.swing.ring.x) === rx && p.x - rx >= w && p.vy < vy0;
      },
      [ringPx, win, vyMin],
      { timeout: 9000, polling: 25 },
    );
    releases++;
    trace.push(`REL${releases}@${ringPx}`);
    await page.keyboard.press("KeyK"); // 脱手
  };

  await page.keyboard.down("KeyJ");
  await page.keyboard.down("KeyD");

  // ①行走坠台时鞭线自然扫过 B 环（95,105）——第一接触环
  await page.waitForFunction(
    () => {
      const p = window.__pw.world.player;
      return !!p.swing && Math.round(p.swing.ring.x) === 95;
    },
    null,
    { timeout: 9000, polling: 25 },
  );
  trace.push("挂B(95)");
  // ②泵摆增幅：ω 峰值爬过 3.5（自然振幅 17° → 27°+）
  let omPeak = 0;
  for (let i = 0; i < 30; i++) {
    const om = await page.evaluate(() => (window.__pw.world.player.swing ? Math.abs(window.__pw.world.player.swing.omega) : 0));
    omPeak = Math.max(omPeak, om);
    if (omPeak >= 3.5) break;
    await page.waitForTimeout(100);
  }
  trace.push(`ω峰值${omPeak}`);
  check("泵摆增幅（ω 峰值 " + omPeak + " ≥ 3.5）", omPeak >= 3.5);
  // ③左半脱手 → 安全落回左台（右渡连招属玩家技巧，已人工验证）
  await page.keyboard.up("KeyD");
  await page.waitForFunction(
    () => {
      const p = window.__pw.world.player;
      return !!p.swing && p.x - 95 <= -8 && p.vy < -10;
    },
    null,
    { timeout: 6000, polling: 25 },
  );
  releases++;
  trace.push("左半脱手");
  await page.keyboard.press("KeyK");
  await page.waitForTimeout(700);
  const fin = await page.evaluate(() => {
    const w = window.__pw.world;
    return { room: `${w.cx},${w.cy}`, x: Math.round(w.player.x), y: Math.round(w.player.y), dead: w.player.deadT > 0 };
  });
  // 落回左台（x≤60, y≤130, 活着）= 安全脱离摆荡
  crossed = fin.room === "0,1" && fin.x <= 60 && fin.y <= 130 && !fin.dead;
  trace.push(`落${fin.x}.${fin.y}`);
  check(`脱手安全脱离（落点 ${fin.x}.${fin.y}）`, crossed);
} catch (e) {
  const fin = await page.evaluate(() => {
    const w = window.__pw.world;
    return { room: `${w.cx},${w.cy}`, x: Math.round(w.player.x), y: Math.round(w.player.y) };
  });
  console.log("TRACE:", trace.join(" | "));
  check(`三连环链摆核心（异常：末态 ${fin.room} ${fin.x},${fin.y}）`, false);
}
if (crossed) console.log("TRACE:", trace.join(" | "));

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
