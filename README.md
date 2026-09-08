# Plant Well

致敬 [Animal Well](https://www.animalwell.com/) 的横版探索解谜游戏：坠入一口被植物重新占领的古井，靠道具的隐藏用法发现层层秘密。零依赖自研 Canvas 微引擎，同时是一个游戏开发学习项目——每个里程碑配套讲解文档（`docs/learn/`）。

设计词汇表见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr/](./docs/adr/)，**开发日志与交接指引见 [docs/HANDOFF.md](./docs/HANDOFF.md)**（顶部有长期有效的工作规矩）。

![井底巨花](docs/screenshots/14-14-bottom.png)

## 运行

```bash
npm install
npm run dev        # 游戏（vite，默认 5173）
npm run dev:editor # 地图编辑器（打开 editor.html）
npm run build      # 类型检查 + 产线构建，输出到 dist/
npm run preview    # 本地预览构建产物
npm run test:rooms # 地图数据校验（房间 id/边界形状/物件引用/绑定对称/附着层）
```

部署是纯静态的：`npm run build` 后 `npm run deploy`（wrangler → Cloudflare Pages）；push 到 GitHub 也会经 pre-push hook 自动部署。

## 操作（可在标题 KEYS 里改键）

| 动作 | 主键位 | 备用键位 |
| ---- | ------ | -------- |
| 移动 | WASD | 方向键 |
| 跳跃 | K | Z |
| 使用道具 | J | X |
| 切换道具 | L | |
| 直选道具 | 1 / 2 / 3 / 4 | |
| 确认 | Enter / J | |
| 地图 | Tab（Q/E 缩放、WASD 平移） | |
| 下穿单向平台 / 存档花旁开传送 | S | |
| 暂停 | Esc | |
| 静音 | M | |

调试模式 `?debug=1`：`[` `]` 在房间间传送，`G` 发放全部道具与源种；`?debug=1&room=R12` 可直达指定房间（房间 id）。

## 玩法

- **多地图世界**：引擎支持任意多张地图（`src/data/maps/*.json`），游戏加载哪张由 `gameMap.json` 指针决定（编辑器「★ 设为游戏地图」）。房间以 Rxx id 唯一标识，网格坐标只是位置。
- **无缝换房**：房间=大地图上的"视角"。角色中心点越出房界即切视角，坐标按房差平移，动量/骑乘/抛物线零干预延续；房界对碰撞做**缝合**——邻房是岩的地方就是墙，开口才是通路。跨房台阶跳等同于房内跳。
- 4 件道具，每件都有表面用法与隐藏用法：
  - **藤鞭**：抽打开路 / **按住蓄力**伸长鞭梢、锁定钩环把角色拉过去起荡（荡的过程中左右泵摆可以越荡越远，摆荡中按跳跃能甩出去）/ 抽打够不到的机关
  - **泡泡荚**：吹出原地漂浮的泡泡、踩住它上升 / 毒雾附近吹出罩身护罩 / **用藤鞭击打漂浮的泡泡也能触发护罩**——罩身后按住方向会水平飞行，跳跃键跳出
  - **孢子笛**：让休眠花苞开成平台 / 安抚敌对的孢子游魂
  - **蔓豆**：长按使用键在脚下扎根，方向键指挥四向生长成可攀爬的藤茎
- 10 颗隐藏的**源种**，集齐后井底巨花才会为你开放——没人告诉你这件事
- **三格血**与**存档花**：尖刺/游魂掉血；在存档花旁按使用键激活（回满血+设为重生点）；血尽回到最近激活的花；已激活的花之间可以打开地图互相传送
- **机关系统**：开关/压力板 →（多对多绑定）→ 门/电梯/睡莲平台；猪笼草电梯支持跨房单程（可被开关遥控），到站状态跨房持久
- **黑幕（附着类）**：编辑器往"附着层"涂 `@`，与底下地形独立、可叠在岩壁/物件上不取代它们；连通的黑幕算一块——不在其中时整块漆黑，进入后该块显形、**其余世界全黑**，边缘羽化柔过渡
- **冰块（`*`）**：走上去更快、松手惯性滑行，可反向刹车
- **岩壁深度光影**：岩壁按"离空气的距离"微微渐暗，洞窟有了进深
- 场景类（花/草/树/巨花等）颜色会向**房间配色**（roomColor）轻微倾向

## 地图编辑器

