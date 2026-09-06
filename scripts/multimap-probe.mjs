// 多地图定向探针：新建/改名/导入（真实文件）/切图/小地图右键拖动/★设为游戏图/保存落盘/游戏页跟着切图。
// 数据是 JSON：保存会写 src/data/maps/<id>.json 与 src/data/gameMap.json；
// 结束前用 fs 直接还原（新建的地图文件删除、gameMap.json 写回原字节）。
import { chromium } from "playwright";
import fs from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:5199";
let pass = 0, failCount = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
};

const TMP = "tmp-map-import.json";
const MAPS_DIR = "src/data/maps";
const gameMapBefore = fs.readFileSync("src/data/gameMap.json", "utf8");
const mapFilesBefore = fs.readdirSync(MAPS_DIR).sort();

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(`${BASE}/editor.html`);
  await page.waitForFunction(() => !!window.__pwEditor, null, { timeout: 20000 });
  await page.waitForTimeout(800);

  // 1. 初始状态：只有 M01，它就是游戏图
  let st = await page.evaluate(() => window.__pwEditor.state);
  ok("初始只有 M01", st.maps.length === 1 && st.maps[0] === "M01", JSON.stringify(st.maps));
  ok("M01 即游戏图", st.map === "M01" && st.gameMap === "M01");

  // 2. 新建地图：起始房 + 出生点 + 自动切换
  await page.click("#mapNew");
  await page.waitForTimeout(200);
  st = await page.evaluate(() => window.__pwEditor.state);
  ok("新建后切到 M02", st.maps.length === 2 && st.map === "M02", JSON.stringify(st));
  const nm = await page.evaluate(() => {
    const d = window.__pwEditor.doc;
    const m = d.curMap();
    return {
      rooms: m.idOrder.length,
      first: m.idOrder[0],
      firstPos: m.rooms[m.idOrder[0]] ? m.rooms[m.idOrder[0]].x + "," + m.rooms[m.idOrder[0]].y : "?",
      spawnRoom: m.spawn.room,
      key: window.__pwEditor.state.key,
    };
  });
  ok("新图起始房@0,0+出生点+工作房就位", nm.rooms === 1 && nm.firstPos === "0,0" && nm.spawnRoom === nm.first && nm.key === nm.first, JSON.stringify(nm));

  // 3. 改名
  await page.evaluate(() => {
    const inp = document.querySelector("#mapName");
    inp.value = "测试图";
    inp.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(100);
  const name2 = await page.evaluate(() => window.__pwEditor.doc.curMap().name);
  ok("改名生效", name2 === "测试图", name2);

  // 4. 导出→导入 round-trip（走真实文件 input）
  const exported = await page.evaluate(() => window.__pwEditor.doc.exportMap());
  fs.writeFileSync(TMP, exported);
  await page.setInputFiles("#mapFile", TMP);
  await page.waitForTimeout(300);
  st = await page.evaluate(() => window.__pwEditor.state);
  ok("导入后 3 张图、切到 M03（id 自动顺延）", st.maps.length === 3 && st.map === "M03", JSON.stringify(st));
  const imp = await page.evaluate(() => {
    const m = window.__pwEditor.doc.curMap();
    return { name: m.name, rooms: m.idOrder.length, objects: Object.values(m.rooms).find((rr) => rr.x === 0 && rr.y === 0)?.objects.length ?? -1 };
  });
  ok("导入图内容一致（名/房/空物件）", imp.name === "测试图" && imp.rooms === 1 && imp.objects === 0, JSON.stringify(imp));

  // 5. 切回 M01：工作房回到该图出生点房
  await page.evaluate(() => {
    const sel = document.querySelector("#mapSelect");
    sel.value = "M01";
    sel.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(200);
  st = await page.evaluate(() => window.__pwEditor.state);
  const spawnId0 = await page.evaluate(() => window.__pwEditor.doc.curMap().spawn.room);
  ok("切回 M01 且工作房=出生点房 " + spawnId0, st.map === "M01" && st.key === spawnId0, JSON.stringify(st));

  // 6. 小地图右键拖动：M02 拼出 8 房竖列（192px > 视口 168px）才拖得动
  await page.evaluate(() => {
    const sel = document.querySelector("#mapSelect");
    sel.value = "M02";
    sel.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = window.__pwEditor.doc;
    for (let i = 1; i <= 7; i++) d.addRoom(0, i);
  });
  await page.waitForTimeout(250);
  const mm0 = await page.evaluate(() => window.__pwEditor.state.mm);
  const mapBox = await (await page.$("#roomMap")).boundingBox();
  // 向上拖 = 视口往下滚（露出第 7 行）；mmY 从 0 钳制上限 32
  await page.mouse.move(mapBox.x + 20, mapBox.y + Math.min(140, mapBox.height - 8));
  await page.mouse.down({ button: "right" });
  await page.mouse.move(mapBox.x + 20, mapBox.y + 10, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(150);
  const mm1 = await page.evaluate(() => window.__pwEditor.state.mm);
  ok("小地图右键拖动平移（视口偏移变化）", mm1.y > mm0.y, JSON.stringify({ mm0, mm1 }));
  // 左键：点已有房=切房；点空位=弹确认创建（对话框接受才建，取消不建）。
  // M02 此刻是 (0,0..0,7) 竖列；井图原点 = 包围盒扩 4 格 → min(-4,-4)。
  // 拖动后视口在哪由 mm 决定——按当前 mm 挑"画布内可见"的格子来点，不写死格名。
  const CW = 38, CH = 24, MG = 4;
  const cellPt = (mm, c, r) => ({
    x: mapBox.x + (c + MG) * CW - mm.x + CW / 2,
    y: mapBox.y + (r + MG) * CH - mm.y + CH / 2,
  });
  const visibleCell = async (c, r) => {
    const mm = await page.evaluate(() => window.__pwEditor.state.mm);
    const cv = await (await page.$("#roomMap")).boundingBox();
    const p = cellPt(mm, c, r);
    return p.x >= cv.x + 4 && p.x <= cv.x + cv.width - 4 && p.y >= cv.y + 4 && p.y <= cv.y + cv.height - 4 ? p : null;
  };
  // 点已有房：找一个当前视口内可见的已有房格（col 0, rows 0..7）
  let clicked = false;
  for (const r of [5, 4, 6, 3, 2, 1]) {
    const p = await visibleCell(0, r);
    if (!p) continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
    const keyNow = await page.evaluate(() => window.__pwEditor.state.key);
    const ridNow = await page.evaluate((row) => {
      const rr = Object.values(window.__pwEditor.doc.rooms).find((r2) => r2.x === 0 && r2.y === row);
      return rr?.id ?? "";
    }, r);
    if (keyNow === ridNow && ridNow) {
      ok(`小地图左键点已有房 (0,${r})=切房到 ${ridNow}`, true);
      clicked = true;
      break;
    }
  }
  ok("小地图左键点已有房=切房", clicked, "视口内没找到可点的已有房");
  // 点空位：确认对话框接受 → 创建并切过去（位置任选视口内空格，col 1 全空）
  let createdAt = null;
  for (const r of [5, 4, 6, 3]) {
    const p = await visibleCell(1, r);
    if (!p) continue;
    page.once("dialog", (d) => d.accept());
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    createdAt = await page.evaluate((row) => {
      const rr = Object.values(window.__pwEditor.doc.rooms).find((r2) => r2.x === 1 && r2.y === row);
      return rr ? { id: rr.id, x: rr.x, y: rr.y, key: window.__pwEditor.state.key } : null;
    }, r);
    if (createdAt) break;
  }
  ok("小地图点空位+确认 → 创建新房间并切过去", createdAt && createdAt.key === createdAt.id, JSON.stringify(createdAt));
  // 再点一个空位：对话框取消 → 不创建
  page.once("dialog", (d) => d.dismiss());
  let dismissAt = null;
  for (const r of [6, 3, 4]) {
    const p = await visibleCell(2, r);
    if (!p) continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    dismissAt = await page.evaluate(([rr]) => !!Object.values(window.__pwEditor.doc.rooms).some((r2) => r2.x === 2 && r2.y === rr), [r]);
    if (dismissAt === false) { ok(`取消确认 → 不创建 (2,${r})`, true); break; }
  }
  if (dismissAt === null) ok("取消确认 → 不创建", false, "视口内没找到空位");
  else if (dismissAt === true) ok("取消确认 → 不创建", false, "对话框取消后仍创建了房间");

  // 7. ★ 设为游戏图 + 保存 → GAME_MAP_ID 落盘
  await page.click("#mapGame");
  await page.waitForTimeout(100);
  st = await page.evaluate(() => window.__pwEditor.state);
  ok("★ 后 gameMap=M02（内存）", st.gameMap === "M02", JSON.stringify(st));
  await page.click("#saveBtn");
  let savedToDisk = false;
  for (let i = 0; i < 40 && !savedToDisk; i++) {
    await page.waitForTimeout(150);
    savedToDisk = fs.readFileSync("src/data/gameMap.json", "utf8").includes('"gameMapId": "M02"');
  }
  ok("保存后 gameMap.json 落盘 M02", savedToDisk);
  const mapsNow = fs.readdirSync(MAPS_DIR).sort();
  ok("落盘为 3 个地图文件（一张图一个 JSON）", JSON.stringify(mapsNow) === JSON.stringify(["M01.json", "M02.json", "M03.json"]), JSON.stringify(mapsNow));
  ok("M02.json 内容就是编辑器里的测试图", fs.readFileSync(join(MAPS_DIR, "M02.json"), "utf8").includes('"name": "测试图"'));
  // 保存触发 maps.ts 变更冒泡 → 编辑器全页刷新，等它重建完再校验
  await page.waitForFunction(() => !!window.__pwEditor, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const stIssuesAll = await page.evaluate(() => window.__pwEditor.doc.validate().filter((i) => i.level === "error"));
  const stIssues = stIssuesAll.length;
  ok("新图数据校验 0 错", stIssues === 0, `errors=${stIssues}`);

  // 8. 游戏页跟着切图：新图只有一间房，出生点 160,90（过开机门进入 game 态才有位置）
  const gpage = await browser.newPage();
  const gerr = [];
  gpage.on("pageerror", (e) => gerr.push(String(e)));
  await gpage.goto(`${BASE}/?debug=1`);
  await gpage.waitForFunction(() => !!window.__pw, null, { timeout: 20000 });
  await gpage.keyboard.press("Enter"); // 开机门
  await gpage.waitForTimeout(1100); // introT 0.6s 吞键窗 + 余量
  await gpage.keyboard.press("Enter"); // 菜单确认
  await gpage.waitForFunction(() => window.__pw?.mode === "game", null, { timeout: 15000 });
  await gpage.waitForTimeout(500);
  const g = await gpage.evaluate(() => {
    const w = window.__pw.world;
    return { cx: w.cx, cy: w.cy, px: Math.round(w.player.x), py: Math.round(w.player.y), seeds: w.seeds.size };
  }).catch((e) => ({ err: String(e) }));
  ok("游戏出生在 M02 的 0,0", g.cx === 0 && g.cy === 0, JSON.stringify(g));
  ok("游戏出生点像素=新图出生点（落地容差）", g.px === 160 && Math.abs(g.py - 90) <= 8, JSON.stringify(g));
  ok("游戏页无 JS 错误", gerr.length === 0, gerr.join(" | ").slice(0, 200));
  await gpage.close();

  // 9. 清理：fs 直接还原 gameMap.json 原字节、删除本会话新建的地图文件
  fs.writeFileSync("src/data/gameMap.json", gameMapBefore, "utf8");
  for (const f of fs.readdirSync(MAPS_DIR)) {
    if (!mapFilesBefore.includes(f)) fs.unlinkSync(join(MAPS_DIR, f));
  }
  const restored =
    fs.readFileSync("src/data/gameMap.json", "utf8") === gameMapBefore &&
    JSON.stringify(fs.readdirSync(MAPS_DIR).sort()) === JSON.stringify(mapFilesBefore);
  ok("清理：JSON 数据已恢复原状", restored);
} finally {
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
}

ok("编辑器无页面 JS 错误", errors.length === 0, errors.join(" | ").slice(0, 300));
console.log(`\n${failCount === 0 ? "✓ 全部通过" : "✗"} ${pass} 过 / ${failCount} 失败`);
await browser.close();
process.exit(failCount === 0 ? 0 : 1);
