// CDP 常驻采样器：连接 port 9223 上用户正在玩的页面，高频记录世界状态到 .cdp-trace.jsonl。
// 用途：用户手动复现"跨房视角不跟"，事后逐帧回放 cx/camX/fade/玩家/按键/帧节奏。
// 采样周期 16ms；每次 vite 整页重载后自动重挂；房间/换场事件即时打到 stdout 供活看。
import { chromium } from "playwright";
import fs from "node:fs";

const CDP = "http://127.0.0.1:9223";
const OUT = ".cdp-trace.jsonl";
const PERIOD_MS = 16;

const stream = fs.createWriteStream(OUT, { flags: "a" });
const write = (obj) => stream.write(JSON.stringify(obj) + "\n");

const browser = await chromium.connectOverCDP(CDP);
console.log(`[watch] connected to ${browser.browserType().name()} @ ${CDP}`);

let ctx = browser.contexts()[0];
let page = null;

async function findPage() {
  for (const c of browser.contexts()) {
    for (const p of c.pages()) {
      if (p.url().includes("localhost:5199")) return p;
    }
  }
  return null;
}

// 等页面就绪并安装 in-page 帧节奏记录器（rAF 时间戳环形缓冲）
async function attach() {
  page = await findPage();
  if (!page) return false;
  try {
    await page.waitForFunction(() => !!window.__pw?.world, null, { timeout: 60000 });
  } catch {
    console.log("[watch] __pw not ready yet, retrying...");
    return false;
  }
  await page.evaluate(() => {
    const w = window.__pw.world;
    w.__frames = [];
    if (!window.__frameProbe) {
      window.__frameProbe = true;
      const tick = (t) => {
        const f = window.__pw?.world?.__frames;
        if (f) { f.push(t); if (f.length > 600) f.splice(0, f.length - 600); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });
  console.log(`[watch] attached to ${page.url()} — recording`);
  return true;
}

let lastLog = [];
let lastCx = null, lastCy = null, lastFade = "", lastMode = "";

while (true) {
  if (browser.contexts().length === 0) {
    await new Promise((r) => setTimeout(r, 250));
    continue;
  }
  const found = await findPage();
  if (!found) { await new Promise((r) => setTimeout(r, 300)); continue; }
  page = found;
  let ok = false;
  try { ok = await attach(); } catch { ok = false; }
  if (!ok) { page = null; await new Promise((r) => setTimeout(r, 300)); continue; }

  // 采样循环：页面失联（重载）时 evaluate 会抛出，外层重挂
  try {
    while (true) {
      const s = await page.evaluate(() => {
        const w = window.__pw?.world;
        if (!w) return null;
        const f = w.__frames ?? [];
        const n = f.length;
        const dts = [];
        for (let i = Math.max(1, n - 4); i < n; i++) dts.push(+(f[i] - f[i - 1]).toFixed(1));
        let keys = [];
        try { keys = [...w.input.heldActions]; } catch {}
        return {
          t: Date.now(),
          pt: +performance.now().toFixed(1),
          mode: window.__pw.mode,
          cx: w.cx, cy: w.cy,
          camX: +w.camX.toFixed(2), camY: +w.camY.toFixed(2),
          px: +w.player.x.toFixed(2), py: +w.player.y.toFixed(2),
          fade: w.fade ? { phase: w.fade.phase, t: +w.fade.t.toFixed(3), dur: w.fade.dur ?? null } : null,
          keys,
          dts,
          vis: document.visibilityState,
          log: (w.debugLog ?? []).slice(-3),
          ended: !!w.ending || !!w.epilogue,
        };
      });
      if (!s) { throw new Error("world gone (reload)"); }
      write(s);
      // 事件即时播报
      const logKey = JSON.stringify(s.log);
      if (logKey !== JSON.stringify(lastLog) && s.log.length) {
        const fresh = s.log.filter((l) => !lastLog.includes(l));
        for (const l of fresh) console.log(`[event] ${l}`);
        lastLog = s.log;
      }
      if (s.cx !== lastCx || s.cy !== lastCy) {
        console.log(`[room] (${lastCx},${lastCy}) -> (${s.cx},${s.cy})  player=(${s.px},${s.py}) fade=${JSON.stringify(s.fade)}`);
        lastCx = s.cx; lastCy = s.cy;
      }
      const fk = s.fade ? `${s.fade.phase}:${s.fade.t}` : "none";
      if (fk !== lastFade) { console.log(`[fade] ${lastFade} -> ${fk}  cx=(${s.cx},${s.cy}) cam=(${s.camX},${s.camY})`); lastFade = fk; }
      if (s.mode !== lastMode) { console.log(`[mode] ${lastMode} -> ${s.mode}`); lastMode = s.mode; }
      await new Promise((r) => setTimeout(r, PERIOD_MS));
    }
  } catch (e) {
    console.log(`[watch] sampling interrupted: ${String(e).slice(0, 120)} — reattaching`);
    page = null;
    await new Promise((r) => setTimeout(r, 400));
  }
}