`npm run dev:editor`（本地全功能）；线上 [plant-well.pages.dev/editor](https://plant-well.pages.dev/editor) 是查看器——可浏览与导出 .json（保存写回仅限本地 dev）。

- **多图管理**：新建/删除/重命名地图、切换编辑图、「★ 设为游戏地图」
- **房间**：点井图空位建房（自动分配 Rxx id）；下拉/翻房/井图高亮导航；**选点设出生点**
- **调色板分类**：建筑（岩壁/空气/冰块）、**附着类**（黑幕+清除附着——独立层，不取代底下内容）、开关、场景（花/草多品种）、光源、平台、道具、伤害、生命、触发
- **绑定**：开关/压力板 ↔ 门/电梯/睡莲双向点选绑定
- **房间配色**：发光苔藓与场景物件的倾向色
- **校验**：实时（编辑器内）+ 命令行 `test:rooms`（同源规则）
- **保存写回**：本地 dev 经 vite 中间件直接写 `src/data/*.json`，带 If-Match 哈希护栏（旧页面盖不掉新文件）；支持导入/导出单图 JSON

## 地图数据格式

一张图一个 JSON（`src/data/maps/<id>.json`），编辑器保存/导入导出/游戏读取三方同构：

```jsonc
{
  "kind": "plantwell-map",
  "version": 1,
  "id": "M01", "name": "古井",
  "spawn": { "room": "R01", "x": 160, "y": 90 },   // room = 房间 id
  "rooms": [{
    "id": "R01", "x": 0, "y": 0,                    // 网格坐标（邻接/相机用）
    "map": ["################################", ...],  // 18 行 × 32 列：# 岩壁 / . 空气 / * 冰块
    "attach": ["                                ", ...],// 附着层（可选）：@ 黑幕，空格=无——与瓦片层独立
    "objects": [{ "type": "elevator", "id": "AB12CD", "location": { "room_id": "R01", "x": 5, "y": 13 }, "...": "..." }],
    "lights": [{ "x": 160, "y": 20, "r": 60 }],
    "roomColor": "#febcd3"
  }]
}
```

## 结构

```
src/
  engine/   自研微引擎：循环、输入、瓦片、光照、粒子、程序音频、像素字体
  game/     游戏本体：玩家、实体、世界（换房/缝合/黑幕）、装饰、标题
  editor/   地图编辑器：doc（文档/撤销/校验）、palette、render、exporter、dataBridge（HMR 边界）
  data/     maps/<id>.json（一张图一个文件）+ gameMap.json（游戏图指针）
            + maps.ts（类型/装载归一/派生索引）+ 材质与自定义物件
scripts/    validate-rooms.ts（数据校验）
            cdp-verify-fix.mjs + testmap.mjs（T90 专用图确定性步进回归，23 项）
            release-audit-probe.mjs（上线审查）+ 其余专项探针（见 docs/HANDOFF.md）
docs/
  HANDOFF.md  开发日志（逐批）+ 工作规矩 + 交接指引
  adr/        架构决策记录
  learn/      每个里程碑的"为什么这么设计"讲解
  screenshots/
```

## 测试

- `npm run test:rooms`：纯数据校验（Node 直读 JSON），提交前跑
- `node scripts/cdp-verify-fix.mjs`：无头浏览器回归（换房连续性/缝合挡墙/电梯/冰面/黑幕显形像素级断言），跑在程序化生成的 T90 测试图上，与用户地图完全解耦、自动恢复现场；**需要 dev server 在 5199 端口**
- ⚠ 协作纪律（详见 HANDOFF 顶部）：**未经用户明确要求，不要自行运行任何探针/测试**——探针会切地图指针，导致正在编辑的编辑器整页刷新

## 里程碑

- [x] M0 脚手架：游戏循环、输入系统（含改键）、像素缩放 → [讲解](docs/learn/m0-game-loop-and-input.md)
- [x] M1 走跳手感 + 瓦片碰撞 → [讲解](docs/learn/m1-platformer-feel.md)
- [x] M2 井的地图结构：14 房间互锁、回程路线 → [讲解](docs/learn/m2-world-and-rooms.md)
- [x] M3 道具系统 + 藤鞭三用法 → [讲解](docs/learn/m3-items-and-whip.md)
- [x] M4 泡泡荚 + 孢子笛 → [讲解](docs/learn/m4-bubble-and-flute.md)
- [x] M5 动态光照 + 程序音频 → [讲解](docs/learn/m5-light-and-audio.md)
- [x] M6 源种、巨花结局、标题/存档/改键 → [讲解](docs/learn/m6-save-title-ending.md)
- [x] M7+ 地图编辑器、多地图、连续世界换房、附着类黑幕——见 [docs/HANDOFF.md](./docs/HANDOFF.md) 逐批记录
