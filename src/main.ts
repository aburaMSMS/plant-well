import { createDisplay } from "./engine/display";
import { startLoop } from "./engine/loop";
import { Input } from "./engine/input";
import { audio } from "./engine/audio";
import { applyDebugLighting } from "./engine/debugLighting";
import { Title } from "./game/title";
import { World } from "./game/world";

const ctx = createDisplay();
const input = new Input();
input.attach(window);

const debug = new URLSearchParams(location.search).get("debug") === "1";
// 编辑器深链：/?debug=1&room=R12 直达指定房间（房间 id；仅 debug 生效）
const debugRoom = debug ? new URLSearchParams(location.search).get("room") : null;
if (debug) {
  // 供自动化测试探查内部状态
  (window as unknown as Record<string, unknown>).__pw = {
    get world() { return world; },
    input,
    get mode() { return mode; },
    get title() { return title; },
    audio,
  };
}

let mode: "title" | "game" = "title";
let world = new World(input);
world.debug = debug;
if (debug) applyDebugLighting(world);
world.onExitToTitle = () => {
  mode = "title";
  title.reset();
  audio.setTrack("title");
};
const title = new Title(
  input,
  {
    onNew: () => enterGame(() => (world.startNew(), true)),
    onContinue: () => enterGame(() => world.continueGame()),
  },
  () => world.hasSave(),
);

// 后台预热 BGM（下载+解码）：把首曲的网络等待挪到按键之前，PRESS ANY KEY 兼任加载画面
audio.prewarm();

// 开机停在 PRESS ANY KEY：任意键/点击 = 起播标题曲 + 过场进标题（音频挂在这次手势上）
addEventListener("pointerdown", () => {
  audio.ensure();
  audio.setTrack(mode === "game" ? "game" : "title");
  title.anyKey();
});

function enterGame(start: () => boolean): void {
  if (!start()) return;
  mode = "game";
  if (debugRoom) world.debugGoto(debugRoom);
  audio.startAmbient();
  audio.setTrack("game");
}

// 音频必须挂在用户手势上；顺带处理全局键与调试键。
addEventListener("keydown", (e) => {
  audio.ensure();
  // 标题曲随这次手势响起（开机门/进井/退出由 title.anyKey、enterGame 与 onExitToTitle 处切换）
  audio.setTrack(mode === "game" ? "game" : "title");
  title.anyKey();
  if (e.repeat) return;
  if (e.code === "KeyM") {
    audio.toggleMute();
    return;
  }
  if (mode === "game" && world) {
    if (debug && e.code === "BracketLeft") world.debugTeleport(-1);
    if (debug && e.code === "BracketRight") world.debugTeleport(1);
    if (debug && e.code === "KeyG") world.debugGrantAll();
    if (e.code === "KeyT" && world.paused) {
      world.saveGame();
      mode = "title";
      title.reset();
      audio.setTrack("title");
    }
  }
});

startLoop(ctx, {
  update() {
    input.update();
    if (mode === "title") title.update();
    else world.update();
  },
  render(c) {
    if (mode === "title") title.draw(c);
    else world.draw(c);
  },
});
