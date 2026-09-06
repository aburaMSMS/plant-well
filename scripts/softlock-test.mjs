// 软锁回归：
// 1) 每个竖井的功能级攀回测试——把玩家放进下层竖井的根台上，应能跳回上层地面
// 2) 鞭子必须在必经之路上自动拾取（杜绝没鞭子进 (1,1) 的死局）
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://localhost:5199/?debug=1");
await page.waitForTimeout(600);
await page.keyboard.press("Enter"); // PRESS ANY KEY：起曲过门
await page.waitForTimeout(900);
await page.keyboard.press("Enter"); // 菜单确认
await page.waitForTimeout(700);

let failed = 0;
const check = (name, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
};

// ---- 功能攀回：[房间, 根台落点x, 每次跳跃的方向序列, 上层地面脚部y上限] ----
const climbs = [
  ["1,0", 65, ["KeyD", "KeyD", "KeyD", "KeyD", "KeyD", "KeyD"], 141, "(1,0) 竖坑 → 主地面"],
  ["1,1", 245, ["KeyD", "KeyD", "KeyA", "KeyA", "KeyA", "KeyA"], 141, "(1,1) 门洞 → 主地面"],
  ["1,2", 125, ["KeyD", "KeyD", "KeyD", "KeyD", "KeyD", "KeyD"], 141, "(1,2) 底洞 → 主地面"],
  ["2,3", 155, ["KeyD", "KeyD", "KeyA", "KeyA", "KeyA", "KeyA"], 141, "(2,3) 底洞 → 主地面"],
  ["1,5", 145, ["KeyD", "KeyD", "KeyA", "KeyA", "KeyA", "KeyA"], 141, "(1,5) 底洞 → 主地面"],
  ["1,3", 50, ["KeyA", "KeyA", "KeyA", "KeyA", "KeyA", "KeyA"], 147, "(1,3) 底坑 → 主地面（更低的地面）"],
  ["1,4", 210, ["KeyD", "KeyD", "KeyD", "KeyD", "KeyD", "KeyD"], 147, "(1,4) 底洞 → 主地面（更低的地面）"],
];
for (const [key, sx, dirs, maxY, desc] of climbs) {
  await page.evaluate(([k, x, y]) => {
    const w = window.__pw.world;
    const [cx, cy] = k.split(",").map(Number);
    w.loadRoom(cx, cy);
    w.player.spawnAt(x, y);
    w.lastSafeX = x;
    w.lastSafeY = y;
  }, [key, sx, 166]);
  // 反软锁的本质判定：玩家不能被困在竖井深处（y > maxY）出不来；
  // 只要任意时刻曾站上上层地面，或最终走进相邻房间，都算逃出
  let minUpperY = 999;
  let finalRoom = key;
  let finalState = null;
  for (const dir of dirs) {
    await page.keyboard.down(dir);
    await page.keyboard.down("KeyK");
    await page.waitForTimeout(260);
    await page.keyboard.up("KeyK");
    await page.waitForTimeout(140);
    await page.keyboard.up(dir);
    const st = await page.evaluate((k2) => {
      const w = window.__pw.world;
      return { room: `${w.cx},${w.cy}`, y: Math.round(w.player.y), x: Math.round(w.player.x) };
    }, key);
    finalRoom = st.room;
    finalState = st;
    if (st.room === key && st.y < minUpperY) minUpperY = st.y;
  }
  const escaped = minUpperY <= maxY || finalRoom !== key;
  check(`${desc}（最浅 ${minUpperY === 999 ? "-" : minUpperY}，落点 ${finalRoom} @ ${finalState.x},${finalState.y}）`, escaped);
}

// ---- 扩展区攀回：坠井、蹦菇塔、西苔洞、单出口口袋 ----

