// 冰面滑行不对称诊断（一次性探针）：用户报告"从岩壁走进冰块后松手，比在冰块上直接走再松手滑得远"。
// 同一段 T90 冰面（cols18-24 row16，两侧岩地），确定性步进，逐帧记录 vx / 脚下材质：
//   A 岩地助跑 → 跨上冰 → 再走 5 格松手 → 追踪滑行到停
//   B 冰上原地起步 → 走同样时长 → 松手 → 追踪到停
//   B2 冰上走到达速后再松手（对照上限）
// 看三样：松手瞬间 vx、衰减速率（55/s=冰 / 1100/s=岩）、脚下材质有没有翻转。
import { chromium } from "playwright";
import { withTestMap } from "./testmap.mjs";

const BASE = "http://localhost:5199";

await withTestMap(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?debug=1`);
  await page.waitForFunction(() => !!window.__pw?.world, null, { timeout: 30000 });

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

  // 场景驱动器：label + 起点 + 按住策略（松手条件），返回松手后逐帧轨迹直到 vx=0
  const scenario = (name, setupSrc) => page.evaluate((name2) => {
    const w = window.__pw.world;
    const input = window.__pw.input;
    const p = w.player;
    w.debugGoto("R91");
    window.__step(70); // 落稳 + 吸收入场黑场
    input.queue.length = 0;
    const cfg = {
      A: { x: 155, releaseAt: 190 },  // 岩地起跑，跨进冰块走 1 格多后松手
      B: { x: 205, releaseAt: 225 },  // 冰上直接起跑，走约 3 格后松手
      C: { x: 205, releaseAt: 9999 }, // 冰上一直走到撞到东西/按满 160 帧（到顶对照）
    }[name2];
    p.x = cfg.x; p.y = 155; p.vx = 0; p.vy = 0;
    window.__step(5);
    input.queue.push({ down: true, code: "KeyD" });
    const rows = [];
    let released = -1;
    let relVx = 0;
    for (let i = 0; i < 300; i++) {
      window.__step(1);
      const mat = w.groundMaterial(p.x, p.y + 5);
      if (released < 0) {
        if (p.x >= cfg.releaseAt || i >= 120) {
          input.queue.push({ down: false, code: "KeyD" });
          released = i;
          relVx = +p.vx.toFixed(2);
        }
      } else {
        rows.push({ i, x: +p.x.toFixed(1), vx: +p.vx.toFixed(2), m: mat, g: !!p.grounded });
        if (p.vx === 0) break;
      }
    }
    return { name: name2, released, relVx, relX: rows[0]?.x, stopX: rows.at(-1)?.x, rows };
  }, name);

  for (const name of ["A", "B", "C"]) {
    const r = await scenario(name);
    const decay = r.rows.filter((_, idx) => idx % 4 === 0).slice(0, 10)
      .map((s) => `${s.i}:${s.vx}@x${s.x}/${s.m}${s.g ? "" : "!"}`).join(" ");
    console.log(`[${name}] 松手 vx=${r.relVx} @x=${r.relX} → 停在 x=${r.stopX}（滑行 ${(r.stopX - r.relX).toFixed(1)}px）`);
    console.log(`   衰减 ${decay}`);
  }
  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
});
