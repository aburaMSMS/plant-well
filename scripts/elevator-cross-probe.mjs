// 跨房电梯定向探针：R12(2,0) UYDJ26 → R05(1,0)，back=true。
// 验证：①空笼去程/返程——玩家的房间、坐标、镜头纹丝不动（笼子跨界走 world.detached，玩家视野外照常模拟）
// ②载客去程——笼身越界瞬间切房、到站把人卸在电梯终点（不是房间入口）、电梯在新房间存活
// ③玩家走回出发房时笼子已随 loadRoom 归位（重建的数据原件让位给回巢笼）。
// 健壮性：每步采样校验 game 态——并发编辑触发 vite 整页重载时自动重开机重跑（最多 3 次）。
import { chromium } from "playwright";

const BASE = "http://localhost:5199";
let pass = 0, failCount = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function boot() {
  await page.goto(`${BASE}/?debug=1&room=2,0`);
  await page.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1100);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__pw?.mode === "game", null, { timeout: 15000 });
  await page.waitForTimeout(400);
}
async function guard() {
  const fine = await page.evaluate(() => !!window.__pw && window.__pw.mode === "game");
  if (!fine) throw "RELOADED";
}
/** 世界快照：笼子（房间实体表里的优先，其次 detached）+ 玩家 + 房间。 */
async function snap() {
  await guard();
  return page.evaluate(() => {
    const w = window.__pw.world;
    const el = w.room.entities.find((e) => e.endShift !== undefined) ?? w.detached[0] ?? null;
    return {
      cx: w.cx, cy: w.cy,
      state: el?.state ?? "NONE", end: el?.end ?? -1,
      x: el ? Math.round((el.rect.x + el.off.x) * 10) / 10 : -1,
      inRoom: !!w.room.entities.find((e) => e.endShift !== undefined),
      det: w.detached.length,
      px: Math.round(w.player.x * 10) / 10, py: Math.round(w.player.y),
      hidden: w.hidePlayer,
    };
  });
}

