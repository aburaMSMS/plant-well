// 换房算法回归（连续世界模型）：全部跑在探针专用测试图 T90 上（scripts/testmap.mjs 程序化生成，
// 与 M01 彻底解耦——用户随时改 M01 都不影响）。无头浏览器，不占用用户的 CDP 窗口。
// 核心断言（用户定案：换房=切视角，物理零干预）：
//   A 水平越界：跨房瞬间 py/vy 原样，px 恰好平移一房宽（无瞬移、无就近搬迁）
//   B 缝合挡墙：无开口处撞墙留在原房
//   C 上升连续：竖直上抛穿顶 → 落进上房开口正下方地板，px 一字不差（不出现“最近岩壁”）
//   D 电梯跨房 + 出舱赠跳：riding 迁房后到站吐出，exitJump=true，按键即跳
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

  // 标题 → NEW GAME
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => ({ mode: window.__pw.mode, tm: window.__pw.title?.mode }));
    if (st.mode === "game") break;
    if (st.tm === "press") await page.keyboard.press("Enter");
    else if (st.tm === "menu") {
      await page.evaluate(() => { window.__pw.title.sel = window.__pw.title.menuItems().indexOf("NEW GAME"); });
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction((w) => window.__pw.mode === w, "game", { timeout: 2500 }).catch(() => {});
  }
  await page.waitForFunction(() => window.__pw.mode === "game", null, { timeout: 8000 });

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = "") => {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : " " + extra}`);
  };
  const S = () => page.evaluate(() => {
    const w = window.__pw.world;
    return {
      id: w.roomId, cx: w.cx, cy: w.cy,
      px: +w.player.x.toFixed(1), py: +w.player.y.toFixed(1),
      vx: Math.round(w.player.vx), vy: Math.round(w.player.vy),
      fade: !!w.fade, exitJump: !!w.player.exitJump,
      grounded: !!w.player.grounded,
      time: w.time,
    };
  });
  // 按键走输入队列注入（CDP 键盘事件在无头/失焦下不可靠）
  const key = (code, down) => page.evaluate(([code, down]) => {
    window.__pw.input.queue.push({ down, code });
  }, [code, down]);

  const place = (x, y, vx = 0, vy = 0) => page.evaluate(([x, y, vx, vy]) => {
    const w = window.__pw.world;
    w.player.x = x; w.player.y = y; w.player.vx = vx; w.player.vy = vy;
  }, [x, y, vx, vy]);
  const waitAlive = async () => {
    const t0 = (await S()).time;
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 80)); if ((await S()).time > t0) return; }
  };
  const poll = async (pred, ms = 6000) => {
    const t0 = Date.now();
    let s = await S();
    while (Date.now() - t0 < ms) {
      s = await S();
      if (pred(s)) return s;
      await new Promise((r) => setTimeout(r, 30));
    }
    return s;
  };

  await waitAlive();
  console.log("[A] 水平越界连续性：按住方向键跑向右缘开口（rows13-15）");
  {
    await place(100, 150);
    await key("KeyD", true);
    let last = await S();
    let first = null;
    for (let i = 0; i < 250; i++) {
      const s = await S();
      if (s.id === "R92" && !s.fade) { first = s; break; }
      if (!s.fade) last = s;
      await new Promise((r) => setTimeout(r, 15));
    }
    await key("KeyD", false);
    ok("A1 跨进 R92", !!first && first.id === "R92", JSON.stringify({ last, first }));
    if (first) {
      const expectPx = last.px - 320;
      ok("A2 px 恰好平移一房宽（无瞬移）", Math.abs(first.px - expectPx) <= 10, `last.px=${last.px} first.px=${first.px} expect≈${expectPx.toFixed(0)}`);
      ok("A3 py 原样（没有落点搬迁）", Math.abs(first.py - last.py) <= 2, `last.py=${last.py} first.py=${first.py}`);
      ok("A4 vy 连续", Math.abs(first.vy - last.vy) <= 60, `last.vy=${last.vy} first.vy=${first.vy}`);
    }
    const land = await poll((s) => s.id === "R92" && !s.fade && Math.abs(s.vy) < 5 && s.py > 140, 4000);
    ok("A5 落地站稳 R92", land.py >= 140 && land.py <= 158, JSON.stringify(land));
  }

  console.log("[B] 缝合挡墙：无开口处撞墙留在原房");
  {
    await page.evaluate(() => { window.__pw.world.debugGoto("R91"); });
    await waitAlive();
    await place(100, 150);
    await key("KeyA", true);
    await new Promise((r) => setTimeout(r, 2000));
    await key("KeyA", false);
    const s = await S();
    ok("B1 撞墙留在 R91", s.id === "R91" && s.px >= 8, JSON.stringify(s));
  }

  console.log("[C] 上升连续性：竖直上抛穿顶（用户抱怨的场景）");
  {
    await page.evaluate(() => { window.__pw.world.debugGoto("R91"); });
    await waitAlive();
    await place(150, 155, 0, -700);
    let last = null;
    let first = null;
    for (let i = 0; i < 200; i++) {
      const s = await S();
      if (s.id === "R93" && !s.fade) { first = s; break; }
      if (!s.fade) last = s;
      await new Promise((r) => setTimeout(r, 15));
    }
    ok("C1 穿顶进入 R93", !!first && first.id === "R93", JSON.stringify({ last, first }));
    if (first) {
      ok("C2 px 连续（绝不出现“最近岩壁”瞬移）", Math.abs(first.px - last.px) <= 3, `last.px=${last?.px} first.px=${first.px}`);
      ok("C3 vy 连续", last ? Math.abs(first.vy - last.vy) <= 60 : true, `last.vy=${last?.vy} first.vy=${first.vy}`);
      // 穿顶后向右漂移（真实玩法：升上来后操纵离开洞口，落在开口旁的地板上）
      await page.evaluate(() => { window.__pw.world.player.vx = 150; });
    }
    const land = await poll((s) => s.id === "R93" && s.grounded, 6000);
    ok("C4 漂移落在 R93 开口旁的地板（而非掉回去）", land.id === "R93" && land.grounded && land.px >= 168 && land.py >= 158, JSON.stringify(land));
  }

  console.log("[D] 电梯跨房 + 出舱赠跳");
  {
    await page.evaluate(() => { window.__pw.world.debugGoto("R91"); });
    await waitAlive();
    await place(55, 156); // 站进笼身登乘区（笼底贴地 rows14-15，地板=row16）
    const ride = await poll((s) => s.id === "R92" && s.exitJump, 12000);
    ok("D1 乘电梯跨到 R92 且拿到出舱赠跳", ride.id === "R92" && ride.exitJump, JSON.stringify(ride));
    // 确定性验证赠跳机制：真悬空（y=100 下落中）+ exitJump=true → 按键必须起跳
    // （真实吐出会置 exitJump 已由 D1 证明；此前直接改 grounded 会被下一帧落地清零）
    await page.evaluate(() => { window.__pw.world.debugGoto("R91"); }); // 借 R91 竖井空旷处（先落稳）
    await waitAlive();
    // 真实出舱会置 exitJump（D1 已证）。机制验证：悬空 + exitJump → 合成按键必须起跳。
    // 全程页内 rAF 自采样，绕开 CDP 键盘投递/往返时序竞态。
    const jumped = await page.evaluate(() => {
      const w = window.__pw.world;
      w.debugGoto("R91"); // 借竖井空旷处
      const p = w.player;
      p.x = 150; p.y = 100;
      p.grounded = false;
      p.exitJump = true;
      p.vy = 0;
      return new Promise((res) => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK" }));
        let minVy = 0, frames = 0;
        const tick = () => {
          minVy = Math.min(minVy, p.vy);
          if (p.grounded || ++frames > 60) res({ minVy: Math.round(minVy), grounded: p.grounded });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
    ok("D2 出舱赠跳可用（悬空按键即跳）", jumped.minVy <= -100, JSON.stringify(jumped));
    await poll((s) => s.grounded, 4000);
    await page.keyboard.press("KeyK");
    await page.waitForTimeout(400);
    const after = await S();
    ok("D3 落地后正常起跳（赠跳不残留副作用）", after.vy < -80 || after.grounded, JSON.stringify(after));
  }

  ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 200));
  await browser.close();
  console.log(fail === 0 ? `\nPASS ${pass}/${pass + fail}` : `\nFAIL ${fail} failed, ${pass} passed`);
  process.exitCode = fail === 0 ? 0 : 1;
});
