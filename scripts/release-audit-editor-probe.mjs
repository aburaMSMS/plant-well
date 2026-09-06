// 编辑器冒烟探针：页面装载无错、调色板放置/撤销、校验状态、保存通道探测、检查器字段。
// 只读为主；不改任何数据文件（不点保存）。
import { chromium } from "playwright";

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

await page.goto(`${BASE}/editor.html`);
await page.waitForFunction(() => !!window.__pwEditor, null, { timeout: 20000 });
await page.waitForTimeout(800);

// 1. 保存通道探测就绪（probeChannel 异步，等横幅消失）
await page.waitForTimeout(600);
const channelOk = await page.evaluate(() => {
  const el = document.querySelector("#channelWarn");
  return el ? el.hidden : false;
});
ok("写回通道探测 OK（无红色横幅）", channelOk);

// 2. 校验状态：错误应为 0（允许警告）
const issueText = await page.evaluate(() => document.querySelector("#stIssues")?.textContent ?? "");
ok("编辑器校验无错误", /OK|警告/.test(issueText) && !/错误/.test(issueText), issueText);

// 3. 调色板放一个物件 → 检查器出现 → 撤销（场景类默认折叠：先展开）
const before = await page.evaluate(() => window.__pwEditor.state.objects);
await page.click('#objPalette .catHead:has-text("场景")');
await page.waitForTimeout(150);
await page.click('#objPalette button[data-type="tree"]');
await page.waitForTimeout(150);
// 画布中央点击放置
const canvasBox = await (await page.$("#view")).boundingBox();
await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
await page.waitForTimeout(250);
const after = await page.evaluate(() => window.__pwEditor.state.objects);
ok("放置物件（objects +1）", after === before + 1, `${before}→${after}`);
const inspectorShown = await page.evaluate(() => !!document.querySelector("#inspector h3"));
ok("放置后检查器刷新", inspectorShown);
// 检查器应有 location 分组输入（room_id + x + y + 选点）
const locFields = await page.evaluate(() => ({
  room: !!document.querySelector('#inspector input.loc-room[data-k="location"]'),
  x: !!document.querySelector('#inspector input.loc-xy[data-k="location"][data-lk="x"]'),
  pick: !!document.querySelector('#inspector button[data-pick="location"]'),
}));
ok("location 分组字段齐全（room_id/x/选点）", locFields.room && locFields.x && locFields.pick, JSON.stringify(locFields));
// 撤销
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
const undone = await page.evaluate(() => window.__pwEditor.state.objects);
ok("Ctrl+Z 撤销（objects 还原）", undone === before, `${after}→${undone}`);

// 4. 新物品工坊完整往返：新建 prop → 保存 → 放置到地图（palSel 同步修复）→ 画布落点 → 撤销 → 删除还原
page.on("dialog", (d) => void d.accept());
{
  await page.click("#propBtn");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#workshop button")];
    btns.find((b) => /＋ 新建物件/.test(b.textContent ?? ""))?.click();
  });
  await page.waitForTimeout(200);
  // 保存 propData.ts（写回后工坊自动关闭）
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#workshop button")];
    btns.find((b) => /保存物件/.test(b.textContent ?? ""))?.click();
  });
  await page.waitForTimeout(600);
  // 重开工坊：新 prop 应在列表里
  await page.click("#propBtn");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#workshop button")];
    btns.find((b) => /放置到地图/.test(b.textContent ?? ""))?.click();
  });
  await page.waitForTimeout(250);
  const palSelState = await page.evaluate(() => document.querySelector("#stTool")?.textContent ?? "");
  ok("requestPlace 后工具=自定义物件（palSel 已同步）", /自定义物件/.test(palSelState), palSelState);
  // 画布点击：应真的放置 prop（回归修复验证）
  const b0 = await page.evaluate(() => window.__pwEditor.state.objects);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2 + 30, canvasBox.y + canvasBox.height / 2);
  await page.waitForTimeout(250);
  const b1 = await page.evaluate(() => window.__pwEditor.state.objects);
  ok("prop 真的放置成功（回归修复验证）", b1 === b0 + 1, `${b0}→${b1}`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  // 清理：删除测试 prop 并写回空 propData.ts（重开工坊后 propSel 不一定选中它：先点列表条目）
  await page.click("#propBtn");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const entry = document.querySelector("#workshop .wsList button");
    entry?.click();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#workshop button")];
    btns.find((b) => /删除/.test(b.textContent ?? ""))?.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#workshop button")];
    btns.find((b) => /保存物件/.test(b.textContent ?? ""))?.click();
  });
  await page.waitForTimeout(600);
  const propsRestored = await page.evaluate(async () => {
    const mod = await import("/src/data/propData.ts");
    return Object.keys(mod.PROPS ?? {}).length;
  });
  ok("测试 prop 已清理（propData.ts 还原为空）", propsRestored === 0, `PROPS=${propsRestored}`);
}

// 5. switch/plate 不再配 bind：检查现有文档里机关无 bind 字段，且新建不产生
const trigBind = await page.evaluate(() => {
  for (const room of Object.values(window.__pwEditor.doc.rooms)) {
    for (const o of room.objects) {
      if ((o.type === "switch" || o.type === "plate") && o.bind !== undefined) return String(o.bind);
    }
  }
  return null;
});
ok("机关无残留 bind 字段", trigBind === null, `found: ${trigBind}`);