async function scenario() {
  const el0 = await page.evaluate(() => {
    const w = window.__pw.world;
    const el = w.room.entities.find((e) => e.endShift !== undefined) ?? null;
    return el ? { sx: el.endShift.x, ox: el.endOff.x, back: el.back, rectX: el.rect.x } : null;
  });
  ok("R12 里存在跨房电梯（endShift.x=-320）", !!el0 && el0.sx === -320, JSON.stringify(el0));
  // 返程路径与数据里的 back 无关：运行时强制开启，保证探针始终覆盖返程场景
  await page.evaluate(() => {
    const w = window.__pw.world;
    w.room.entities.find((e) => e.endShift !== undefined).back = true;
  });
  const restX = el0.rectX + (el0.ox - el0.sx); // 远端停靠位（目标房局部）

  // 1. 空笼去程：开关脉冲发车 → 越界后挂 detached，玩家世界纹丝不动
  await page.evaluate(() => window.__pw.world.pressTrigger("UYDJ26", 2));
  let s1 = null;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    s1 = await snap();
    if (s1.end === 1 && s1.state === "idle") break;
  }
  ok("空笼到站停在第 1 端", s1 && s1.end === 1 && s1.state === "idle", JSON.stringify(s1));
  ok(`停位=目标房终点格 ${restX}`, Math.abs(s1.x - restX) <= 1, `x=${s1.x}`);
  ok("玩家仍留在出发房（cx=2，世界没被拖走）", s1.cx === 2, JSON.stringify(s1));
  ok("笼子挂 detached（不在玩家房间实体表）", s1.det === 1 && !s1.inRoom, JSON.stringify(s1));

  // 2. back=true：1s 后空笼返程，越界进入玩家所在房时归位实体表
  let s2 = null;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    s2 = await snap();
    if (s2.end === 0 && s2.state === "idle" && s2.inRoom) break;
  }
  ok("空笼返程回巢停回原位", s2 && s2.end === 0 && s2.state === "idle" && Math.abs(s2.x - el0.rectX) <= 1, JSON.stringify(s2));
  ok("返程全程玩家世界未动（cx=2、笼子归位实体表、detached 清空）", s2.cx === 2 && s2.inRoom && s2.det === 0, JSON.stringify(s2));

  // 3. 载客去程：自然登乘（落到笼口区内的地板上）→ 越界瞬间切房 → 终点卸客
  const board = await page.evaluate(async () => {
    const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
    const w = window.__pw.world;
    const el = w.room.entities.find((e) => e.endShift !== undefined);
    const p = w.player;
    p.x = el.rect.x + el.off.x + 5;
    p.y = el.rect.y + el.off.y + 4;
    p.vx = 0; p.vy = 0;
    for (let i = 0; i < 250; i++) {
      if (el.riding) break;
      p.x = el.rect.x + el.off.x + 5; // 只钉横向，纵向让物理落地
      await sleep2(16);
    }
    return { riding: el.riding };
  });
  ok("玩家在笼口被吞（riding）", board.riding, JSON.stringify(board));
  let s3 = null;
  let sawFlip = false;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    s3 = await snap();
    if (s3.cx === 1 && s3.state === "moving") sawFlip = true; // 越界瞬间切房
    if (s3.cx === 1 && !s3.riding && s3.state === "idle") break;
  }
  ok("载客越界瞬间切房（cx 在 moving 中翻转）", sawFlip, JSON.stringify(s3));
  ok("载客到站：终点房卸客、电梯存活", s3 && s3.cx === 1 && !s3.riding && s3.state === "idle" && s3.inRoom, JSON.stringify(s3));
  ok(`卸在电梯终点（笼底中心 ${restX + 5}），不是房间入口`, Math.abs(s3.px - (restX + 5)) <= 3, `px=${s3.px}`);
  ok("乘客已可见", !s3.hidden, JSON.stringify(s3));
  const pxStood = s3.px;

  // 4. 用户报告的场景：玩家站在远端，back 空笼返程——玩家必须原地不动
  let s4 = null;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    s4 = await snap();
    if (s4.end === 0 && s4.state === "idle") break;
  }
  ok("空笼返程完成（回到出发房挂 detached）", s4 && s4.end === 0 && s4.state === "idle", JSON.stringify(s4));
  ok("玩家原地不动：房间还是 R05、坐标分毫未移", s4.cx === 1 && Math.abs(s4.px - pxStood) <= 2, `cx=${s4.cx} px=${s4.px}（原 ${pxStood}）`);

  // 5. 玩家走回出发房：笼子已随 loadRoom 归位（数据原件让位给它）
  await page.evaluate(() => window.__pw.world.debugGoto("2,0"));
  await page.waitForTimeout(400);
  const s5 = await snap();
  ok("玩家回出发房：笼子已归位且停回原格", s5.cx === 2 && s5.inRoom && s5.end === 0 && Math.abs(s5.x - el0.rectX) <= 1, JSON.stringify(s5));

  // 6. 到站状态持久：flag 置"停在远端"（乘坐送到后的自然产物）→ 出发房重建不再出现原件
  await page.evaluate(() => {
    const w = window.__pw.world;
    w.flags.add("lift:UYDJ26"); // 模拟"曾送到远端"的持久化位
  });
  await page.evaluate(() => window.__pw.world.debugGoto("2,0"));
  await page.waitForTimeout(400);
  const s6 = await snap();
  ok("persist：出发房原件让位（重建不再出现 origin 状态笼）", s6.cx === 2 && !s6.inRoom && s6.det === 1, JSON.stringify(s6));
  ok("persist：detached 笼停在远端（end=1）", s6.end === 1 && Math.abs(s6.x - restX) <= 1, JSON.stringify(s6));

  // 7. 玩家回终点房：真身物化，可再乘坐；乘回去后 flag 清除、笼停回原格
  await page.evaluate(() => window.__pw.world.debugGoto("1,0"));
  await page.waitForTimeout(400);
  const s7 = await snap();
  ok("persist：终点房物化真身（end=1 停远端）", s7.cx === 1 && s7.inRoom && s7.end === 1 && Math.abs(s7.x - restX) <= 1, JSON.stringify(s7));
  // 7. 机关再触发：空笼返程（同一 depart 路径）+ 持久化 flag 在发车时清除
  await page.evaluate(() => window.__pw.world.pressTrigger("UYDJ26", 2));
  let s8 = null;
  for (let i = 0; i < 240; i++) {
    await sleep(50);
    s8 = await snap();
    if (s8.end === 0 && s8.state === "idle") break;
  }
  ok("机关触发返程：空笼回出发房停回原格（挂 detached）", s8 && s8.end === 0 && s8.state === "idle" && s8.cx === 1 && Math.abs(s8.x - el0.rectX) <= 1, JSON.stringify(s8));
  const flagCleared = await page.evaluate(() => !window.__pw.world.flags.has("lift:UYDJ26"));
  ok("机关发车后持久化 flag 已清除", flagCleared);
}

let attempts = 0;
let done = false;
while (attempts < 3 && !done) {
  attempts++;
  if (attempts > 1) console.log(`\n（第 ${attempts} 次尝试：页面曾被并发编辑触发的 vite 重载打断，重新开机）`);
  try {
    await boot();
    await scenario();
    done = true;
  } catch (e) {
    if (String(e).includes("RELOADED")) continue;
    throw e;
  }
}
if (!done) {
  failCount++;
  console.log("  ✗ 连续 3 次被页面重载打断（其他会话在改 src 文件？稍后重试）");
}

ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));
console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
await browser.close();
process.exit(failCount === 0 ? 0 : 1);
