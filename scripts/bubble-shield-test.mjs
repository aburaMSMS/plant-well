// 新泡泡机制回归：
// 1) 吹出的泡泡静止漂浮，踩上去才上升
// 2) 藤鞭击打泡泡 → 罩身护罩；护罩中首次横向输入带着角色水平飞行穿越毒云
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
const st = () => page.evaluate(() => {
  const w = window.__pw.world;
  return {
    room: `${w.cx},${w.cy}`, x: Math.round(w.player.x), y: Math.round(w.player.y),
    dead: w.player.deadT > 0, shield: w.player.shieldT > 0,
    bubbles: w.room.entities.filter((e) => e.constructor.name === "Bubble").length,
  };
});

// 场景1：静止泡泡 + 踩上上升
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(0, 2); // 开阔房间
  w.player.spawnAt(160, 150);
});
await page.waitForTimeout(400);
await page.keyboard.press("KeyL"); // 切到泡泡
await page.waitForTimeout(200);
await page.keyboard.press("KeyJ"); // 吹泡（静止）
await page.waitForTimeout(300);
let s = await st();
check(`吹出的泡泡原地漂浮（bubbles=${s.bubbles}）`, s.bubbles === 1);
const b0 = await page.evaluate(() => {
  const w = window.__pw.world;
  const b = w.room.entities.find((e) => e.constructor.name === "Bubble");
  return Math.round(b.y);
});
await page.waitForTimeout(700);
const b1 = await page.evaluate(() => {
  const w = window.__pw.world;
  const b = w.room.entities.find((e) => e.constructor.name === "Bubble");
  return Math.round(b.y);
});
check(`泡泡不踩不上浮（${b0} → ${b1}）`, Math.abs(b1 - b0) <= 3);
// 走到泡泡下方跳上去踩
await page.evaluate(() => {
  const w = window.__pw.world;
  w.player.x = w.room.entities.find((e) => e.constructor.name === "Bubble").x;
  w.player.y = w.room.entities.find((e) => e.constructor.name === "Bubble").y + 14;
});
await page.keyboard.down("KeyK");
let minY = 999;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(150);
  minY = Math.min(minY, (await st()).y);
}
await page.keyboard.up("KeyK");
s = await st();
check(`踩住泡泡会上升（最低 y=${minY}）`, minY < 135);

// 场景2：藤鞭打泡泡 → 护罩 → 水平飞行穿越毒云
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(1, 3); // 毒雾廊：云在 cols 14-19
  w.player.spawnAt(125, 144); // 云左侧落地
});
await page.waitForTimeout(500);
// 循环切到泡泡（从任意道具开始，最多转 3 圈）
for (let i = 0; i < 3; i++) {
  const a = await page.evaluate(() => window.__pw.world.activeItem);
  if (a === "bubble") break;
  await page.keyboard.press("KeyL");
  await page.waitForTimeout(150);
}
const pre = await page.evaluate(() => window.__pw.world.activeItem);
await page.keyboard.press("KeyJ"); // 吹出静止泡泡（在身边）
await page.waitForTimeout(250);
// 循环切到鞭子
for (let i = 0; i < 3; i++) {
  const a = await page.evaluate(() => window.__pw.world.activeItem);
  if (a === "whip") break;
  await page.keyboard.press("KeyL");
  await page.waitForTimeout(150);
}
const preW = await page.evaluate(() => ({
  active: window.__pw.world.activeItem,
  bubble: window.__pw.world.room.entities.some((e) => e.constructor.name === "Bubble"),
}));
check(`场景2 前置：手持鞭 + 泡泡在场（${JSON.stringify(preW)}）`, preW.active === "whip" && preW.bubble);
await page.keyboard.press("KeyJ"); // 鞭击泡泡 → 护罩
await page.waitForTimeout(120);
s = await st();
check(`鞭击触发护罩（shield=${s.shield}）`, s.shield);
// 首次横向输入 → 泡泡带着水平飞行穿云
await page.keyboard.down("KeyD");
await page.waitForTimeout(1200);
await page.keyboard.up("KeyD");
await page.waitForTimeout(200);
s = await st();
check(`护罩飞行穿越毒云（x=${s.x}，未死 ${!s.dead}）`, s.x > 190 && !s.dead);
// J 跳出
await page.keyboard.press("KeyK");
await page.waitForTimeout(500);
s = await st();
check(`J 跳出护罩（shield=${s.shield}）`, !s.shield);

// 场景3：一井一泡——召唤第二个泡泡后，第一个 0.5s 宽限后破裂
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(0, 2);
  w.player.spawnAt(160, 150);
});
await page.waitForTimeout(300);
for (let i = 0; i < 3; i++) {
  const a = await page.evaluate(() => window.__pw.world.activeItem);
  if (a === "bubble") break;
  await page.keyboard.press("KeyL");
  await page.waitForTimeout(150);
}
await page.keyboard.press("KeyJ"); // 第一个泡泡
await page.waitForTimeout(400);
s = await st();
check(`第一个泡泡在场（bubbles=${s.bubbles}）`, s.bubbles === 1);
await page.keyboard.press("KeyJ"); // 第二个泡泡 → 第一个进入倒计时
await page.waitForTimeout(120);
s = await st();
check(`第二个泡泡出现，第一个还在宽限期（bubbles=${s.bubbles}）`, s.bubbles === 2);
await page.waitForTimeout(700); // BUBBLE_DOOM 0.5s + 余量
s = await st();
check(`宽限过后只剩新泡泡（bubbles=${s.bubbles}）`, s.bubbles === 1);

// 场景4：骑泡升到天花板——必须被卡停在房间内，不得被挤出房间外（挤出=站在天花板顶上的严重 bug）
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(0, 2); // 天花板整行实心
  w.player.spawnAt(160, 75); // row8 平台
  w.activeItem = "bubble";
});
await page.waitForTimeout(300);
await page.keyboard.press("KeyJ"); // 头顶上方吹泡
await page.waitForTimeout(200);
await page.evaluate(() => {
  const w = window.__pw.world;
  const b = w.room.entities.find((e) => e.constructor.name === "Bubble");
  b.x = 250; // 挪到无藤蔓的柱位：col16 头顶正吊着 (16,1) 藤蔓丛，新规则下会戳破泡泡
  b.y = 69;
  w.player.x = 250;
  w.player.y = 60; // 放到泡顶上方，落上去触发骑乘
});
let ridden = false;
let ceil = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(200);
  const s = await st();
  if (s.y < 30) ridden = true;
  if (ridden && s.y <= 16) {
    ceil = s; // 已贴顶收敛
    break;
  }
  ceil = s;
}
check(
  `骑泡到天花板被卡停在房间内（y=${ceil.y}，${ceil.room}，泡 ${ceil.bubbles}，存活 ${!ceil.dead}）`,
  ridden && ceil.y >= 6 && ceil.y <= 16 && ceil.room === "0,2" && ceil.bubbles >= 1 && !ceil.dead,
);

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
