// 藤蔓丛回归：
// 1) 跳着穿过藤蔓丛会惊动摇摆
// 2) 护罩蹭到藤蔓就地破裂（不在毒雾里=不受伤）
// 3) (1,5) 毒雾护罩飞行线不受藤蔓干扰（关卡铁律：护罩必经路线不放藤蔓）
// 前置：dev 服务器在 :5199。运行：node scripts/vine-test.mjs
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

// 场景1：藤蔓 (20,10,h=3) 判定区 x202-218 / y100-130，原地满跳头顶扫进摆动范围
// （注意：跳跃顶点受帧量化 ±2px 影响，判定贴边设计别按理论满跳算）
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(2, 4);
  w.player.spawnAt(210, 145);
});
await page.waitForTimeout(400);
const vineSway = () =>
  page.evaluate(() => {
    const v = window.__pw.world.room.entities.find(
      (e) => e.constructor.name === "HangingVine" && e.rect.x === 202,
    );
    return v ? Math.round(v.swayT * 100) / 100 : null;
  });
const before = await vineSway();
await page.keyboard.down("KeyK");
let maxSway = 0;
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(60);
  maxSway = Math.max(maxSway, (await vineSway()) ?? 0);
}
await page.keyboard.up("KeyK");
check(`跳过藤蔓丛惊动摇摆（${before} → 峰值 ${maxSway}）`, maxSway > 0.1);

// 场景2：罩身状态直接放进藤蔓判定区 → 立刻破裂，且不在毒雾里=不受伤
await page.evaluate(() => {
  const w = window.__pw.world;
  w.player.startShield();
  w.player.x = 210;
  w.player.y = 108; // 藤蔓判定区正中
});
await page.waitForTimeout(300);
const s2 = await page.evaluate(() => {
  const w = window.__pw.world;
  return { shield: w.player.shieldT > 0, dead: w.player.deadT > 0 };
});
check(`护罩蹭藤蔓破裂（shield=${s2.shield}，未受伤 ${!s2.dead}）`, !s2.shield && !s2.dead);

// 场景3：护罩沿 (1,5) 毒雾层飞行（y=135），藤蔓尖端都在 y≤70——中途护罩不应破
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(1, 5);
  w.player.spawnAt(60, 135);
  w.player.startShield();
  w.player.shieldDir = 1; // 向右飞，穿过毒雾带（cols 5-9）上方路径
});
let midShield = false;
let minX = 999;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(120);
  const s = await page.evaluate(() => {
    const w = window.__pw.world;
    return { x: Math.round(w.player.x), shield: w.player.shieldT > 0, dead: w.player.deadT > 0 };
  });
  minX = Math.min(minX, s.x); // 占位：记录飞行进度
  if (i === 10) midShield = s.shield && !s.dead;
}
check(`毒雾层护罩飞行未被藤蔓打断（t≈1.2s shield=${midShield}）`, midShield);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
