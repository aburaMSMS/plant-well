// 上线前审查探针：电梯全链路 / 开关→睡莲脉冲 / 存档花激活+传送 / If-Match 护栏。
// 只读为主；If-Match 场景 POST 的内容=磁盘字节（node 侧直读），不改数据。
// 注意：地图数据现在是 JSON（src/data/maps/*.json），If-Match 场景直接 fs 读磁盘字节 POST，不依赖 HTTP 取原文。
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:5199";
let pass = 0, failCount = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** 开机门：PRESS ANY KEY（任意键）→ 过场吞键 0.6s → 菜单 Enter。必须 keydown+keyup 成对。 */
async function boot(url) {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
  await page.keyboard.press("Enter"); // 过开机门
  await page.waitForTimeout(1100); // introT 0.6s 吞键窗 + 余量
  await page.keyboard.press("Enter"); // 菜单确认（有存档=CONTINUE，无=NEW GAME；debug room 深链都会直达）
  await page.waitForFunction(() => window.__pw?.mode === "game", null, { timeout: 15000 });
  await page.waitForTimeout(500); // 首帧/音频解码抖动余量
}

// ---- 场景 1：电梯载客单程（(1,4) 同房竖井电梯 K25B6Y：进房被吞→到站→停住不回航）----
{
  // 该梯 persist flag 若在（上次运行遗留），清掉重载恢复原位
  await page.goto(`${BASE}/?debug=1&room=1,4`);
  await page.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
  await page.evaluate(() => {
    const w = window.__pw.world;
    for (const f of [...w.flags]) if (f.startsWith("lift:K25B6Y")) w.flags.delete(f);
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1100);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__pw?.mode === "game", null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => {
    const w = window.__pw.world;
    const el = w.room.entities.find((e) => e.endOff !== undefined);
    return { found: !!el, key: w.cx + "," + w.cy, n: w.room.entities.length };
  });
  ok("电梯实体存在 @1,4", s1.found, JSON.stringify(s1));
  if (s1.found) {
    // 把玩家挪到笼口站好（data 出生点不在笼口下）——等 0.25s 登乘判定吞入
    await page.evaluate(() => {
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      w.player.x = el.rect.x + el.off.x + 5;
      w.player.y = el.rect.y + el.off.y + 14;
      w.player.vy = 0;
    });
    const r1 = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      const st = { rode: false, settled: false, state: "", end: -1 };
      for (let i = 0; i < 160; i++) {
        if (w.hidePlayer) st.rode = true;
        // 物理会盖位置：持续把玩家钉回笼口（grounded 由落地给）
        if (!el.riding) {
          w.player.x = el.rect.x + el.off.x + 5;
          w.player.vy = 0;
        }
        await sleep(50);
        if (el.state === "idle" && el.end === 1 && !w.hidePlayer) break;
      }
      st.state = el.state;
      st.end = el.end;
      st.settled = el.state === "idle" && el.end === 1 && !w.hidePlayer;
      return st;
    });
    ok("载客上行到站", r1.rode && r1.settled, JSON.stringify(r1));
    const r2 = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      const startEnd = el.end;
      const startOff = { ...el.off };
      await sleep(700);
      const stayed = el.state === "idle" && el.end === startEnd && Math.abs(el.off.x - startOff.x) < 1 && Math.abs(el.off.y - startOff.y) < 1;
      return { stayed, state: el.state };
    });
    ok("到站后不自动回航（单程停住）", r2.stayed, JSON.stringify(r2));
  }
}

// ---- 场景 2：开关→电梯单程无客（(2,0) reset=1 开关 → 电梯 UYDJ26）----
{
  await boot(`${BASE}/?debug=1&room=2,0`);
  const s2 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const w = window.__pw.world;
    const el = w.room.entities.find((e) => e.endOff !== undefined);
    if (!el) return { found: false };
    // debug 出生点在笼口下会被吞入：先等它在途行程走完、玩家吐到端上停稳
    for (let i = 0; i < 80 && (el.state !== "idle" || w.hidePlayer); i++) await sleep(100);
    // 把玩家挪到远离两端笼位的地方（免得又触发乘坐）
    w.player.spawnAt(100, 106);
    await sleep(300);
    const startEnd = el.end;
    const x0 = el.off.x;
    // 模拟触发总线脉冲（鞭击命中开关的路径由人工验证；这里验证消费端边沿单程发车）
    w.pressTrigger(el.id ?? "", 1);
    let maxOff = x0;
    let sawMoving = false;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      if (el.state === "moving" || el.state === "dwell") sawMoving = true;
      maxOff = Math.max(maxOff, Math.abs(el.off.x));
    }
    const arrived = el.state === "idle" && el.end !== startEnd && Math.abs(el.off.x - x0) > 10;
    return { found: true, sawMoving, arrived, startEnd, end: el.end, x0, offX: el.off.x };
  });
  ok("开关脉冲单程发车", s2.found && s2.sawMoving, JSON.stringify(s2));
  ok("单程到另一端停住（不回程）", s2.found && s2.arrived, JSON.stringify(s2));
}

