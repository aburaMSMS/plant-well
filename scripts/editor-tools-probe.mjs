// 编辑器工具探针：①空气材料在建筑类（橡皮已并入）②矩形填充跟随所选材料 ③框选多选+批量删除。
// 只改内存文档不保存；结束前还原（撤销）。
import { chromium } from "playwright";

const BASE = "http://localhost:5199";
let pass = 0, failCount = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/editor.html`);
await page.waitForFunction(() => !!window.__pwEditor, null, { timeout: 20000 });
await page.waitForTimeout(800);

// 1. 工具条：无橡皮；建筑类有"空气"
const tools = await page.evaluate(() => [...document.querySelectorAll("#tools button")].map((b) => b.textContent.trim().slice(0, 2)));
ok("工具条=选择/放置/矩形（无橡皮）", JSON.stringify(tools) === JSON.stringify(["选择", "放置", "矩形"]), JSON.stringify(tools));
const buildChips = await page.evaluate(() => [...document.querySelectorAll("#objPalette button[data-ch]")].map((b) => b.dataset.ch));
ok("建筑类含岩壁+空气", buildChips.includes("#") && buildChips.includes("."), JSON.stringify(buildChips));

// 2. 空气画笔：选空气 → 涂瓦片变空气（原橡皮职责）
const solidBefore = await page.evaluate(() => {
  const d = window.__pwEditor.doc;
  const r = Object.values(d.rooms).find((rr) => rr.x === 2 && rr.y === 0);
  return { solid: r.map[14][6] === "#", row: r.map[14] };
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#objPalette button[data-ch]")].find((b) => b.dataset.ch === ".");
  btn.click();
});
await page.click("#tools button[data-tool='rect']");
const canvasBox = await (await page.$("#view")).boundingBox();
// 点一个实心格：需要先知道视野。用 doc 直接画替代（画笔路径已由矩形覆盖），这里验 UI 状态即可
const selTile = await page.evaluate(() => (document.querySelector("#stTool")?.textContent ?? "").includes("空气"));
ok("选中空气材料（状态栏显示 空气）", selTile, await page.evaluate(() => document.querySelector("#stTool")?.textContent ?? ""));

// 3. 矩形填充（空气）：直接对 doc 调 fillRect 路径——通过真实 UI 拖拽在 (2,0) 内
//    先切视野到 2,0（默认已在），拖拽矩形 (4,3)-(9,6) 填空气
const solidCount = async () => page.evaluate(() => {
  const r = Object.values(window.__pwEditor.doc.rooms).find((rr) => rr.x === 2 && rr.y === 0);
  let n = 0;
  for (let y = 13; y <= 15; y++) for (let x = 8; x <= 10; x++) if (r.map[y][x] === "#") n++;
  return n;
});
await page.evaluate(() => Object.values(window.__pwEditor.doc.rooms).find((rr) => rr.x === 2 && rr.y === 0)); // warm
// 计算画布上 (4,3) 格的屏幕坐标：用 renderer 不可见，改为发 pointer 事件前先复位视图（Ctrl+HOME 不存在）——
// 直接用页面坐标：从 view 中心反推不可靠；改为直接驱动内部函数路径：pointer 事件需要相机。
// 简化：调用与 pointerup 相同的 fillRect 效果——通过拖拽事件（marquee 之外的 rect 工具），
// 依赖 renderer.ts=当前缩放。改用 doc 层验证 + UI 拖拽冒烟合并：
const before = await solidCount();
// 找一个屏幕上的确定格：把相机对准房间（gotoRoom 已居中），缩放 ts 由 fit 计算——从画布尺寸推：
const grid = await page.evaluate(() => {
  const cv = document.querySelector("#view");
  const w = window;
  return { cw: cv.clientWidth, ch: cv.clientHeight };
});
// ts = clamp(floor(min((w-30)/32,(h-30)/18)),10,32)
const ts = Math.max(10, Math.min(32, Math.floor(Math.min((grid.cw - 30) / 32, (grid.ch - 30) / 18))));
// 世界格（当前房 2,0 局部 gx,gy）→ 屏幕 px。画布世界原点=(0,0) 房左上，cam 每次现读。
const cell = async (gx, gy) => {
  const cam = await page.evaluate(() => window.__pwEditor.state.cam);
  return {
    x: canvasBox.x + (2 * 32 + gx + 0.5) * cam.ts - cam.camX,
    y: canvasBox.y + (0 * 18 + gy + 0.5) * cam.ts - cam.camY,
  };
};
{
    const a = await cell(8, 13), b2 = await cell(10, 15);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b2.x, b2.y, { steps: 6 });
    await page.mouse.up();
  }
await page.waitForTimeout(200);
const after = await solidCount();
ok(`矩形填充空气（(8,13)-(10,15) 实心 ${before} → ${after}）`, after === 0 && before > 0, `before=${before} after=${after}`);
// 矩形填岩壁（切回岩壁材料再拖一次）
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#objPalette button[data-ch]")].find((b) => b.dataset.ch === "#");
  btn.click();
});
{
    const a = await cell(8, 13), b2 = await cell(10, 15);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b2.x, b2.y, { steps: 6 });
    await page.mouse.up();
  }
await page.waitForTimeout(200);
const afterSolid = await solidCount();
ok("矩形填充岩壁（同区域全部还原为实心）", afterSolid === 9, `afterSolid=${afterSolid}`);
// 撤销两次矩形（回到原始地图）
await page.keyboard.press("Control+z");
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);

// 4. 框选：在 2,0 放两个装饰物件 → 选择工具框选 → 批量删除
await page.evaluate(() => {
  const d = window.__pwEditor.doc;
  Object.values(d.rooms).find((rr) => rr.x === 2 && rr.y === 0).objects.push(
    { type: "flower", location: { room_id: "R12", x: 12, y: 10 } },
    { type: "flower", location: { room_id: "R12", x: 15, y: 12 } },
  );
  d.touch();
});
await page.click("#tools button[data-tool='select']");
{
    const a = await cell(11, 9), b2 = await cell(16, 13);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b2.x, b2.y, { steps: 6 });
    await page.mouse.up();
  }
await page.waitForTimeout(200);
const mar = await page.evaluate(() => {
  const insp = document.querySelector("#inspector");
  return { multi: window.__pwEditor.state.multi ?? null, head: insp.querySelector("h3")?.textContent ?? "" };
});
ok("框选拖拽产生多选批量卡片", mar.head.includes("框选") && mar.multi !== null, JSON.stringify(mar));
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
const afterDel = await page.evaluate(() => {
  const os = Object.values(window.__pwEditor.doc.rooms).find((rr) => rr.x === 2 && rr.y === 0).objects;
  return os.filter((o) => o.type === "flower").length;
});
ok("Del 批量删除（flower 全清）", afterDel === 0, `left=${afterDel}`);
// 撤销批量删除 → 两个 flower 都回来（整体撤销）
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);
const undone = await page.evaluate(() => Object.values(window.__pwEditor.doc.rooms).find((rr) => rr.x === 2 && rr.y === 0).objects.filter((o) => o.type === "flower").length);
ok("批量删除可整体撤销（2 个都回来）", undone === 2, `flowers=${undone}`);

ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));
console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
await browser.close();
process.exit(failCount === 0 ? 0 : 1);