// (3,2) 蹦菇塔：①四菇弹跳机制 ②顶洞转换 ③悬圃壁龛接住——确定性断言（漂移技巧属玩家操作）
{
  const caps = [[155, 148], [135, 108], [175, 68], [155, 28]];
  let allBounce = true;
  for (const [sx, sy] of caps) {
    await page.evaluate(([x, y]) => {
      const w = window.__pw.world;
      w.loadRoom(3, 2);
      w.player.spawnAt(x, y);
      w.snapCamera();
    }, [sx, sy]);
    let launched = false;
    try {
      await page.waitForFunction(
        () => {
          const p = window.__pw.world.player;
          return !p.grounded && p.vy < -200;
        },
        null,
        { timeout: 1200, polling: 15 },
      );
      launched = true;
    } catch { /* 未弹 */ }
    if (!launched) allBounce = false;
  }
  check("(3,2) 蹇菇塔四菇弹跳全部发射", allBounce);
  // 模拟末跳（cap4 弹射 vy=-330）在竖井内上升 → 顶洞转换 → 悬圃壁龛接住
  await page.evaluate(() => {
    const w = window.__pw.world;
    w.loadRoom(3, 2);
    w.player.spawnAt(155, 30);
    w.player.vy = -330;
    w.jumpCutting = false;
    w.snapCamera();
  });
  await page.waitForFunction(
    () => `${window.__pw.world.cx},${window.__pw.world.cy}` === "3,1",
    null,
    { timeout: 4000, polling: 25 },
  ).catch(() => {});
  await page.waitForTimeout(1500); // 壁龛接住并稳定
  const fin = await page.evaluate(() => {
    const w = window.__pw.world;
    return `${w.cx},${w.cy} ${Math.round(w.player.x)}.${Math.round(w.player.y)} g${w.player.grounded ? 1 : 0}`;
  });
  check("(3,2) 顶洞转换 + 悬圃壁龛接住（末态 " + fin + "）", fin.startsWith("3,1"));
}

