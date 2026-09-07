// 上线前审查探针（T90 测试图版）：电梯全链路 / 开关→电梯脉冲 / 存档花激活+传送 / 血尽回出生点 / If-Match 护栏。
// ★ 全部跑在探针专用测试图 T90 上（scripts/testmap.mjs 生成+自动恢复），不碰用户的 M01/M02。
// ★ 确定性步进：进游戏后冻结游戏自身 rAF 驱动，只由 __step 按逻辑步推进世界（无时序竞态）。
import { chromium } from "playwright";
import { withTestMap } from "./testmap.mjs";
import fs from "node:fs";

const BASE = "http://localhost:5199";
let pass = 0, failCount = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
};

await withTestMap(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?debug=1`);
  await page.waitForFunction(() => !!window.__pw?.world, null, { timeout: 30000 });

  // 确定性步进器 + 标题流
  await page.evaluate(() => {
    const w = window.__pw;
    w.__origInputUpdate = w.input.update.bind(w.input);
    w.__origWorldUpdate = w.world.update.bind(w.world);
    w.input.update = () => {};
    w.world.update = () => {};
    window.__step = (n) => {
      for (let i = 0; i < n; i++) {
        w.__origInputUpdate();
        if (w.mode === "game") w.__origWorldUpdate();
        else w.title.update();
      }
      return w.mode;
    };
  });
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => ({ mode: window.__pw.mode, tm: window.__pw.title?.mode }));
    if (st.mode === "game") break;
    if (st.tm === "press") await page.keyboard.press("Enter");
    else if (st.tm === "menu") {
      await page.evaluate(() => { window.__pw.title.sel = window.__pw.title.menuItems().indexOf("NEW GAME"); });
      await page.keyboard.press("Enter");
    }
    await page.evaluate(() => window.__step(30));
  }
  await page.waitForFunction(() => window.__pw.mode === "game", null, { timeout: 8000 });

  console.log("[S1] 电梯载客单程（TSTELV：R91→R92 竖井跨房）");
  {
    await page.evaluate(() => {
      const w = window.__pw.world;
      w.debugGoto("R91");
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      w.player.x = el.rect.x + el.off.x + 5;
      w.player.y = el.rect.y + el.off.y + 16;
      w.player.vy = 0;
    });
    const ride = await page.evaluate(() => {
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      const p = w.player;
      let rode = false;
      for (let i = 0; i < 800; i++) {
        window.__step(1);
        if (w.hidePlayer) rode = true;
        if (!el.riding) { p.x = el.rect.x + el.off.x + 5; p.vy = Math.min(p.vy, 250); }
        if (el.state === "idle" && el.end === 1 && !w.hidePlayer) return { rode: true, settled: true, id: w.roomId, py: +p.y.toFixed(1) };
      }
      return { rode, settled: false, id: w.roomId, py: +p.y.toFixed(1) };
    });
    ok("S1a 载客跨房到站（R92）", ride.rode && ride.settled && ride.id === "R92", JSON.stringify(ride));
    const stay = await page.evaluate(() => {
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      const startEnd = el.end;
      const sx = el.off.x, sy = el.off.y;
      for (let i = 0; i < 60; i++) window.__step(1);
      return { stayed: el.state === "idle" && el.end === startEnd && Math.abs(el.off.x - sx) < 1 && Math.abs(el.off.y - sy) < 1 };
    });
    ok("S1b 到站后不自动回航（单程停住）", stay.stayed, JSON.stringify(stay));
  }

  console.log("[S2] 开关脉冲→电梯无客发车（返回出发端）");
  {
    const s2 = await page.evaluate(() => {
      const w = window.__pw.world;
      const el = w.room.entities.find((e) => e.endOff !== undefined);
      if (!el) return { found: false };
      w.player.spawnAt(200, 150);
      const startEnd = el.end;
      const x0 = el.off.x, y0 = el.off.y;
      // 模拟触发总线脉冲（鞭击命中开关的路径由人工验收；这里验证消费端边沿单程发车）
      w.pressTrigger("TSTELV", 1);
      let maxOff = 0, sawMoving = false;
      for (let i = 0; i < 500; i++) {
        window.__step(1);
        if (el.state === "moving" || el.state === "dwell") sawMoving = true;
        maxOff = Math.max(maxOff, Math.abs(el.off.x - x0), Math.abs(el.off.y - y0));
      }
      const arrived = el.state === "idle" && el.end !== startEnd && maxOff > 10;
      return { found: true, sawMoving, arrived, startEnd, end: el.end, maxOff };
    });
    ok("S2a 开关脉冲单程发车", s2.found && s2.sawMoving, JSON.stringify(s2));
    ok("S2b 单程到另一端停住（不回程）", s2.found && s2.arrived, JSON.stringify(s2));
  }

  console.log("[S3] 存档花激活 + S 传送（T90 savepoint @R92）");
  {
    await page.evaluate(() => { window.__pw.world.debugGoto("R92"); });
    const s3 = await page.evaluate(() => {
      const w = window.__pw.world;
      const sp = w.room.entities.find((e) => e.flagKey !== undefined && String(e.flagKey).startsWith("R92#"));
      if (!sp) return { found: false };
      w.player.spawnAt(sp.x + 4, sp.y - 2);
      window.__step(3);
      window.__pw.input.queue.push({ down: true, code: "KeyJ" });
      window.__step(5);
      window.__pw.input.queue.push({ down: false, code: "KeyJ" });
      window.__step(12);
      const attuned = sp.attuned && w.checkpoint !== null;
      // 补一个第二落点让传送入口可用（≥2 株），再开传送
      w.spPos.set("fake#0", { roomId: w.roomId, x: sp.x, y: sp.y });
      window.__pw.input.queue.push({ down: true, code: "KeyS" });
      window.__step(5);
      window.__pw.input.queue.push({ down: false, code: "KeyS" });
      window.__step(10);
      const travelOpen = w.travelMode && w.mapOpen;
      window.__pw.input.queue.push({ down: true, code: "KeyJ" });
      window.__step(5);
      window.__pw.input.queue.push({ down: false, code: "KeyJ" });
      for (let i = 0; i < 60 && (w.travelMode || w.mapOpen || w.fade); i++) window.__step(1);
      return { found: true, attuned, travelOpen, closed: !w.travelMode && !w.mapOpen };
    });
    ok("S3a 存档花激活（attune+checkpoint）", s3.found && s3.attuned, JSON.stringify(s3));
    ok("S3b S 打开传送地图", s3.found && s3.travelOpen, JSON.stringify(s3));
    ok("S3c J 确认传送（黑场直达后关闭）", s3.found && s3.closed, JSON.stringify(s3));
  }

  console.log("[S3.5] 无存档血尽 → 回出生点房间（R91）");
  {
    await page.evaluate(() => { window.__pw.world.debugGoto("R92"); });
    const r35 = await page.evaluate(() => {
      const w = window.__pw.world;
      const p = w.player;
      w.checkpoint = null; // 模拟“从没激活过任何存档花”
      const roomBefore = w.roomId;
      p.hp = 1;
      p.invuln = 0; // 出生自带 0.5s 无敌：不清会被吞
      p.hurt(w);
      for (let i = 0; i < 90 && p.deadT > 0; i++) window.__step(1);
      for (let i = 0; i < 30 && !p.grounded; i++) window.__step(1);
      return { roomBefore, roomAfter: w.roomId, hp: p.hp, px: +p.x.toFixed(1) };
    });
    ok("S3.5 无存档血尽回出生点房间 R91", r35.roomBefore === "R92" && r35.roomAfter === "R91" && r35.hp === 3, JSON.stringify(r35));
  }

  console.log("[S4] If-Match 护栏三态（/__save/map/T90，同内容回写不伤数据）");
  {
    const cur = await page.evaluate(async () => (await fetch("/__save/map/T90")).json());
    const noHead = await page.evaluate(async () => (await fetch("/__save/map/T90", { method: "POST", body: "x" })).status);
    ok("S4a 无 x-pw-base → 409", noHead === 409, `got ${noHead}`);
    const badHead = await page.evaluate(async () => (await fetch("/__save/map/T90", { method: "POST", headers: { "x-pw-base": "deadbeef0000" }, body: "x" })).status);
    ok("S4b 错哈希 → 409", badHead === 409, `got ${badHead}`);
    const disk = fs.readFileSync("src/data/maps/T90.json", "utf8");
    const same = await page.evaluate(async (body) => {
      const hash = (await (await fetch("/__save/map/T90")).json()).hash;
      const r = await fetch("/__save/map/T90", { method: "POST", headers: { "content-type": "text/plain", "x-pw-base": hash }, body });
      return r.status;
    }, disk);
    ok("S4c 对哈希+同内容 → 200", same === 200, `got ${same}`);
    const after = await page.evaluate(async () => (await fetch("/__save/map/T90")).json());
    ok("S4d 同内容回写后哈希不变", after.hash === cur.hash, `${cur.hash} → ${after.hash}`);
  }

  try {
    ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));
  } finally {
    await browser.close();
  }
});

console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
process.exit(failCount === 0 ? 0 : 1);
