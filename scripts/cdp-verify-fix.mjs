// 换房算法回归（连续世界模型）：全部跑在探针专用测试图 T90 上（scripts/testmap.mjs 程序化生成，
// 与 M01 彻底解耦——用户随时改 M01 都不影响）。无头浏览器，不占用用户的 CDP 窗口。
// ★ 确定性步进：无头页面 rAF 会间歇停摆（世界冻结→采样全错），本套件不依赖真实时间——
//   直接在页内循环 input.update()+world.update() 手动驱动 60Hz 逻辑步，完全可复现。
// 场景（用户定案：换房=切视角，物理零干预）：
//   A 水平越界：跨房瞬间 py/vy 原样，px 恰好平移一房宽（无瞬移、无就近搬迁）
//   B 缝合挡墙：无开口处撞墙留在原房
//   C 上升连续：竖直上抛穿顶 → 落进上房开口旁地板，px 连续（不出现“最近岩壁”）
//   D 电梯跨房 + 出舱赠跳
//   E 冰面滑行（*）：松手惯性滑行一段后减速停住
//   F 黑幕（@）连通区域：跳入黑幕袋中心格命中该区域
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

  // 页内确定性步进器：一步 = 1/60s 逻辑步。
  // 关键：进游戏后把 input/world 的 update 换成空操作并保存原函数——
  // 游戏自己的 rAF 循环还在跑，会与 __step 双重驱动世界（place 的冲量被 rAF 帧抢先消耗）；
  // 冻结之后世界只由 __step 驱动，完全确定。
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
  // 标题 → NEW GAME（步进驱动）
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

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = "") => {
    cond ? pass++ : fail++;
    console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : " " + extra}`);
  };
  const step = (n) => page.evaluate((n) => window.__step(n), n);
  const S = () => page.evaluate(() => {
    const w = window.__pw.world;
    return {
      id: w.roomId, cx: w.cx, cy: w.cy,
      px: +w.player.x.toFixed(1), py: +w.player.y.toFixed(1),
      vx: Math.round(w.player.vx), vy: Math.round(w.player.vy),
      fade: !!w.fade, exitJump: !!w.player.exitJump,
      grounded: !!w.player.grounded, time: +w.time.toFixed(2),
    };
  });
  // 步进直到 pred 成立（页内逐步判定，无轮询间隙）；返回命中/最后样本
  const stepUntil = (predSrc, maxSteps = 900) => page.evaluate(`
    (function () {
      const w = window.__pw.world;
      const pred = ${predSrc};
      const p = w.player;
      let last = null;
      let minPy = 1e9, minVy = 1e9;
      for (let i = 0; i < ${maxSteps}; i++) {
        window.__step(1);
        const s = {
          id: w.roomId, cx: w.cx, cy: w.cy,
          px: +p.x.toFixed(1), py: +p.y.toFixed(1),
          vx: Math.round(p.vx), vy: Math.round(p.vy),
          fade: !!w.fade, exitJump: !!p.exitJump, grounded: !!p.grounded,
        };
        last = s;
        minPy = Math.min(minPy, s.py);
        minVy = Math.min(minVy, s.vy);
        if (pred(s)) return { hit: true, minPy, minVy, ...s };
      }
      return { hit: false, minPy, minVy, ...last };
    })()
  `);
  const place = (x, y, vx = 0, vy = 0) => page.evaluate(([x, y, vx, vy]) => {
    const w = window.__pw.world;
    w.player.x = x; w.player.y = y; w.player.vx = vx; w.player.vy = vy;
  }, [x, y, vx, vy]);
  const goto = (id) => page.evaluate((id) => { window.__pw.world.debugGoto(id); }, id);

  console.log("[A] 水平越界连续性：按住方向键跑向右缘开口（rows13-15）");
  {
    await goto("R91");
    await place(100, 150);
    const frames = await page.evaluate(() => {
      const w = window.__pw.world;
      const input = window.__pw.input;
      const p = w.player;
      const out = [];
      input.queue.push({ down: true, code: "KeyD" });
      for (let i = 0; i < 400; i++) {
        window.__step(1);
        out.push({ px: +p.x.toFixed(1), py: +p.y.toFixed(1), vx: Math.round(p.vx), vy: Math.round(p.vy), id: w.roomId, fade: !!w.fade, grounded: !!p.grounded });
      }
      input.queue.push({ down: false, code: "KeyD" });
      window.__step(1);
      return out;
    });
    let last = null, first = null;
    for (const f of frames) {
      if (f.id === "R92" && !f.fade) { first = f; break; }
      if (!f.fade) last = f;
    }
    ok("A1 跨进 R92", !!first, JSON.stringify({ last, first }));
    if (first) {
      const expectPx = last.px - 320;
      ok("A2 px 恰好平移一房宽（无瞬移）", Math.abs(first.px - expectPx) <= 6, `last.px=${last.px} first.px=${first.px} expect≈${expectPx.toFixed(0)}`);
      ok("A3 py 原样（没有落点搬迁）", Math.abs(first.py - last.py) <= 1.5, `last.py=${last.py} first.py=${first.py}`);
      ok("A4 vy 连续", Math.abs(first.vy - last.vy) <= 40, `last.vy=${last.vy} first.vy=${first.vy}`);
    }
    const land = frames.slice(frames.indexOf(first) + 1).find((f) => f.grounded && Math.abs(f.vy) < 5) ?? null;
    ok("A5 落地站稳 R92", land && land.py >= 140 && land.py <= 158, JSON.stringify(land));
  }

  console.log("[B] 缝合挡墙：无开口处撞墙留在原房");
  {
    await goto("R91");
    await place(100, 150);
    const frames = await page.evaluate(() => {
      const w = window.__pw.world;
      const input = window.__pw.input;
      const p = w.player;
      const out = [];
      input.queue.push({ down: true, code: "KeyA" });
      for (let i = 0; i < 150; i++) {
        window.__step(1);
        if (i % 10 === 9) out.push({ px: +p.x.toFixed(1), id: w.roomId });
      }
      input.queue.push({ down: false, code: "KeyA" });
      window.__step(1);
      return out;
    });
    const last = frames[frames.length - 1];
    ok("B1 撞墙留在 R91", last.id === "R91" && last.px >= 8, JSON.stringify(last));
  }

  console.log("[C] 上升连续性：竖直上抛穿顶（用户抱怨的场景）");
  {
    await goto("R91");
    await place(150, 155, 0, -700);
    let last = null, first = null;
    for (let i = 0; i < 90; i++) {
      const s = await S();
      if (s.id === "R93" && !s.fade) { first = s; break; }
      if (!s.fade) last = s;
      await step(1);
    }
    ok("C1 穿顶进入 R93", !!first && first.id === "R93", JSON.stringify({ last, first }));
    if (first) {
      ok("C2 px 连续（绝不出现“最近岩壁”瞬移）", Math.abs(first.px - last.px) <= 2, `last.px=${last?.px} first.px=${first.px}`);
      ok("C3 vy 连续", last ? Math.abs(first.vy - last.vy) <= 34 : true, `last.vy=${last?.vy} first.vy=${first.vy}`);
      await page.evaluate(() => { window.__pw.world.player.vx = 150; });
    }
    const land = await stepUntil("(s) => s.id === 'R93' && s.grounded", 300);
    ok("C4 漂移落在 R93 开口旁的地板（而非掉回去）", land.hit && land.px >= 168 && land.py >= 158, JSON.stringify(land));
  }

  console.log("[D] 电梯跨房 + 出舱赠跳");
  {
    await goto("R91");
    await place(55, 156); // 站进笼身登乘区（笼底贴地 rows14-15，地板=row16）
    const ride = await stepUntil("(s) => s.id === 'R92' && s.exitJump", 800);
    ok("D1 乘电梯跨到 R92 且拿到出舱赠跳", ride.hit && ride.exitJump, JSON.stringify(ride));
    // 出舱悬空瞬间按跳：赠跳必须生效（页内连续步进，无时序竞态）
    const jump = await page.evaluate(() => {
      const w = window.__pw.world;
      const input = window.__pw.input;
      const p = w.player;
      const wasAir = !p.grounded && p.exitJump;
      input.queue.push({ down: true, code: "KeyK" });
      let minVy = 0;
      for (let i = 0; i < 12; i++) {
        window.__step(1);
        minVy = Math.min(minVy, p.vy);
        if (i === 1) input.queue.push({ down: false, code: "KeyK" });
      }
      return { wasAir, minVy: Math.round(minVy) };
    });
    ok("D2 出舱赠跳可用（悬空按键即跳）", jump.wasAir && jump.minVy <= -100, JSON.stringify(jump));
    await stepUntil("(s) => s.grounded", 200);
    const jump2 = await page.evaluate(() => {
      const w = window.__pw.world;
      const input = window.__pw.input;
      const p = w.player;
      input.queue.push({ down: true, code: "KeyK" });
      let minVy = 0;
      for (let i = 0; i < 8; i++) {
        window.__step(1);
        minVy = Math.min(minVy, p.vy);
      }
      input.queue.push({ down: false, code: "KeyK" });
      window.__step(1);
      return { minVy: Math.round(minVy), grounded: p.grounded };
    });
    ok("D3 落地后普通跳正常（赠跳不残留副作用）", jump2.minVy <= -200, JSON.stringify(jump2));
  }

  console.log("[E] 冰面滑行：松手后惯性滑行一段（对比岩地立即停）");
  {
    await goto("R91");
    await place(190, 156); // 冰面段（cols18-24 row16）
    const glide = await page.evaluate(() => {
      const w = window.__pw.world;
      const input = window.__pw.input;
      const p = w.player;
      const out = [];
      input.queue.push({ down: true, code: "KeyD" });
      for (let i = 0; i < 26; i++) { window.__step(1); } // 助跑
      input.queue.push({ down: false, code: "KeyD" });
      window.__step(1);
      out.push({ tag: "release", vx: Math.round(p.vx), px: +p.x.toFixed(1), id: w.roomId });
      for (let i = 0; i < 30; i++) { window.__step(1); }
      out.push({ tag: "t+0.5s", vx: Math.round(p.vx), px: +p.x.toFixed(1), id: w.roomId });
      for (let i = 0; i < 90; i++) { window.__step(1); }
      out.push({ tag: "settle", vx: Math.round(p.vx), px: +p.x.toFixed(1), id: w.roomId, grounded: p.grounded });
      return out;
    });
    const [rel, mid, settle] = glide;
    ok("E1 冰面松手仍在滑（vx>20）", rel.vx > 20, JSON.stringify(rel));
    ok("E2 滑行显著减速", Math.abs(mid.vx) < Math.abs(rel.vx), JSON.stringify(mid));
    ok("E3 最终停住且留在 R91", settle.vx === 0 && settle.id === "R91" && settle.px < 310, JSON.stringify(settle));
  }

  console.log("[F] 黑幕连通区域：跳入黑幕袋时中心格命中该区域");
  {
    const diag = await page.evaluate(() => ({
      upd: String(window.__pw.world.update).slice(0, 26),
      hasOrig: typeof window.__pw.__origWorldUpdate,
    }));
    console.log("  [F diag]", JSON.stringify(diag));
    await goto("R91");
    await place(90, 155, 0, -420); // 跳进走廊顶上的黑幕袋（cols8-10 rows9-10）
    const hit = await page.evaluate(() => {
      const w = window.__pw.world;
      w.debugGoto("R91");
      const p = w.player;
      p.x = 90; p.y = 155; p.vx = 0; p.vy = -420;
      const rows = [];
      for (let i = 0; i < 45; i++) {
        window.__step(1);
        const cx = Math.floor(p.x / 10), cy = Math.floor(p.y / 10);
        rows.push({ i, py: +p.y.toFixed(1), vy: Math.round(p.vy), region: w.room.voidGrid[cy] ? w.room.voidGrid[cy][cx] : -9, g: p.grounded });
      }
      return rows;
    });
    console.log("  [F trace] " + JSON.stringify(hit.slice(0, 14)));
    const hitRes = { hit: hit.some((r) => r.region >= 0), minPy: Math.min(...hit.map((r) => r.py)) };
    const regions = await page.evaluate(() => window.__pw.world.room.voidCells.length);
    ok("F1 黑幕袋成区（连通 flood fill）", regions >= 1, `regions=${regions}`);
    ok("F2 玩家进入黑幕区域时中心格命中该区域", hitRes.hit, JSON.stringify(hitRes));
  }

  ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 200));
  await browser.close();
  console.log(fail === 0 ? `\nPASS ${pass}/${pass + fail}` : `\nFAIL ${fail} failed, ${pass} passed`);
  process.exitCode = fail === 0 ? 0 : 1;
});