// (-1,2) 西苔洞：走到蹇菇正上方原地满跳 → 弹上贴墙石台 → 持右走出洞口（rows4-9）
{
  let escaped = false;
  for (let attempt = 0; attempt < 3 && !escaped; attempt++) {
    await page.evaluate(() => {
      const w = window.__pw.world;
      w.loadRoom(-1, 2);
      w.player.spawnAt(25, 146);
      w.lastSafeX = 25;
      w.lastSafeY = 146;
      w.transition = null; // 清掉上一场景残留的镜头动画
      w.snapCamera();
    });
    await page.waitForTimeout(300);
    await page.keyboard.down("KeyD");
    for (let i = 0; i < 60; i++) {
      const x = await page.evaluate(() => Math.round(window.__pw.world.player.x));
      if (x >= 268) break;
      await page.waitForTimeout(60);
    }
    await page.keyboard.up("KeyD");
    await page.waitForTimeout(200);
    await page.keyboard.down("KeyK"); // 原地满跳落回菇帽 → 弹上贴墙石台（点按会被松键截短成 3px 小跳）
    await page.waitForTimeout(300);
    await page.keyboard.up("KeyK");
    await page.waitForTimeout(500);
    await page.keyboard.down("KeyD"); // 石台上持右走出洞口
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      if ((await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`)) === "0,2") {
        escaped = true;
        break;
      }
    }
    await page.keyboard.up("KeyD");
  }
  check("(-1,2) 西苔洞 → 蹇菇弹回 (0,2)", escaped);
}

// (2,6) 井底东窟 / (4,3) 蔓豆石窟：单出口口袋走回去
await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(2, 6);
  w.player.spawnAt(255, 146);
  w.lastSafeX = 255;
  w.lastSafeY = 146;
});
await page.keyboard.down("KeyA");
await page.waitForTimeout(4500); // 整房宽 320px，走完需要 ~4s
await page.keyboard.up("KeyA");
const back26 = await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`);
check("(2,6) 井底东窟走回 (1,6)", back26 === "1,6");

await page.evaluate(() => {
  const w = window.__pw.world;
  w.loadRoom(4, 3);
  w.debugGrantAll();
  w.activeItem = "whip";
  w.player.spawnAt(285, 146);
  w.lastSafeX = 285;
  w.lastSafeY = 146;
  // 逃生测试只关心"路是通的"，游魂战斗不在本测试范围
  w.room.entities.forEach((e) => {
    if (e.constructor.name === "Wisp") e.dead = true;
  });
});
await page.keyboard.down("KeyA");
for (let i = 0; i < 10; i++) {
  await page.keyboard.press("KeyJ"); // 边走边砍藤墙
  await page.waitForTimeout(450);
}
await page.keyboard.up("KeyA");
const back43 = await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`);
check("(4,3) 蔓豆石窟砍藤走回 (3,3)", back43 === "3,3");

// ---- 封盖坑捷径：藤蔓荚封死的陷阱坑——砍开坠落，落点室走廊走回 (1,1)，全程无死局 ----
await page.evaluate(() => {
  const w = window.__pw.world;
  w.startNew();
  w.loadRoom(2, 0);
  w.items.add("whip");
  w.activeItem = "whip";
  w.player.spawnAt(190, 136); // 坑右侧
  w.lastSafeX = 190;
  w.lastSafeY = 136;
  w.snapCamera();
});
await page.waitForTimeout(300);
// 先验证封盖生效：未砍盖时向左走，不得坠入
await page.keyboard.down("KeyA");
await page.waitForTimeout(900);
const sealed = await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`);
await page.keyboard.up("KeyA");
check("(2,0) 藤荚封盖未砍时不坠（仍在 " + sealed + "）", sealed === "2,0");
// 原地转两圈砍开双荚（玩家不动——行走会让节奏对不上旋转相位）
await page.waitForTimeout(200);
await page.keyboard.down("KeyJ");
await page.waitForTimeout(450);
await page.keyboard.press("KeyD"); // 改变扫掠相位
await page.waitForTimeout(450);
await page.keyboard.press("KeyD");
await page.waitForTimeout(450);
await page.keyboard.up("KeyJ");
const cut = await page.evaluate(() => window.__pw.world.flags.has("vinebud:2,0#2") && window.__pw.world.flags.has("vinebud:2,0#3"));
check("双藤蔓荚盖全被砍开", cut);
// 坠入：置于开口上方，重力完成剩下的
await page.evaluate(() => {
  const w = window.__pw.world;
  w.player.x = 155;
  w.player.y = 138;
});
let fell = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => `${window.__pw.world.cx},${window.__pw.world.cy}`);
  if (r === "2,1") {
    fell = true;
    break;
  }
}
check("(2,0) 砍盖后坠入落点室 (2,1)", fell);
// 落点室向左走廊走回 (1,1)——重试 3 次（走廊行走 + 转换衔接对时序敏感）
let out11 = "";
for (let attempt = 0; attempt < 3; attempt++) {
  await page.evaluate(() => {
    const w = window.__pw.world;
    w.loadRoom(2, 1);
    w.player.spawnAt(150, 146);
    w.lastSafeX = 150;
    w.lastSafeY = 146;
    w.transition = null;
    w.snapCamera();
  });
  await page.waitForTimeout(250);
  await page.keyboard.down("KeyA");
  try {
    await page.waitForFunction(
      () => `${window.__pw.world.cx},${window.__pw.world.cy}` === "1,1",
      null,
      { timeout: 6000, polling: 50 },
    );
  } catch { /* 本轮超时则重试 */ }
  await page.keyboard.up("KeyA");
  await page.waitForTimeout(400);
  out11 = await page.evaluate(() => {
    const w = window.__pw.world;
    return `${w.cx},${w.cy} ${Math.round(w.player.x)}.${Math.round(w.player.y)} dead${Math.round(w.player.deadT * 100)}`;
  });
  if (out11.startsWith("1,1")) break;
}
check("(2,1) 落点室走廊走回 (1,1)——捷径无死局（末态 " + out11 + "）", out11.startsWith("1,1"));

// ---- 鞭子必经之路自动拾取 ----
await page.evaluate(() => {
  window.__pw.world.startNew();
  // 井口陷阱坑已被藤荚封盖挡路，从坑左侧的高台出发走鞭子路线（route 不跨坑）
  window.__pw.world.player.spawnAt(90, 106); // col9 高台上（col10 已是悬空）
});
await page.keyboard.down("KeyA");
for (let i = 0; i < 20; i++) {
  await page.keyboard.down("KeyK");
  await page.waitForTimeout(250);
  await page.keyboard.up("KeyK");
  await page.waitForTimeout(130);
}
await page.keyboard.up("KeyA");
const st = await page.evaluate(() => {
  const w = window.__pw.world;
  return { items: [...w.items], room: `${w.cx},${w.cy}` };
});
check(`鞭子自动拾取（items: ${st.items.join(",") || "无"}，最终 ${st.room}）`, st.items.includes("whip"));

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