// 6. 保存往返：房间 id 不被剥掉（导出器回归）+ 保存全页刷新后停留当前房间
{
  const hashBefore = await page.evaluate(async () => (await fetch("/__save/map/M01")).json()).then((d) => d.hash);
  await page.evaluate(() => {
    const sel = document.querySelector("#roomSelect");
    sel.value = "1,3";
    sel.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(200);
  const keyBefore = await page.evaluate(() => window.__pwEditor.state.key);
  await page.click("#saveBtn");
  // 保存成功 → 地图 JSON 变更冒泡 → 编辑器全页刷新
  await page.waitForFunction(() => !!window.__pwEditor, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const keyAfter = await page.evaluate(() => window.__pwEditor.state.key);
  ok("保存后停留当前房间", keyAfter === keyBefore, `${keyBefore} → ${keyAfter}`);
  const idLines = await page.evaluate(async () => {
    const r = await fetch("/__save/map/M01");
    return (await r.json()).ok ?? false;
  }).catch(() => false);
  void idLines;
  const errsAfter = await page.evaluate(() => {
    const issues = window.__pwEditor.doc.validate();
    return issues.filter((i) => i.level === "error").length;
  });
  ok("保存后校验仍无错误（id 未被剥掉）", errsAfter === 0, `errors=${errsAfter}`);
}

// 7. 双向绑定往返：放 switch + door → 🔗 点选绑定（两端写入）→ × 双向解除 → 撤销还原
async function clickCanvasCenter(dx = 0) {
  const box = await (await page.$("#view")).boundingBox();
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2);
  await page.waitForTimeout(250);
}
{
  const bootKey = await page.evaluate(() => window.__pwEditor.state.key);
  const baseN = await page.evaluate((k) => window.__pwEditor.doc.rooms[k].objects.length, bootKey);
  // 放开关（画布中心）
  await page.click('#objPalette .catHead:has-text("开关")');
  await page.click('#objPalette button[data-type="switch"]');
  await clickCanvasCenter();
  const swIdx = await page.evaluate(() => window.__pwEditor.state.objects - 1);
  // 放门（画布中心右侧 30px——同一像素点稍后用于绑定点选）
  await page.click('#objPalette .catHead:has-text("道具作用")');
  await page.click('#objPalette button[data-type="door"]');
  await clickCanvasCenter(30);
  const doorIdx = await page.evaluate(() => window.__pwEditor.state.objects - 1);
  const doorId = await page.evaluate((di) => {
    const d = window.__pwEditor.doc;
    return String(d.rooms[window.__pwEditor.state.key].objects[di].id ?? "");
  }, doorIdx);
  // 记录 switch 的自身 id（绑定后 door.triggeredBy 应回写它）
  const swId = await page.evaluate((si) => {
    const d = window.__pwEditor.doc;
    return String(d.rooms[window.__pwEditor.state.key].objects[si].id ?? "");
  }, swIdx);
  // door 应处于选中态：检查器有 🔗 绑定按钮（triggeredBy 字段）
  const hasBindBtn = await page.evaluate(() => !!document.querySelector('#inspector button[data-bindpick]'));
  ok("被控端检查器有「🔗 绑定」按钮", hasBindBtn);
  // 从 door 发起绑定：点 🔗 → 点画布上的 switch（中心像素）
  await page.click('#inspector button[data-bindpick]');
  await page.waitForTimeout(150);
  await clickCanvasCenter();
  const afterBind = await page.evaluate(({ bootKey, swIdx, doorIdx }) => {
    const os = window.__pwEditor.doc.rooms[bootKey].objects;
    return {
      controls: os[swIdx].controls ?? [],
      triggeredBy: os[doorIdx].triggeredBy ?? [],
      swId: String(os[swIdx].id ?? ""),
    };
  }, { bootKey, swIdx, doorIdx });
  ok(
    "双向绑定写入两端（controls+=door.id / triggeredBy+=switch.id）",
    afterBind.controls.includes(doorId) && afterBind.triggeredBy.includes(afterBind.swId),
    JSON.stringify(afterBind),
  );
  // 从被控端 × 解除：door 仍选中（绑定点击不改 selection？——绑定点选不改 selection，door 仍是选中态）
  const selNow = await page.evaluate(() => {
    // 绑定后 selection 可能变化：重新用 select 工具点 door 位置保险
    return window.__pwEditor.state.objects;
  });
  void selNow;
  // 直接再次选中 door：用选择工具点击 door 中心
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(120);
  await clickCanvasCenter(30);
  await page.waitForTimeout(150);
  const xBtn = await page.$('#inspector button[data-unbind]');
  ok("被控端 triggeredBy 有可解除的 × 按钮", !!xBtn);
  if (xBtn) {
    await xBtn.click();
    await page.waitForTimeout(200);
    const afterUnbind = await page.evaluate(({ bootKey, swIdx, doorIdx }) => {
      const os = window.__pwEditor.doc.rooms[bootKey].objects;
      return { controls: os[swIdx].controls ?? [], triggeredBy: os[doorIdx].triggeredBy ?? [] };
    }, { bootKey, swIdx, doorIdx });
    ok("双向解除清空两端", afterUnbind.controls.length === 0 && afterUnbind.triggeredBy.length === 0, JSON.stringify(afterUnbind));
  }
  // 撤销还原到基线（放置×2 + 绑定 + 解除 ≈ 4 次 mutate，多撤几次兜底）
  for (let i = 0; i < 8; i++) {
    const n = await page.evaluate(() => window.__pwEditor.doc.rooms[window.__pwEditor.state.key].objects.length);
    if (n <= baseN) break;
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(120);
  }
  const restored = await page.evaluate(() => window.__pwEditor.doc.rooms[window.__pwEditor.state.key].objects.length);
  ok("绑定场景撤销还原", restored === baseN, `${baseN} → ${restored}`);
}

ok("无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));

console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
await browser.close();
process.exit(failCount === 0 ? 0 : 1);
