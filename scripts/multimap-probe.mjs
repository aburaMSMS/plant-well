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
      rooms: m.keyOrder.length,
      first: m.keyOrder[0],
      roomId: m.rooms["0,0"]?.id ?? "",
      spawnRoom: m.spawn.room,
      key: window.__pwEditor.state.key,
    };
  });
  ok("新图起始房+出生点+工作房就位", nm.rooms === 1 && nm.first === "0,0" && nm.spawnRoom === nm.roomId && nm.key === "0,0", JSON.stringify(nm));

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
    return { name: m.name, rooms: m.keyOrder.length, objects: m.rooms["0,0"]?.objects.length ?? -1 };
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
  ok("切回 M01 且工作房=出生点房 2,0", st.map === "M01" && st.key === "2,0", JSON.stringify(st));

  // 6. 小地图右键拖动：M02 拼出 8 房竖列（192px > 视口 168px）才拖得动
  await page.evaluate(() => {
    const sel = document.querySelector("#mapSelect");
    sel.value = "M02";
    sel.dispatchEvent(new Event("change"));
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = window.__pwEditor.doc;
    for (let i = 1; i <= 7; i++) d.addRoom(`0,${i}`);
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
  // 左键：点已有房=切房；点空位=弹确认创建（对话框接受才建，取消不建）
  // M02 此刻是 (0,0..0,7) 竖列；井图原点 = 包围盒扩 4 格 → min(-4,-4)；拖动后 mm=(0,90)
  const cellCss = (c, r) => ({
    x: mapBox.x + (c + 4) * 38 - mm1.x + 19,
    y: mapBox.y + (r + 4) * 24 - mm1.y + 12,
  });
  // 点已有房 (0,2)：切过去
  const cExist = cellCss(0, 2);
  await page.mouse.click(cExist.x, cExist.y);
  await page.waitForTimeout(150);
  const keyExist = await page.evaluate(() => window.__pwEditor.state.key);
  ok("小地图左键点已有房=切房", keyExist === "0,2", keyExist);
  // 点空位 (1,3)：确认对话框接受 → 创建并切过去（mm 用切房后现读值，mmEnsureVisible 可能已重新居中）
  const mm2 = await page.evaluate(() => window.__pwEditor.state.mm);
  const cellCss2 = (c, r) => ({ x: mapBox.x + (c + 4) * 38 - mm2.x + 19, y: mapBox.y + (r + 4) * 24 - mm2.y + 12 });
  page.once("dialog", (d) => d.accept());
  const cEmpty = cellCss2(1, 3);
  await page.mouse.click(cEmpty.x, cEmpty.y);
  await page.waitForTimeout(250);
  const created = await page.evaluate(() => ({
    has: !!window.__pwEditor.doc.rooms["1,3"],
    key: window.__pwEditor.state.key,
  }));
  ok("小地图点空位+确认 → 创建新房间并切过去", created.has && created.key === "1,3", JSON.stringify(created));
  // 点空位 (2,3)：对话框取消 → 不创建
  page.once("dialog", (d) => d.dismiss());
  const cEmpty2 = cellCss2(2, 3);
  await page.mouse.click(cEmpty2.x, cEmpty2.y);
  await page.waitForTimeout(250);
  const notCreated = await page.evaluate(() => !!window.__pwEditor.doc.rooms["2,3"]);
  ok("取消确认 → 不创建", !notCreated, `2,2 exists=${notCreated}`);

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
  const stIssues = await page.evaluate(() => window.__pwEditor.doc.validate().filter((i) => i.level === "error").length);
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