// ---- 场景 3：存档花激活 + 传送光标（含按住连发语义）----
{
  await boot(`${BASE}/?debug=1&room=1,0`);
  const s3 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const w = window.__pw.world;
    const sp = w.room.entities.find((e) => e.flagKey !== undefined && String(e.flagKey).startsWith("1,0"));
    if (!sp) return { found: false };
    // 站到花旁，按使用键激活（走 useBuf 路径）
    w.player.spawnAt(sp.x + 4, sp.y - 2);
    await sleep(100);
    window.__pw.input.queue.push({ down: true, code: "KeyJ" });
    await sleep(80);
    window.__pw.input.queue.push({ down: false, code: "KeyJ" });
    await sleep(200);
    const attuned = sp.attuned && w.checkpoint !== null;
    // 传送入口要求 ≥2 株已激活：补一株假想的（同房不同键），让光标初始仍压在真花上
    w.spPos.set("fake#0", { room: [w.cx, w.cy], x: sp.x, y: sp.y });
    // 开传送（S）：把玩家放在花旁按 down
    window.__pw.input.queue.push({ down: true, code: "KeyS" });
    await sleep(80);
    window.__pw.input.queue.push({ down: false, code: "KeyS" });
    await sleep(150);
    const travelOpen = w.travelMode && w.mapOpen;
    // 光标初始应压在本花上
    const onFlower = !!w.travelMode; // 具体 cursorSavepoint 是私有，看公开行为：J 确认后 fade 出现
    window.__pw.input.queue.push({ down: true, code: "KeyJ" });
    await sleep(80);
    window.__pw.input.queue.push({ down: false, code: "KeyJ" });
    await sleep(300);
    const fading = w.travelMode === false && w.mapOpen === false;
    const diag = fading
      ? ""
      : JSON.stringify({
          cursor: w.travelCursor,
          list: w.travelList?.map((t) => t.key),
          room: w.cx + "," + w.cy,
        });
    return { found: true, attuned, travelOpen, onFlower, fading, diag };
  });
  ok("存档花激活（attune+checkpoint）", s3.found && s3.attuned, JSON.stringify(s3));
  ok("S 打开传送地图", s3.found && s3.travelOpen, JSON.stringify(s3));
  ok("J 确认传送（黑场直达）", s3.found && s3.fading, JSON.stringify(s3));
}

// ---- 场景 3.5：无存档血尽 → 回出生点房间（不是当前房间）----
{
  await boot(`${BASE}/?debug=1&room=1,6`);
  const r35 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const w = window.__pw.world;
    const p = w.player;
    // 模拟"从没激活过任何存档花"：清掉 checkpoint
    w.checkpoint = null;
    const roomBefore = w.cx + "," + w.cy;
    p.hp = 1;
    p.invuln = 0; // 出生自带 0.5s 无敌：不清掉 hurt 会被吞
    p.hurt(w); // 掉血→血尽→死亡演出→finishRespawn
    await sleep(1200); // 死亡 0.45s + 重生余量
    return {
      roomBefore,
      roomAfter: w.cx + "," + w.cy,
      hp: p.hp,
      spawnRoom: "2,0",
    };
  });
  ok(
    "无存档血尽回出生点房间（不是当前房间）",
    r35.roomBefore !== "2,0" && r35.roomAfter === r35.spawnRoom && r35.hp === 3,
    JSON.stringify(r35),
  );
}

// ---- 场景 4：If-Match 护栏三态（同内容回写不伤数据）----
{
  const cur = await page.evaluate(async () => {
    const r = await fetch("/__save/map/M01");
    return r.json();
  });
  // 无头 → 409
  const noHead = await page.evaluate(async () => {
    const body = "x";
    const r = await fetch("/__save/map/M01", { method: "POST", body });
    return r.status;
  });
  ok("无 x-pw-base → 409", noHead === 409, `got ${noHead}`);
  // 错哈希 → 409
  const badHead = await page.evaluate(async (hash) => {
    const r = await fetch("/__save/map/M01", { method: "POST", headers: { "x-pw-base": "deadbeef0000" }, body: "x" });
    return r.status;
  }, cur.hash);
  ok("错哈希 → 409", badHead === 409, `got ${badHead}`);
  // 对哈希 + 磁盘同字节 → 200 且内容不变（node 侧直读磁盘，绕开 vite ?raw 的模块包装）
  const disk = fs.readFileSync("src/data/maps/M01.json", "utf8");
  const same = await page.evaluate(async ({ hash, body }) => {
    const r = await fetch("/__save/map/M01", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-pw-base": hash },
      body,
    });
    return r.status;
  }, { hash: cur.hash, body: disk });
  ok("对哈希+同内容 → 200", same === 200, `got ${same}`);
  const after = await page.evaluate(async () => (await fetch("/__save/map/M01")).json());
  ok("同内容回写后哈希不变", after.hash === cur.hash, `${cur.hash} → ${after.hash}`);
}

ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));

console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
await browser.close();
process.exit(failCount === 0 ? 0 : 1);
