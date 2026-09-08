# HANDOFF — Plant Well 项目交接（compact 后从这里继续）

> **工作规矩（用户原话，长期有效，compact 后也必须遵守）**：
> 1. 用户说"commit" = **commit + push 都要执行**（push 会经 pre-push hook 自动部署到 Cloudflare Pages）；只提交不推是不完整的。
> 2. **禁止自行运行测试/探针**。只有用户明确说"测试/跑一下探针"时才跑。曾因 compact 忘记此规矩被用户批评多次。
>    - 自动化回归套件 = `scripts/cdp-verify-fix.mjs`（T90 测试图）——仅在被要求时运行。
>    - 所有探针已与用户的 M01/M02 解耦（T90 专用图 + withTestMap 自动恢复），但"解耦"不等于"可以随便跑"。

## 交接指引（给下一个会话，2026-09-08 更新）

**项目现状**：核心玩法切片完整可通关；世界=多地图（M01 初版井 / M02 用户在活跃编辑的第二张图），游戏图由 `gameMap.json` 指针决定。架构=零依赖 TS + Vite Canvas 微引擎，60Hz 确定性逻辑。

**接手前必读**：
- `README.md`（运行/操作/玩法/编辑器/数据格式/测试全景，本批刚重写，是最新的）
- 本文件顶部的**工作规矩**（两条，违反会被用户批评）+ 下面的逐批开发日志（最新的在最上）
- `CONTEXT.md` 设计词汇表（改术语必须同步它）

**改代码时的关键锚点**（细节见对应批次记录）：
- 换房/缝合/落点：`src/game/world.ts` `checkTransitions/completeRoomSwap/tileAtWithSeam/resolveEmbed`——**连续世界模型**（第四十/四十二批），换房=纯坐标平移切视角，任何"就近搬迁/吸附"都是回归
- 黑幕附着层：数据 `RoomDef.attach`（maps.ts 归一）；渲染 `drawVoid/buildVoidMasks`——离屏羽化遮罩，**主画布禁用 destination-out**（会把场景擦穿=全黑 bug）
- 编辑器：`src/editor/doc.ts`（文档/撤销/校验）是数据真身，`dataBridge.ts` 是 HMR 边界（保存不刷新编辑器页）；`exporter.ts` 序列化三方同构（保存=导入导出=游戏读取）
- 探针基建：`scripts/testmap.mjs` 的 `withTestMap()`（写 T90→跑→自动恢复），新回归一律挂 T90、走确定性步进（rAF 在无头下会停摆，别用真实时间）

**已知未结事项**：老 M01 内容探针（softlock/whip-pull/escape/feature-batch/elevator-cross 等）仍是旧 fixtures，与用户改图冲突报红灯——按需人工验收或迁 T90，**不是代码回归**；`release-audit-probe.mjs` 已迁 T90 版但从未跑过（等用户要求）。

**用户在活跃编辑 M02**：`gameMap.json`（指针）和 `M02.json` 的工作区改动**永远不要提交**，除非用户明说。

> 最后更新：2026-09-08（**第四十七批：四连 bug 修复/诊断**——细黑幕发透明=blur 单次叠涂不足，已叠 3 次；苔藓长在贴邻房岩壁的面上+草从冰下长出=暴露面判定不缝合/不认冰块，已改 `open()`；冰面滑行不对称=**跑道效应非 bug**（详见第四十七批）。README 按用户要求**暂时清空**——上一版完整 README 在 git 历史 `bace3dc`，恢复时直接从那里取。详见下文第四十七批。)

## ⚠ 第四十七批（2026-09-08）：四连反馈修复/诊断（细黑幕透明 / 苔藓越缝 / 草在冰下 / 冰面滑行不对称）

用户四连反馈的处置（前两个修代码，第三个修代码，第四个探针实测后定性为非 bug）：

1. **1×N 细黑幕块发透明**：`buildVoidMasks` 单次 blur(5) 下，10px 宽细条的中心距两边各 5px，alpha 只有 ~74%——看起来半透明。修复：同一路径**叠涂 3 次**（`for 3: g.fill()`，同 blur 同路径 source-over 累积），细枝核心 ≈98%+、厚核全实，羽化过渡不变。F6 断言实测仍绿（near 118→~215，阈值 <230 内）。
2. **发光苔藓长在"贴着邻房岩壁"的外缘岩壁上**：decor 暴露面判定 `tiles.get(...) !== Tile.Solid`——Tilemap 越界一律返回 Air，房间外缘永远算"暴露"。修复：`RoomDecor` 构造器加 `seamSolid` 回调（world.loadRoom 传入，走 `tileAtWithSeam` 的越界路径翻邻房瓦片），越界面=邻房岩壁 → 不算暴露 → 不长苔藓/草/藤。无邻房边照旧算暴露（保持既有观感）。
3. **冰块贴着岩壁顶，岩壁上还长草**：暴露判定把冰块（非 Solid）当空气。修复：`open()` 改为**暴露=邻格是 `Tile.Air`**（冰块/岩壁都不算暴露）——草/苔藓/芽/灌木都不再从冰块底下长出来。
4. **冰面滑行"不对称"（岩壁→冰滑得远 vs 冰上直接走滑得近）**：`scripts/ice-diag.mjs`（T90 确定性步进，保留备查）实测——两次松手瞬间 **vx 完全相同（80.64）**、冰面衰减率完全相同（ICE_FRICTION 55）；差别在**跑道**：松手后理论滑行 ≈59px，但滑出冰块边界即撞上岩地摩擦（1100，20 倍）急停。A（岩地助跑跨上冰、松手点靠近端）滑 57.1px=全跑道；B（冰上直接走、松手点已靠后）只滑 24.6px=剩余跑道。**结论：跑道效应，物理自洽，非 bug**；若要"滑出冰块还带一点惯性"属新需求再议。
5. **README 暂时清空**（用户明令"暂时改成空白并提交"）——完整版在 git 历史 bace3dc，恢复直接取回。
6. 回归：cdp-verify-fix **23/23**；tsc 干净；探针后 gameMap 已自动还原 M02。

## ⚠ 第四十六批（2026-09-08）：岩壁深度渐暗 + 文档整备（交接准备）

1. **岩壁深度光影（用户需求：越远离空气越暗，微微一层）**：多源 BFS 深度场（源=非岩壁格，4 向逐层渗入）——游戏 `world.ts` 模块级 `buildWallDepth(tiles)`，随 loadRoom 算一次挂 `RoomInst.wallDepth`；`drawTiles` 在斑驳细节之后、暴露沿高光之前叠 `rgba(3,6,9,·)`：深度 2/3/4/≥5 格 → 5%/10%/15%/封顶 18%（LUT `WALL_SHADE`，深度 1 的暴露沿不压保持沿口清晰）。编辑器 `render.ts` `buildWallDepthRows(map)` 同语义实现（编辑器不 import 游戏世界，刻意复制 20 行并注明同源），所见即所得。改强度只动 `WALL_SHADE` 一处（两份，游戏/编辑器）。
2. **README 全面重写**（已严重落后）：补多地图/无缝换房与缝合/机关绑定/黑幕附着类/冰块/深度光影/房间配色等玩法现状；新增「地图编辑器」「地图数据格式」（attach 层语义）「测试」三节；结构树补 `src/editor/` 与 scripts 探针全景；修掉"洞口配对"等已删除规则的描述。
3. **交接指引**：本文件顶部新增「交接指引（给下一个会话）」——现状/必读/代码锚点/未结事项/用户实时数据保护。
4. 本批按规矩**未运行探针**（用户未要求测试本批改动）；上一批结束时全套 23/23 基线仍有效。

## ⚠ 第四十五批（2026-09-07）：新物品类「附着类」落地（黑幕脱离瓦片层）

**用户需求原文要点**：黑幕要让"其他区域不可见"；要能覆盖在岩壁区域而**不取代岩壁**——方法是新增一个**附着类**：可放在场景任何地方、不占空间、遮住区域一切内容（岩壁/空气/其他物品），进入该连通区域才显形，同时其余区域全黑。
**数据模型**（`maps.ts`）：每间房新增 `attach: string[]`（18×32，空格=无，@=黑幕）——**与瓦片层完全独立的附着层**，叠在任何地形/物件之上不改底下内容。`normalizeRoomGeo` 装载归一：旧数据内联在 `map` 里的 @ 自动摘到 attach 层（底下瓦片按空气兜底）+ 补齐形状；游戏侧（`buildVoidRegions` 读 `def.attach`）与编辑器消费同一份干净数据。导出器仅在附着层非空时写 `attach` 字段。
**编辑器**：调色板新增**附着类**类别（在建筑类之后；后续雾等同类物品都进这里）；`@` 从建筑类移入，另加「清除附着」笔（空格，擦附着层不动瓦片）；`paintRaw` 按画笔字符分流到瓦片层/附着层——**画瓦片不再顶掉附着物、涂附着不取代岩壁**；画布渲染：附着遮罩画在瓦片+物件之后（半透明灰+内描边，底下内容隐约可见），房间列表缩略图同样盖灰；状态栏/检查器文案按层显示（顺带修正冰块一直显示"擦成空气"的老文案错误）。
**游戏渲染**（world.ts `drawVoid`，上批已做本批确认）：玩家在某块黑幕区域内 → 整屏涂黑+抠亮所在区域（其余世界全不可见）；不在 → 只涂黑幕格。`@` 已不是瓦片（Tilemap 读空气，Tile.Void 已删）。**显形 bug 修复（用户实测"走进去全屏全黑"）**：原实现用 `destination-out` 在主画布上抠洞——它把**已画好的场景像素一起擦成透明**，透出页面底色仍是一片黑。改为 **clip even-odd**（整屏大矩形减去区域格，clip 内 fillRect），只涂黑、不擦穿。探针加像素级断言：F4 区域内玩家像素可见（bug 态=被擦穿=全 0）/F5 区域外全黑。**边缘柔化（用户要求"边缘不要太尖锐"）**：drawVoid 改为离屏遮罩贴图——`buildVoidMasks` 惰性构建（挂在 RoomInst.voidMasks）：区域形状 `blur(5px)` 羽化后，并集成"全黑版"、再 destination-out 成每区域的"洞版"（destination-out 只作用于离屏黑幕层，主画布场景不受影响）；drawVoid 只 drawImage。羽化后洞边/涂黑边都是渐变过渡；实测该环境 blur 的 σ≈radius（非 CSS 规范的 radius/2），5px≈半格宽过渡。F6 断言遮罩 alpha 剖面（深核≥246/缘外1px 渐变/14px 外全透）。
**校验**：编辑器/Node 校验器都检查 attach 层（18 行×32 列，只认 @ 与空格）；map 内联 @ 降为合法旧格式+警告（建议重存自动迁移）——"一直报非法字符@"根治。
**其他**：vite dev server watch 排除 `.cdpprofile/**`（Chromium 锁 Cookies 文件曾致 EBUSY 崩掉整个 dev server）。T90 黑幕袋改走附着层（cols8-10 rows9-12：上叠岩壁、下压走廊空气），探针加 **F3 附着不取代岩壁** 断言（覆盖格 tiles 仍为实心）。tsc 干净。未运行任何探针（守规矩，待用户指示）。

## ⚠ 第四十三批（2026-09-07）：全面审查 + 一致性清理

1. **命名统一**：`homeKey/originKey`→`homeId/originId`（entities+world，字段持有的是房间 id）；编辑器 `placeCtx` 砍掉冗余 `roomKey`（只留 `roomId`）、`bindPick/dragObj/mouseTile/toWorldTile/tryBind/deleteMulti` 的 key→roomId；`travelList` 键名改 `flagKey`；`nearestLanding` 用 `ROOM_ROWS`。
2. **存档防护**：`readSave` 校验 roomId 有效/坐标为数字，旧档（room 数组）或坏档→当无档处理；spPos/checkpoint 里指向不存在房间的条目剔除（传送地图不再出现死光标）。
3. **validate-rooms.ts 重写**：适配 Rxx（id 键/按图遍历/出生点按 id）；删洞口配对规则（错位洞合法）；新增网格占位重复检查；通关性检查（源种连续/道具齐）限定 ★游戏地图。M01 现状：0 错 3 警告（2 条藤尖插岩视觉穿帮 + R05 一块空 controls 压力板）。
4. 已知红灯（数据漂移，非代码回归）：release-audit 5 败（R04 存档花被挪走/K25B6Y 竖直断言看 off.x）、feature-batch（R12 右缘洞口换位）、whip-pull（尖刺坑+door:13 没了）、elevator-cross（UYDJ26 已删，待改挂 TSTELV/FQ84CK）——全部是旧 fixtures 撞上用户改图，已用 stash 对照排除代码回归。**待办**：这批老探针迁到 T90 或按新地图重摆。

## ⚠ 第四十四批（2026-09-07）："发光苔藓"属性升级为"房间配色"（roomColor）+ 面板黑色 bug 修复

1. **字段改名**：`RoomDef.moss` → `roomColor`（数据/编辑器 RoomRec/导出/校验/decor 读取全链路；M02 里的粉色 `#febcd3` 已随改名迁移保留）。语义升级：**房间配色**——发光苔藓按此色生长（原功能不变），场景类物件（花/草/小树树冠/巨花苞体）颜色向它轻微倾向（`RoomDecor.tint(base, k)`，默认 30%，返回 #rrggbb 可与 shade 组合）。游戏图通关性检查（源种/道具）只对 ★游戏地图生效——用户切到测试图时校验器报缺内容属预期。
2. **面板黑色 bug 根因**：`refreshLights()` 在"房间无固定光源"时提前 return，**房间配色输入框的回显代码在 return 之后永远不执行**——面板冻结在初始黑色（type=color 无值即 #000）。修复：`refreshRoomColor()` 独立函数，在光源列表逻辑之前调用；无指定时回显该房深度的生物群系自动色（与游戏 defaultMoss 同源三档），不再显示死黑。

## ⚠ 第四十二批（2026-09-07）：连续世界换房模型（架构定案）

**用户需求原文要点**：角色状态（电梯中/泡泡上/无绑定）跨房保持；以中心点为判断对象；room 与 room 之间不完全独立——下面的房往上面的房跳台阶必须等同于房内跳台阶；切视角而非世界重启。
**实现**（world.ts）：
- `checkTransitions`：中心点 `p.x/p.y` 越出 [0,W]×[0,H] 即排队 `fade={swap:true}`（无 ±4 门槛）；黑透前折返（中心回房内）→ fade=null 取消；无邻房 → 钳回（双保险）。
- `completeRoomSwap`：黑透时按**当刻**越界方向定目标（斜向两轴都越=斜邻房，不存在则取消）；`p.x += (from.x-to.x)*ROOM_W`（y 同理）纯平移；骑泡 rider 同平移并入新房实体表；`embeddedAt` 兜底（仅“被无视碰撞的状态带进岩壁”才触发 resolveEmbed 全房择址）。
- `fade` 结构：`{t, phase, dur?, swap?, travel?{nid,nx,ny}}`——边界越界用 swap，存档花传送用 travel（目标写死）。update 的 fade 分支按语义分流。
- `resolveEmbed` 回归单一职责：仅 embeddedAt 兜底（nearestLanding 全房分级扫描），fromBelow/groundBelow 已删。
- **出舱赠跳**：player.exitJump（entities.ts 吐出处置 true；player.ts 跳跃条件 `coyote>0 || exitJump`，落地清零）。
**编辑器**：选点设出生点（spawnPick 模式：armed 时画布点击=setSpawnRoom+setSpawnPos，Esc 取消）。
**探针**：`scripts/testmap.mjs`（T90：R91 走廊+竖井+右开口、R92 对齐走廊+savepoint、R93 高腔体+底开口；电梯 TSTELV R91→R92）+ `cdp-verify-fix.mjs` 14 项。**测试纪律（用户明令）**：以后测试一律用 T90 这类专用图，不依赖 M01（用户会随时改 M01）。**⚠ 探针会写 gameMap.json → 用户正在编辑的编辑器会整页刷新丢未保存内容——用户可能在实时编辑，跑探针前先确认（或跑完提醒用户刷新/检查未保存标记）。

## ⚠ 第四十一批（2026-09-06）：房间标识全面 Rxx 化 + 五项体验需求

1. **Rxx 统一标识（用户明令：所有 m,n 全部取代）**：`ROOMS` 以房间 id（Rxx）为键；新增 `ROOM_ID_BY_POS`（网格坐标→id，换房/邻接用）与 `ROOM_POS`（id→坐标，相机/世界偏移用）；删除 `ROOM_KEY_BY_ID`。世界持有 `roomId` 为唯一标识，`cx/cy` 降级为它的坐标投影。存档格式：`room:[m,n]`→`roomId:"R12"`，checkpoint/spPos 同改（**旧存档不兼容**，符合用户"不要兼容旧的"规矩）；flags（seen:/sp:）键变 Rxx。编辑器：`MapRec.rooms` 改 id 键 + `RoomRec` 增 x/y 字段、`idOrder` 取代 keyOrder、序列化/导入/校验/井图/下拉/状态栏全走 id；手输坐标建房输入框已删（点井图空位建房，id 自动分配 R01 起增加）。**负坐标审视结论**：房号全程字符串键+min 归一化+线性算术，负坐标安全（用户原假设排除）。
2. **换房阈值收紧** ±6→±4（后被四十二批连续世界模型取代——现在中心点过界即触发）。
3. **校验器删"洞口配对"规则**：错位洞口（右上阶梯跨房）是合法设计（用户明令）；边缘徽章三色：绿=贯通/灰=被邻房岩封（缝合后即墙）/红=无邻房会漏。
4. **传送地图 pan 符号反转 bug**：跟随带修正量写反（越界越拉越远）→ 全部 `+=`；低倍缩放 pan=0 从不暴露、放大才见。
5. **编辑器邻房操作不瞬移视角**：新增 `switchWorkRoom`（切工作房+井图高亮，镜头不动）；画笔/矩形/框选/拖物件用它，显式导航（下拉/翻房/点井图/建房）仍走 gotoRoom 居中。

## ⚠ 第四十批（2026-09-06）：跨房"视角不跟"根因已修（CDP 实录定性）

**用户症状**：从 (2,0)R12 走进手建新房（(3,0)R21 / (2,-1)R22），"角色明明已在另一个房间，视角还停在当前房间"。无头探针此前验证换房链路数学全对，一直无法复现——**因为这不是换房逻辑的错，是换房之后落点解算的错**。
**CDP 实录因果链**（`.cdp-trace.round1.jsonl`，712+ 样本）：R22 底洞(px200-249) 与 R12 顶洞(px200-219) 错位 → 用户从 x≈232 下落 → 换房正常触发、视角正常切到 (2,0) → 但入口点 (231.79,7) 嵌在 R12 顶壁实心里 → `resolveEmbed` 四向扩张搜索**无边界钳制**且第一方向是正上 → 探到 y=-5 时探测点已全在房外，`Tiles.get` 越界一律返回 Air → 返回 (231.79,**-5**) → 人被钉在世界顶部房界外（trace 尾 2700+ 样本 py 冻结在 -4.01）→ 角色不可见、不能动，看起来就是"人在隔壁房、视角没换"。
**修复（终版，四轮迭代，两支柱）**：
①**房界缝合（核心）**：`solidAtPx`/`climbSolidAtPx` 对越界查询翻查邻房边缘瓦片（`seamCache` 按房键缓存 Tilemap，界内查询零开销）。旧物理只查本房——**房界对碰撞是空气**，邻房是岩也能跳穿边界钻进它的岩石/洞口，这是一切"视角不跟/掉回原房间/跳到错误位置"的总根源（用户最初怀疑负坐标，审视结论：房号全程字符串键+min 归一化+线性相机，负坐标安全）。缝合后：邻房是岩的地方房界就是墙（跳头撞线落回，"蓝圈起跳应落粉圈"成立），邻房开口才是通路；R22 竖井底 cols23-24 因 R12 顶行是岩而自然成为"站在缝上"的凹龛。
②**resolveEmbed 分级择址**：嵌体（换房落进岩壁/电梯投进石壁）全房逐格扫，候选分级 0=原地可站（含站在缝上）/1=正下方有实心/2=贯通（罚 1e9 只作兜底），1 级罚 150px 等效距离；**fromBelow 防回坠**（从房底钻入 ny≥H-8 且脚下直通房底＝骑着来时的洞，攀爬越界无动量会永远掉回去）：钳 90px 找 0/1 级立足点拉上去，找不到（纯烟囱）保持原位动量自然延续，绝不长距离挪人。
**验证**：`scripts/cdp-verify-fix.mjs`（节流鲁棒版）28 项——A：对齐列 col21 下坠贯通落 (2,0)、岩壁阴影列 col23 缝住站 (2,-1)；C1：R13→R12 物理上跳（爬楼路径）站稳 (2,0)；C2：R12→R22 上跳稳定收场；B：debugGoto 全 22 房（带一次重试吸收用户按键/节流抖动）。**CDP 测试坑**：Edge 窗口不在前台时 rAF 停摆（冻结帧/黑场卡 1s/悬空"稳定"帧）；用户可能在采样窗口里操作游戏——探针要 liveness 校验 + 重试，偶发单失败别当回归。
**CDP 工作流**（可复用）：Edge `--remote-debugging-port=9223 --user-data-dir=<项目外目录>` 起窗（**档案不能放项目里**——vite watcher 会撞 Edge 锁住的 Cookies 文件 EBUSY 崩溃），`?debug=1` 暴露 `__pw`；`scripts/cdp-watch.mjs` 后台常驻采样（16ms：cx/cy/cam/player/fade/keys/帧节奏/visibility，房间·换场事件即时打 stdout）。内置浏览器（GameViewer WebView2）无调试口，附不上去，只能自起等效窗口。
**注意**：R22(2,-1)/R21(3,0) 是用户手建的 0 物件房（无光源，全黑）；R12↔R22 洞口错位本身是数据问题，游戏侧已能优雅处理（落回洞内最近空位）。
**已知红灯（非回归）**：`elevator-cross-probe` 现为 11过/10败——它整套断言建立在 UYDJ26（R12→R05 横向跨房）上，而用户已把 UYDJ26 删掉（当前图里电梯=PT7DJE/K25B6Y 同房 + FQ84CK 跨房 R15→R14 back=true 触发器 MDUWGX）。stash 对照实测：修复前后同为 11/10，纯数据漂移。**待办**：把探针改挂 FQ84CK（endShift.y=-180，vertical）恢复绿灯；未做前勿当回归处理。

## 一、项目是什么

**Plant Well**：致敬 Animal Well 的横版探索解谜游戏（垂直切片已完成可通关），同时是游戏开发学习项目。零依赖 TypeScript + Vite 自研 Canvas 微引擎。320×180 内部分辨率、10px 瓦片、**20 个一屏大小的房间**组成"井"（含坠井捷径、蹦菇塔、悬圃、蔓豆石窟、西苔洞、井底东窟），固定 60Hz 确定性逻辑。整体视觉阴森化：黑暗曲线加深（0.34+0.54×深度）、漂移雾团、晕影加重、调色板压暗、玩家灯光烛火闪烁。

- 设计词汇表：`CONTEXT.md`（井/源种/根台/护罩等，改动术语必须同步它）
- 架构决策：`docs/adr/0001-self-built-canvas-microengine.md`、`docs/adr/0002-music-8bit-converted-assets.md`
- 里程碑讲解（m0–m8，含真实 bug 复盘）：`docs/learn/`
- 本文件：`docs/HANDOFF.md`

**用户是学习者**：协作模式是"讲解式"——每个里程碑要有配套的"为什么这么设计"讲解文档（`docs/learn/mN-*.md`，中文），代码注释解释约束而非流水账。

## 二、常用命令

```bash
npm run dev          # 开发服务器（默认 5173，测试脚本假定 5199：npx vite --port 5199 --force）
npm run build        # tsc --noEmit + vite build（产线静态包 dist/）
npm run test:rooms   # 房间地图校验（洞口配对/物件引用）
npm run test:softlock # 软锁回归（7 竖井攀回 + 鞭子强制拾取）
npm run test:e2e     # 无头浏览器全流程（通关到结局）
npm run test:music   # BGM 曲目切换（标题曲/游戏曲/退回标题）
npm run test:vine    # 藤蔓丛（摇摆/护罩破裂/护罩路线不受干扰）
npm run test:content # 内容扩展（蔓豆链条生长/攀爬/蹦菇/地图/20房巡检/迁移源种）
npm run test:batch   # 第八批特性（跳转保速/骑泡跨房/游魂退避/小树/刺泡/脆弱门/地图缩放平移）
npm run test:chain   # 荡索室挂环/泵摆/安全脱手（确定性断言；全链连招由玩家实测）
npm run dev:editor   # 打开地图编辑器（/editor.html，仅开发期工具，不进 dist）
npm run convert:music# src/assets/*.mp3 → 8-bit 化 WAV（响度归一→限带宽→16k→8bit，换曲重跑）
node scripts/bubble-shield-test.mjs   # 泡泡三用法
node scripts/whip-pull-test.mjs       # 藤鞭螺旋扫击挂钩 + 荡坑 + 机关命中
node scripts/room-cross-test.mjs      # (1,1)→(0,1) 跨房
node scripts/use-buffer-test.mjs      # K 预输入
node scripts/escape-test.mjs         # (1,4) 无笛子逃生路线
node scripts/shots-only.mjs           # 14 房间截图到 D:/tmp/pw-shots
```

浏览器测试前置：dev 服务器已启动 + 本机 Edge（`channel: "msedge"`）。**服务器用后台任务方式启动会随会话结束而死，重启用 `npx vite --port 5199 --force`。**

调试模式 `?debug=1`：`[` `]` 逐房间传送、`G` 发放全部道具+10 源种、暴露 `window.__pw = { world, input, mode }`（所有自动化测试都靠它）；HUD 左上角**常显当前房间代号**（如 `2,0`，配合编辑器/传送调试）。原 debug 光照滑杆面板已按用户要求移除（`debugLighting.ts` 现在只从 localStorage 应用此前调好的 sceneDark/playerGlow，无 UI；World 默认 sceneDark=0.82 是用户定值，别动）。

**默认键位（第九批起）**：**K/Z=跳跃、J/X=使用道具**（原 J/K 对调）、L 切道具、Tab 地图、Q/E 地图缩放、S=站单向平台下穿。开机先停在 **PRESS ANY KEY** 页：任意键/点击起播标题曲+过场进菜单——**测试引导要按两次 Enter**（过门 + 菜单确认，中间 ≥0.9s 吞键窗）。注意：localStorage `plantwell.bindings.v1` 存有旧改键的话会盖掉新默认。

## 三、架构地图（改哪里去哪个文件）

```
src/engine/
  loop.ts      固定 60Hz 累加器循环（MAX_FRAME_TIME 螺旋防护）；Scene={update,render}
  input.ts     动作映射输入：事件排队→逻辑步开头结算；rebind+captureNext（改键 UI）；
               queueLength()（测试用）；持久化 localStorage plantwell.bindings.v1
  display.ts   320×180、整数倍缩放
  tiles.ts     Tilemap；出界=Air（房间靠数据边界封闭，validate-rooms 保证）
  particles.ts 粒子池（上限 320）
  light.ts     光照：离屏画布 destination-out 抠洞；光源列表每帧收集（坐标=世界系！）
  audio.ts     SFX/环境音程序合成（tone/noise 原语、低鸣+水滴）；BGM=8-bit 化真曲 WAV 循环
               （setTrack("title"/"game")，src/assets/music/*.wav 由 convert:music 转出，
               曲目经 musicGain 0.5 → master；**开机 prewarm 预下载+解码，曲目缓存 IndexedDB（刷新零网络请求）；加载失败即静音（兜底音序器已删——与真曲叠播）**）、音量持久化 VOL_KEY、M 静音
  pixfont.ts   3×5 像素字体（标题/菜单/HUD 专用，游戏内无文字）
src/game/
  player.ts    物理（跳 224/重力 980 → 2.5 格顶点）、摆荡、护罩飞行、藤鞭螺旋扫击挂钩
               （whipSegs 扇面子段=判定）、真实 vy/vx 同步（摆荡中也是！——这是修过的 bug，别再弄丢）、
               dropT（按 S 下穿单向平台）、藤鞭旋向=朝向（右顺时针/左逆时针，起手向上，挥舞中变向不翻转）
  entities.ts  Pickup/Ring/Switch/PressurePlate（压力板：踩上永久 openDoor(target)）/Door(可带 fragile 脆弱侧、
               开门=整扇沉入地底动画 openT)/VineBud/Bud/SporeCloud/Wisp/Flower/Bubble/Ledge/HangingVine/
               BounceShroom（蹦菇：非实心、下落穿帽即弹）/VineStalk（蔓豆茎：链条生长+四向攀爬）/
               SmallTree（小树：灭泡泡、不碰茎）
               （HangingVine=天花板藤蔓丛：摇摆+护罩破裂+刺破漂浮泡泡；Bubble.doom=被顶替后的 0.5s 倒计时；
               Entity.popsBubbles?()=会刺破漂浮泡泡的物体统一接口，Bubble.update 统一扫描）
  world.ts     房间装载、跳转保速转换（水平转 y 不变/垂直转 x 不变+resolveEmbed 就近脱困+骑泡跨房携带）、
               危险判定、道具分派（蔓豆独立长按状态机 updateBean）、光照合成、HUD、
               **地图系统**（Tab 开关：全局连续地形图 buildWorldMap 1px/格，当前房居中，QE 缩放 WASD 平移，
               无房间框）、存档（flags/seeds/items 三集合=唯一事实源）、结局两段式、暂停、repelToEntry（游魂退避）
  title.ts     标题（**PRESS ANY KEY 开机门 → 过场渐显** / NEW/CONTINUE/KEYS）+ 改键 + VOLUME 行（左右调节）
  decor.ts     房间装饰（种子确定性）：视差背景/草簇/**土中藤芽（每房默认生成的卷须嫩叶）**/**灌木簇（路过摇摆）**/
               根须/裂缝/背景植物/3 生物群系调色板/暗角；update(dt, particles, px, py) 传玩家坐标触发植被摇摆
  constants.ts ★ 所有物理与机制调参数值都在这里
src/data/maps.ts     地图类型定义（MapDef/RoomDef/ObjDef…）+ 派生索引（import.meta.glob 收集 maps/*.json →
                     MAP_LIST/GAME_MAP/ROOMS/ROOM_KEY_BY_ID/BINDING_KIND/SPAWN/SEED_TOTAL）。手写维护，编辑器不碰
src/data/gameMap.json     游戏采用哪张图：{"gameMapId":"M01"}（编辑器「★」按钮写）
src/data/maps/M01.json    一张图一个 JSON 文件（=编辑器导入/导出的同一格式；当前只有 M01"古井"20 房）
scripts/            校验器 + 全部浏览器回归测试
docs/learn/         m0–m8 讲解文档（每里程碑一篇，含练习题）
```

## 四、当前机制与关键数值（constants.ts 为准）

- **跳跃**：JUMP_VEL 224 / GRAVITY 980 → 顶点 25.6px ≈ 2.5 格；土狼 0.08s；跳跃缓冲 0.1s；松键短跳 JUMP_CUT
- **使用键预输入** USE_BUFFER 0.15s：转换/死亡期间按 K 不丢失（死亡期间缓冲不衰减）
- **毒孢子**：伤害**无视无敌帧**（封"复活冲刺穿云"漏洞）；护罩触发=玩家盒与云矩形**相交**（贴云边可触发）；安全点拒绝记录在云边
- **泡泡荚**（L 循环顺序：鞭→泡→笛）：J 吹出**原地漂浮**泡泡（寿命 8s，生成 y-6、头顶有实心则退回 y-4）；**踩住才上升**（16px/s，不踩不动）；**顶着天花板上升会在玩家头部触顶前卡停**（头部空间探测，防"把玩家直接写进天花板→碰撞弹到房间外"）；**藤鞭击打泡泡 → 罩身护罩**；毒雾附近吹 → 直接罩身；护罩=重力关闭 + **首次横向输入定方向匀速飞行**（55px/s，撞墙停，时长 2.5s 到点自动破裂，云内破裂=受伤），**K 跳出**；**一井一泡**：召唤新泡泡后旧泡泡 0.5s（BUBBLE_DOOM）破裂，骑在上面也照破
- **藤蔓丛**（HangingVine，数据 `vine{ location, h, lens?, hMin? }`：location=悬挂起始空气格、宽 2 格、垂 h 格；lens 条数=根数（游戏取前 6 条），显式值=该条实际长度（**忽略 h 上限**），**0 或 -1=在 [hMin,h] 随机**——第廿八批起 0 不再钳为 1）：非实心、走过无伤；玩家判定盒外扩 6/8px 与之相交 → 摇摆 0.55s；**罩身状态蹭到判定区 → 护罩就地破裂**（毒雾内破=顺势受伤）。摆放铁律见 §五
- **藤鞭（v3.1 持续旋转）**：**按住 J 一直转**（旋转方向跟朝向：朝右=屏幕顺时针、朝左=逆时针，起手向上，挥舞中变向不翻转——方向只在 startWhip 定一次）（恒速 WHIP_SPIN_RATE 16 rad/s，向上起手），鞭长从 WHIP_START_LEN 10 在 **WHIP_GROW_TIME 3s 内线性**长到最长 WHIP_SWEEP_REACH（=屏宽一半 160）并保持；**松开即收，再按从初始长度重长**（startWhip 重置 whipT）；受击/罩身/挂钩也会收鞭。**整段鞭身=判定**：本步扇面切 ≤0.08rad 子段（`whipSegs`+`whipPrevT` 续扫防漏检），打击走 `w.whipHits`（segRectHit+隔墙采样），**鞭身任何一处扫过钩环（segPointDist≤RING_GRAB_RADIUS 6，隔墙不钩）→ 立刻 startPull**（240px/s 拖到环下）→ 起摆 ω0=接近方向×2.2；**摆荡**：单摆 L=18 固定，泵摆**仅顺摆向做功**（ω·pump>0 才 +3.2dt），**ω 上限 SWING_OMEGA_MAX=9**（切向≈162px/s，能荡得飞快）；**摆荡中按 J = 陆地起跳**：vy=−JUMP_VEL 完整跳高 + 切向动量全额保留（vx=ωL·cosθ×1.3）——荡得越快甩得越远；**摆荡中必须维护 vx/vy**（其他系统在读它们）
- **房间转换（保速版）**：阈值 x<−4 / >ROOM_W+4、y<−6 / >ROOM_H+6；**水平转只改 x（换边）、y 保持；垂直转只改 y、x 保持；vx/vy/朝向一律不动**（同一抛物线的延续）；落点嵌实心时 resolveEmbed 按"上/下/左/右由近及远"找空位（不变轴优先保持）；**骑着的泡泡跟人跨房**（world.riddenBubble() 找 carrying 泡泡，按玩家位移平移后 push 进新房间实体表——寿命/破裂倒计时是同一对象，天然不重置）；护罩（shieldT 在玩家身上）跨房天然延续；Tilemap 出界=Air（边缘封闭由 validate-rooms 静态保证）
- **脆弱门（side-aware 破门）**：door 物件可带 `fragile: "left"|"right"` 与 `dir: "v"|"h"`（收门方向：v=沉入地底默认；h=缩向较近的侧墙，(2,3) 荆棘门即 h）——鞭子**从脆弱侧**抽到门上才破（openDoor 同机关路径），另一侧只有火星反馈；(1,3) 的荆棘门 "13" = fragile:"right"，从 (2,3) 侧**隔界抽断**（world.update 跨房扫描：邻房贴边 fragile 门平移 ±ROOM_W 进当前系做 segRectHit+lineBlocked+脆弱侧判断，boundaryDoorHit 去重）；机关开门路径不变
- **游魂退避**：未安抚游魂碰身（≤7px、非安抚态）→ `world.repelToEntry()`：**不掉命**，瞬移回本房入口（entryX/entryY：startNew/continueGame/跨房落地/debugTeleport 时记录）+ 1.5s 无敌 + 紫光粒子；受击/退避都会顺带结束蔓豆生长态
- **小树（SmallTree，数据 `tree{x,y}`：(x,y)=树基空气格，下一格须实心）**：**树高默认 2~5 格按坐标种子确定性随机，数据可用 `h` 显式指定（钳位 2~10）**（同树同形；冠宽/干粗随高变化），非实心装饰；**罩身蹭到树冠就地破**（与藤蔓同规则）+ **popsBubbles 刺破漂浮泡泡**；**对蔓豆茎零影响**（茎可贴着长、穿过爬）。现布点：(2,0)(1,1)(0,2)(3,3)(2,4)(3,1)×2(1,5)(1,6)(4,3)
- **场景刺泡**：藤蔓丛/小树/蹦菇帽都实现 `popsBubbles()`（各自判定矩形），Bubble.update 统一扫描重叠即爆——骑泡撞藤蔓/树/菇会破，是设计行为不是 bug
- **存档**：localStorage `plantwell.save.v1`（房间+位置+items+active+seeds+flags）；结局后清除
- **道具拾取半径**：默认 8；**鞭子 24**（(1,0) 的鞭子在必经之路上，杜绝跳过=软锁）
- **地图（全局地形视野版）**：Tab 开关；`buildWorldMap()` 把**到访过的房间**（`seen:<cx,cy>` flags）按 1px/格 烙进**一张连续地形图**（无房间间隙、无房间框、无绿框——"当前房居中"就是所在标识；mapDirty 增量重画，未到访=纯黑）；**QE 缩放**（mapZoom 1..4，E 大 Q 小）、**WASD/方向键平移**（updateMapView，视野钳在世界内，整图装得下时自动居中）；玩家金色光点闪烁；巨花房金芽标记。zoomIn/zoomOut 是新 input action（KeyE/KeyQ，未进改键 UI 列表）
- **蔓豆（第 4 件道具，v2 链条版）**：**长按 K ≥0.3s**（BEAN_HOLD_TIME，脚下须瓦片实地）→ 扎根（根节=脚下地表上方空气格）进入**生长态**：玩家被根须固定原地（isBeanGrowing），**方向键指挥生长**——点按方向立即长 1 格、按住每 0.5s（BEAN_GROW_INTERVAL）1 格，总长 **15 格**（BEAN_MAX_TILES 含根节），顶到岩壁/尖刺/自己只抖屑不耗长度，长满自动收工；**原生藤蔓与豆茎互不干扰**：垂藤非实心天然无碍，藤蔓墙/藤蔓荚（VineBud）对攀爬也不拦（World.climbSolidAtPx 在攀爬探测中豁免 VineBud——茎长得进人就过得去）；**J 结束生长态**（W 还按着会顺势抓茎开爬）；**攀爬=沿茎链四向自由移动**（每轴独立验证 stalkAt+实心探测，CLIMB_SPEED 70，J 以 0.85×跳力跳出）；**点按 J 取消整根**（cancel 枯萎粒子），之后长按重新扎根；切道具/受击自动结束生长态（茎留在原地可爬）；茎 BEAN_LIFE 18s 枯萎；world.beanStalk 单活茎、离房置空
- **蹦菇**：非实心装饰平台——下落中脚穿过帽顶平面（±12px、vy>60）即弹（BOUNCE_VEL 330 ≈ 5.5 格）；地面行走可径直穿过；**帽子现在也会戳破漂浮泡泡**；蹦菇塔 (3,2) 靠同列弹跳柱（col14 正对顶洞）站桩弹到悬圃
- **单向平台**：根台 Ledge 与开花花苞平台 oneWay=true——只挡下落（prevFeet ≤ 台面顶才算落地），可从下方跳穿、不挡横向；**站其上按 S 主动下穿**（player.dropT 0.22s 宽限内 oneWay 全部不接人；对瓦片地面无副作用）；`solidAtPx` 同样跳过 oneWay（上升/视线/夹墙检测都当它不存在）
- **开机门（PRESS ANY KEY）**：Title.mode="press" 起机——任意键/点击 = audio.ensure()+setTrack("title")（标题曲恰在此手势起播）+ 过场渐显浮起进菜单；introT<0.6 吞键防误触菜单；从游戏退回 title 不重走过场（reset 置 introT=1）
- **压力板（PressurePlate，数据 `plate{ location, target, reset? }`：location=板所在空气格）**：站上板面（中心±7px、贴地 grounded）→ 触发 target。**无 reset=一次性**（flag `plate:<房>#<i>` 随存档持久 + 常驻脉冲）；**配 reset 秒=瞬时触发**（喂触发总线，到期自动复位，门跟着关上——见 §廿三 触发语义）。现布点 (1,3) 底层走廊 (26,10) → 收进荆棘门 "132"；(2,0) 的开关（reset=1）→ 睡莲 "2S8E6N"。**门的开门动画**：flag 置位即判定放行，视觉整扇向下降入地底 0.45s（竖门=闸门落下、横门=活板下沉），openT≥1 才 dead；机关/鞭破/压力板三条路都汇入 openDoor；**loadRoom 把旗标现状传进构造器（openAtLoad/bloomAtLoad）——进房时就已开的门/花苞直接呈现完成态，不重播开锁动画**。荆棘门 "13"（fragile:"right"）无机关指向，设计为从右侧隔界鞭破
- **美术总纲（第十批视觉翻新，两会话合并成果）**：**只动渲染不动玩法**——三生物群系全字段调色板（decor.ts PALETTES：moss/lichen/wet/spike/fog/glow/dark/shaft/grade…），光源带 tint（Light.tint，"r,g,b"）按群系分色（暖金→青苔→幽紫），体积光柱（顶层洞口 shafts，背景弱+光照后 lighter 双画），雾团+贴地潮气+色罩+胶片颗粒（grain 预生成 canvas），三层视差背景带石柱/石笋/远景植物剪影/光尘。实体层：拾取物石龛+光池呼吸环、钩环金属扫光、机关水晶呼吸环、荆棘门/藤蔓墙编织藤浪+荆棘眼、休眠花苞内辉呼吸、游魂拖尾幽火+愤怒抖动、泡泡虹彩游光、巨花缝线鳞纹+凹槽光晕、豆茎顶芽呼吸光+茎节、小树冠缘冷高光+干节疤、玩家=圆角种子+头顶速度嫩芽+眼神光。**铁律：每个 stroke 块自带 strokeStyle+lineWidth（drawItemGlyph 尤甚——HUD 每帧最后画，会吃到鞭弧 1.6px）；改外观一律走 paletteFor(w.depth())**
- **危险物可读性（用户点名：能杀角色的东西不许看不清）**：地刺=三群系 spike/spikeBase 提亮 + 尖端 1×2 高光 + 每格 r13 红色呼吸光斑（world.draw 光源收集处扫 Spike 瓦片，strength 0.68±0.12 错相脉冲）；毒雾 SporeCloud=云体提亮 + 云缘呼吸描边 + 自带 r=长边×0.85 毒绿光源（strength 0.8，world 实体光循环已透传 strength）。纯渲染层，碰撞/数值零变化。
- **氛围**：黑暗 0.34+0.54×深度；雾团两枚（time 漂移椭圆，α 0.05+0.05×深度）；晕影 (58→192, α0.52)；调色板三系压暗（植被保持鲜亮——死寂的岩、活着的植物）；玩家灯光双正弦烛火闪烁

## 五、关卡软锁防线（改动关卡前必读）

审计结论与防线（详见 `docs/learn/m2` 的"软锁审计"一节）：

1. 关键道具必须"路过即得"（鞭子在 (1,0) 竖坑右沿必经路 + 大半径）
2. 7 个竖井都有**交错**的根台（上下两层不同列！同列会撞头）——攀回路线机器测试覆盖
3. 花苞柱顶端行号 ≤2 才能裸跳穿顶洞（判定盒中心须过界 6px，按脚算会差 4px）
4. (1,4) 无笛逃生：面朝左在高台吹泡（落在 col4 顶洞正下方）→ 乘泡直接穿洞回 (1,3)；(5,2) 石台供从 (1,3) 跳下的方向落脚。**别再依赖旧弹出故障的路线**（骑泡顶石台底面现在会正确卡停）
5. (0,1) 四连环 (tiles 7/9/11/18)：链摆渡坑（A/B 短链递进，D 深脱甩上西扩后的右台 x≥190）。chain-swing-test 验证确定性核心（挂环/泵摆增幅/安全脱手）
5. **藤蔓丛不得拦截护罩必经路线**：(1,3) 飞行线 y≈145、(1,5) y≈135——这两间的藤蔓只放尖端 y≤40 的高位短款；(0,4) 尖刺地上方 y≤30。vine-test 场景3 + bubble-shield 场景2 双重覆盖
6. **扩展区攀回全机器验证**：蹦菇塔 col14 弹跳柱与顶洞同列（站桩弹穿），顶洞正下方挂壁龛根台接人（悬圃必须"站得进去"）；西苔洞蹦菇+贴墙石台；单出口口袋 (4,3)/(-1,2)/(2,6)/(3,1) 入口即出口高度。softlock-test 全覆盖
7. **上下同列的竖井在本引擎里只能单向**：从下往上穿顶洞，转换会把人放回上房洞口正下方——洞是空的就继续往下掉，无限循环（(2,1) 落点室的 row2 台阶就是这么冒出来的，已在 row0-1 对齐消除）。竖直结构的攀回要么用侧洞、要么在洞正下方挂壁龛平台（oneWay 根台：上升穿过、回落接住，悬圃壁龛即此结构）。坠井捷径 = 藤荚封盖的单向下落 + 落点室侧向出口（(2,0) 坑 col14-15 双荚封盖 → (2,1) 落点室 → 左走廊回 (1,1)）
8. **蔓豆是保险丝**：任何"有头顶空间"的位置都能长按 K 扎根爬出——新关卡若引入新单向落点，先想清楚蔓豆会不会把它变成死路或跳过关键道具
9. **改地图后必跑** `npm run test:rooms` + `npm run test:softlock`
10. **物件列表是带序号的 flag 键**：`vinebud:<房>#<i>` / `bud:<房>#<i>` / `switch:<房>#<i>` 都按列表索引生成，测试与存档都引用它们——**新增物件一律追加到列表末尾**，插在中间会把既有键位整体后移（本批往 (2,0) 中段插树就把藤荚键挤后了一位，softlock 测试当场抓住）

房间网格布局、洞口配对规则、每个房间的物件清单见 `src/data/maps.ts`（M01 的 rooms）头注释与 `scripts/validate-rooms.ts`。

## 六、测试基础设施的坑（血泪教训）

1. **冷加载竞态**：首次导航时 vite 转换模块可能 >700ms，固定延时按 Enter 会**丢键**（游戏停在标题，玩家冻结）。所有测试必须 `waitForFunction(() => window.__pw.mode === "game")`。
2. **`press()` 是点按**：可变跳高下点按=约 10px 小跳。要大跳必须 `down`→hold→`up`。
3. **L 循环有顺序**（鞭→泡→笛→豆）：测试切道具要轮询 `activeItem` 断言到位，别数次数。
4. **摆荡释放时机**：一过环就松手=最低能量点，飞不远且轮询相位稍抖结果就翻转。whip-pull-test 用**两段式**：先泵到 ω≥3.2，再等向前上升弧（`vy<-10 && x≥200`）才按 J——两次连跑落点完全一致（x=307）。
5. **单次延迟采样会漏小跳**：跳跃断言用"一段时间内的 min(y)"。
6. **循环冻结检测**：连续两次采样 `w.time` 不变 = 主循环已死（异常未被捕获时 rAF 链会断）。
7. **stale dev server**：长跑的 vite 可能供出旧转换模块（表现为"改了代码行为没变"）。重启用 `--force`。
8. 调试传送 `debugTeleport` 用 `findSafeSpot()`（脚下实心+无尖刺+不在毒雾），别直接 spawnAt 固定点。
9. **音乐加载会挪动轮询相位**：进游戏后首曲 2.9MB WAV fetch+decode 在主线程占几十至上百 ms，时序敏感的采样测试（30ms 轮询捕捉摆荡/飞行瞬间）会被抖翻。测试断言要写在相位无关的量上（min/max 窗口、两段式门槛），别赌单次采样。
10. **JUMP_CUT 曾吃掉一切向上冲量**：可变跳高的松键衰减原先作用于所有 vy<0——蹦菇弹跳、摆荡脱手全被截短。现在只有 `jumpCutting=true`（玩家主动跳）才可截短；蹦菇/脱手/罩身跳出都是完整冲量（jumpCutting=false）。
11. **平台单向化**：根台/花苞平台 oneWay——正下方直跳会"磕头"的判定已被跳过（上升可穿、落下可站、`solidAtPx` 同样跳过）。新增平台类实体记得声明 oneWay，否则竖直天梯根本爬不上去。
12. **天梯/洞柱对位**：竖直攀回梯的顶末级必须折到顶洞正下方那一列（否则最后一跳头撞洞旁实心）；洞口在 row/col 哪几格，builder 写地图时对照 validate-rooms 的配对输出。
13. **攀回测试最阴险的假阳性**：采样"当前房间名"判断逃出时，玩家可能正从上房**往下掉回**刚爬出来的洞（房间名是上房、位置在洞里）。攀回断言必须"到达后等 1.5s 再采样"并检查 grounded/y 稳定——塔测试的壁龛稳定断言就是这么来的。
14. **同一逻辑帧内完成的状态在帧间不可见**：泡泡顶人过界与房间切换发生在同一个 world.update 里，`waitForFunction(p.y < -6)` 永远等不到（下一帧 y 已是 173）——跨界类断言直接等"房间名翻转"，别等中间量。
15. **测试站位要先查头上 4px**：泡泡召唤点=眼前 6px/头顶 6px，头顶有岩檐（如 (1,3) col10）会在 y−4 探测即爆，表现为"泡泡没吹出来"。站位选上下全开阔的柱位。
16. **场景刺泡新规则对旧场景的影响**：藤蔓/树/菇现在会爆漂浮泡泡——凡是"骑泡穿过藤蔓下方"的旧测试路线都要挪到无藤柱位（bubble-shield 场景4 因此从 col16 挪到 col25）。
17. **loadRoom 里的 `key` 是"新房间"**：凡是"离开前那间"的语义（豆茎停泊房等）必须在 `this.cx/cy` 被覆盖前先取 `fromKey`——曾把停泊房记成目标房，导致豆茎在下一个房间原位复现。
18. **canvas 状态跨帧泄漏（第九批真bug）**：`stroke()` 前若不显式设 strokeStyle/lineWidth，就会吃到"上一个画家的笔"——而每帧最后画画的是 HUD。拿到鞭子后 HUD 每帧画鞭子图标泄漏 `#7fd4a0`，下一帧 decor 裂缝 stroke 全变亮绿藤纹 = 玩家报告的"拿到藤鞭后土里冒出藤"（潜伏多日的渲染 bug，靠玩家前后截图对比 + 同位开关道具的最小复现钉死）。规矩：**每个 stroke 块自带 strokeStyle+lineWidth，不依赖现场状态**。

## 七、当前状态与未尽事项

**已完成**：M0–M6 全部里程碑 + 用户反馈多轮迭代，累计：软锁审计与修复、装饰层、K 缓冲、泡泡/鞭子/护罩重做、BGM（真实曲目 8-bit 化，ADR-0002）、互动植被、**藤鞭 v3.1 持续旋转+链摆四项根修**、**M7 大扩展**（第 4 件道具蔓豆、蹦菇、20 房世界、根台/花苞单向化）、**封盖竖井捷径**、**阴森化视觉**。**第八批（2026-09-02 用户需求 11 项）全部落地**：① 跳转保速（水平转 y 不变/垂直转 x 不变+resolveEmbed）② 骑泡跨房携带（倒计时/寿命同一对象不重置）③ 摆荡 ω 上限 9 + 摆荡中起跳=陆地起跳（vy=−JUMP_VEL+切向全保留）④ 蔓豆重做（长按扎根/方向键 0.5s 每格/10 格上限/点按取消/再长按重生/J 结束生长/沿链四向攀爬）⑤ 地图全局地形视野（当前房居中无框、QE 缩放 1-4、WASD 平移）⑥ 开机即请求标题曲（setTrack+ensure 前置，pointerdown 兜底）⑦ 未安抚游魂碰身退回房间入口（不掉命）⑧ 小树（灭泡泡/破护罩/不碰茎，10 处布点）⑨ 蹦菇戳破泡泡 ⑩ (1,3)/(2,3) 荆棘门 fragile:"right"（右侧隔界可鞭断、左侧免疫、门右侧裂纹外观）⑪ 场景刺泡统一接口 popsBubbles。**外加揪出潜伏渲染 bug**：decor 裂缝 stroke 未设 strokeStyle，吃到 HUD 鞭子图标跨帧泄漏的亮绿色——表现为"拿到藤鞭后全场岩石裂缝变成绿藤"（玩家截图对比发现，同位开关道具最小复现确认，已修：裂缝显式暗色）。土中藤芽（decor sprouts）保留为默认植被。**用户已明示：测试只在其点名时才跑**——第八批已跑过的：feature-batch（新写，10/10 绿）、softlock 17/17、content 11/11、whip 全绿、build/tsc 绿。

**第九批（2026-09-03 用户需求 6 项）已落地（构建绿，回归未跑——等用户点名）**：① **PRESS ANY KEY 开机门**（任意键/点击起播标题曲+过场渐显进标题；introT 吞键窗；退回标题不重走）② **S 下穿单向平台**（根台/盛开 bud，dropT 0.22s）③ **J/K 默认键位对调**（K/Z=跳、J/X=用；11 个测试脚本已同步换键+引导加一次过门 Enter）④ **土中藤芽默认植被**（decor sprouts，回应"藤应该默认就有"——排查确认场景渲染从无道具条件，原现象=鞭子弧线+鞭门后新房间才可达）⑤ **藤鞭旋向跟朝向**（右=顺时针、左=逆时针，起手向上，挥舞中变向不翻转）⑥ **压力板机关**（PressurePlate + (2,3) 底层走廊布点→收进荆棘门"13"；门 flag 置位即放行+整扇沉入地底 0.45s 动画，机关/鞭破/压力板三路汇入 openDoor）。

**第十～十七批（2026-09-04 一天内连续完成，详见 §十～§十七）**：美术翻新+音乐瘦身+Cloudflare 部署（plant-well.pages.dev）→ 引擎编辑器（地图/材质工坊/新物品工坊/小地图选房/分类面板/写回中间件）→ 危险物增亮 → 悬浮荚/睡莲/猪笼草电梯 + 瞬时触发总线 → 黑场眨眼切换 → 物件缩放/天花藤合并/lens 重设计 → 绑定 ID 体系/尖刺物件化/光物可放置/材质发光真生效/基础微光。全部构建绿；游戏性冒烟通过；**完整测试套件仍未跑（等用户点名）**。

**第十八批（2026-09-04，详见 §十八）**：血量系统（3 格血+两档受击）+ 存档花（激活回血/血尽重生/花间传送）+ 游魂改掉血击退（不再送回入口）。构建绿，游戏性未跑（等用户点名）。

**第十九批（2026-09-04，详见 §十九）**：rooms.ts 全部 `^` 转 spike 物件（校验器禁 `^`、画笔去尖刺）、存档花烙上地图标记、传送改走地图面板选花、编辑器写回前外部修改检测（rooms.ts 已第二次被编辑器旧文档覆盖，手改已补回）。构建绿，游戏内流程未跑（等用户点名）。

**第二十批（详见 §二十）**：泡泡跨房消失根修（渐隐夹持时骑着泡泡没跟着夹回）+ 编辑器瓦片画笔 ghost 预览修复。

**第廿一～廿二批（详见 §廿一/廿二）**：**坐标体系重构**（全部物件 x/y → `location:{room_id,x,y}`，电梯/睡莲 `end:{...}`，兼容字段全删，用户新规矩：永远直接改写不留兼容）；rooms.ts 被旧页面第三次覆盖后全面恢复 + vite 中间件 **If-Match 哈希护栏**（写回必须带当前磁盘哈希，旧页面 409 拒写——**dev server 重启后生效**）。

**第廿三批（详见 §廿三）**：**房间 3 位唯一 id**（RoomDef.id R01~R20，物件 room_id 全改用 id）；**光源类**（蜡烛/吊灯/晶石/萤火虫独立分类，radius/intensity 属性，decor 凭空生成的光物全删）；开关复位语义统一（无 reset=一次性，门跟随触发开合，永久开关也脉冲电梯/睡莲）；电梯呼叫回航修"到站后无法再乘坐"；天花藤摆幅收敛 + lens 忽略上限；花苞开花视觉对齐花台；小树=树根位置；电梯终点框对齐；shroom 可悬空；存档点传送改 WASD 自由光标；编辑器删"装饰/交互"角标与"自定义物件/创造新物品"按钮。

**第廿四批（详见 §廿四）**：**实体 OOP 重构**——Entity 接口 → BaseEntity（26 类全继承）→ LightSource/TriggerSource/MoverPlatform 次级基类 → 具体物品；ENTITY_TYPES 注册表收编 loadRoom 大 switch（新增物品=写类+注册一行+编辑器挂字段）。__pw 探针增加 title 实例。**注：该批引入了高危回归（loadRoom 把无序号网格键传进工厂，flag 键丢 `#序号`），第廿五批修复——见 §廿五。**

**第廿五批（2026-09-05，上线前全面审查，详见 §廿五）**：代码+数据+文档三线全量核查与修复。

**第廿六批（2026-09-05，详见 §廿六）**：用户八项需求——ROOMS 数组化、电梯单程+跨房 handoff 重做+back、绑定多对多统一 id、右键平移跨房编辑、绑定点选 UI、骑泡下坠修复、藤蔓物理、传送地图四项、压力板离开计时、存档点突出、滚轮锚定。

**第廿七批（2026-09-05，详见 §廿七）**：**多地图系统**（rooms.ts → src/data/maps.ts：MAP_LIST+GAME_MAP_ID+派生段；编辑器新建/导入/导出/★设为游戏图/出生点编辑/改名/删图）+ 世界小地图固定视口+右键/中键拖动平移。

**第廿八批（2026-09-05，用户两项）**：① **藤 lens 条目 0 改语义**——原来钳为 1 格，现在与 -1 同义=在 [hMin,h] 内取随机（游戏 HangingVine/校验脚本/doc.validate/编辑器字段标签/maps.ts 类型注释五处同步；(2,0) 的 lens[3,0,4] 那根实测长出 2.57 格）；② **编辑器顶栏排版**——1366 宽度下按钮文字被挤折行，修复：顶栏按钮一律 nowrap+flex:none、mapSelect 限宽 132、间距收紧，极窄窗口 overflow-x 滚动兜底（截图验证单行）。

**第廿九批（2026-09-05，地图数据 JSON 化）**：见 §廿九。MAP_LIST 从 maps.ts 内联字面量改为 **`src/data/maps/<id>.json` 一图一文件** + `src/data/gameMap.json`（★游戏图）；maps.ts 缩为类型+glob 派生；保存通道按文件粒度（`/__save/map/<ID>`、`/__save/game`、DELETE 删图）；TS 拼接/注释回填机制整体退役。顺带：删物件联动清理双向绑定引用；修复数据里 plate M8XR4D 指向已不存在的电梯 54JW9S 的悬空引用（该电梯在迁移前的数据里已被删除）。

## ⚠ compact 后待办（第一个任务）：用 CDP 追"跨房视角不跟"问题

**用户 bug**：从 2,0 走右到 3,0（R21，用户手建的新房）后，"角色明明已经在另一个房间了，视角还停留在当前房间"。另注：3,0 的洞腔与 2,0 洞口对齐、无光源，换房后画面几乎不变——"视角没动"的**体感**可能部分来自这个（两房视觉连续+太黑），但用户在 zcode 内置浏览器也复现了，需真查。
**已验证正常的部分**（无头探针实测）：checkTransitions→fade→loadRoom 链路正确（cx/cy/相机残差/玩家位置全对）；换房黑场眨眼有触发。**用户复现环境是 zcode 内置浏览器**（GameViewer webview），无头 Edge 探针未复现——**怀疑点：内置浏览器（webview2）下 rAF/fade 时序不同，或用户看到的是 fade 冻结期间**。
**CDP 追踪法**（本轮已验证可行）：无头起窗加 `--remote-debugging-port=9223`（background bash 保持存活），用 `curl localhost:9223/json` 拿 targets，或直接 playwright `chromium.connectOverCDP('http://localhost:9223')` 连**用户正在操作的页面**实时采样：`w.cx/camX-cx*320 残差/player 坐标/debugLog`。
**注意**：本轮未提交的 M01.json（用户在编辑器里改了 R19 竖井/藤）、decor.ts/world.ts（视觉+提亮批次）都是**用户的合法编辑**，别当垃圾回滚！

**第卅九批（2026-09-06，五项体验修正）**：
1. **藤摆幅略增**：风 0.06→0.085、拨藤冲量 0.02→0.026、角速度上限 1.8→2.1、阻尼 2.4→2.2。
2. **传送光标贴边跟随**：舒适带收紧（56/40→48/32）——光标贴边时视野跟随更积极，不再"光标出图消失"；与 Tab 地图同一套 band+pan 手感。
3. **存档点吸附（停稳吸附模型）**：光标**无输入停住时**吸附 ≤2.5 格内最近存档花；移动中绝不吸附（按住方向即可离开，不钉死）。确认判定放宽：精确命中或 ≤1.5 格内最近花。
4. **豆茎停泊寿命重置**：回停泊房捞茎时 `stalk.refresh()`（寿命回满 BEAN_LIFE）——"5s 内返回"循环里茎完好如初；离开才重新停泊 5s（原 timer 逻辑本就重置，真正缺的是寿命回满——茎自身 18s 寿命在多次往返中烧完消失，用户感知即"倒计时没重置"）。
5. **编辑器跨房操作直切**：矩形/画笔（含空气）落到邻房不再拦截警告，**直接切换工作房执行**（物件放置/选择本来就是）；pointermove 的"拖出房界停画"守卫保留（paint 中途坐标系切换会乱线）。
6. **探针适配 persist**：release-audit 场景 1 改用同房电梯 K25B6Y（(1,4)）+ 玩家挪到笼口登乘——原场景假设跨房电梯 FQ84CK 初始在原位，persist 恢复后它停在邻房远端，假设失效（游戏行为正确，是探针过时）。

**第卅八批（2026-09-06，视觉二调 + 小地图全黑修复）**：
1. **环境光再暗**：dark 公式基础 0.52→0.60（深度系数 0.10 不变、调参系数 0.24→0.22）；三群系黑暗底色 RGB 从上批的提亮值压回中间档（苔藓绿 26,36,30→12,18,15 等）——暗但不纯黑。
2. **物件"鲜亮不加光"**：基础微光大幅回降（gs 下限 0.3→上限 0.2、半径 26→14、强度 ×0.5）——微光本质是发光，物件不该发光；鲜亮改由**材质色彩**承担：materialData 13 类非光源物件的 base/accent 提饱和提亮（glow/glowStrength 一字未动，光源类发光特权保留）。
3. **岩壁只提发光苔藓**：moss/grass/flora 三群系再提鲜（rock 系列保持上批值不再动）。
4. **小地图全黑根因修复（重要回归）**：`flags.add("seen:<房>")` 的**写入在整个代码库中不存在**（只有 buildWorldMap 的读取）——初始提交即如此，此前某次重构弄丢了写入行，地图迷雾从那时起永远全黑。已在 loadRoom 恢复写入（随 flags 自动入存档）。探针实测 debugGoto 走 5 房后地图正确烙出（岩壁/地刺红标/存档花点/玩家金点）。
- 提醒：本批含 HANDOFF 之前所有未提交改动（第卅七批后 decor/world/light 的视觉线），**全部未 commit**（等用户指令）。

**第卅七批（2026-09-06，光照回退：撤 raycast 阴影）**：用户报"游戏内光影极其诡异"。截图确认三类伪影：①阴影楔角宽翻倍+半径外扩后互相叠涂，光区被压出"黑伞"扇形（(1,5) 存档花蜡烛最明显）；②free≤1 的方向也画楔，光源脚下被啃掉；③96 向低分辨率下条纹根本修不干净。**处置：raycast 阴影整个回退**——light.ts 恢复纯径向模型（黑暗+抠洞+lighter 染色），2D 横版里光"绕过墙角"本就符合直觉；提亮成果（底暗公式 0.46+0.10d+0.24s、物件基础微光 0.3、晕影减弱、群系 dark 底色提亮、玩家灯 0.72）全部保留。实验实现可在 git 历史（initial commit 的 light.ts 之前版本）找到。若将来再做真遮挡：需更高射线密度或 SDF/遮挡图方案，别再用逐向楔形。

**第卅六批（2026-09-06，部署含编辑器）**：vite build 加 rollupOptions.input（index+editor 双入口）——**编辑器随产物上 Cloudflare Pages**（/editor.html → /editor 308 规整）。线上编辑器=查看器/导出器：写回通道是 dev 中间件线上不存在，保存走剪贴板/下载兜底并明示"线上仅可导出"（顶栏横幅文案已注明；导出的 .json 放回本地 src/data/maps/ 即可）。线上完整编辑器（云端存储 KV/D1+鉴权）留待将来有需求再做。

**第卅五批（2026-09-06，编辑器工具重构 + 光照真光源 + 场景提亮）**：
1. **空气入建筑类、橡皮删除**：工具只剩 选择(V)/放置·画笔(B)/矩形(R)；「空气」是建筑材料（画笔=擦，矩形=擦矩形）。
2. **矩形填充跟随材料**：R 工具拖拽画矩形，填当前所选建筑（岩壁/空气）；点材料只换材料不抢工具（place/rect 保持）；矩形状态栏显示材料名。
3. **框选多选**：选择模式空白处拖拽=marquee，收集覆盖物件（跨房、建筑瓦片除外）进 multiSel（"房键#序号"集）；检查器批量卡片（类型汇总+删除/清空）；Del 批删（单次 mutate 整体撤销+绑定联动清理）；Esc 清空；选中高亮与单选一致。
4. **光照真光源重做（light.ts）**：黑暗底→destination-out 抠洞→**raycast 阴影**（每大光源 96 向、步进 5px；自由距离外填回黑暗=光不穿墙）→**lighter 染色楔**（同可见距离裁剪）。大光源阈值 r≥24（物件基础微光不投影）；嵌墙光源跳过自身格+最少 8px 透光；楔宽翻倍重叠消放射条纹。
5. **场景提亮**：底暗公式 0.10+0.24d+0.56s → **0.46+0.10d+0.24s**；物件基础微光 0.12→0.3（无光源无角色也可见剪影）；晕影减弱；三群系 dark 底色 rgb 大幅提亮（原 ≈2,6,4 级别→26,36,30 级）；玩家灯 0.48→0.72。
6. **修 setPointerCapture 合成事件崩溃**（探针/自动化 pointerdown 首行 NotFoundError 导致整个编辑分支不执行）→ try/catch。
8. **框选命中规则（用户反馈修正）**：
   **追问修正（真正根因）**：收集循环曾遍历全部房间，而 marquee 坐标是当前房局部格——拿局部坐标去比邻房物件=把邻房同位置的东西全抓了（用户框 3×3 只有萤火虫却选中 9 个：花苞/蹦菇根本不在本房，是邻房的）。已改为**只收集当前房间**。
footprint 与框的重叠面积 ≥ 物件面积一半（或被框完全包含）才算选中——纯边角相蹭不算（原「相交即选」让框一个萤火虫卷走沿途 9 个物件）。
9. **探针**：新 scripts/editor-tools-probe.mjs 9 项（工具条/空气材料/矩形空气/矩形岩壁/框选卡片/批删/整体撤销）；cell() 屏幕换算=画布世界原点(0,0)房+state.cam（每步现读）。__pwEditor.state 增 cam/multi。

**第卅四批（2026-09-06，电梯到站状态默认持久）**：用户需求"到起点/终点后一直停留在那里（跨房间/读档不复位），直到被乘坐或机关触发"。实现：**不加数据属性，所有电梯默认持久**——depart 时写 flags `lift:<id>`（=停在远端；world.setLiftEnd）；loadRoom 重建时按 flag 恢复：flag 在 → 出发房的数据原件让位（suppressed）、终点房物化远端形态真身（constructor 按 flag 以 endRoom 形态醒来：homeKey=endRoom/off=远端目标/handedOff=true）、都不在则挂 detached；flag 不在 → 按数据原位重建。**附带修复**：empty-attach push 时同 id 让位（防与 rebuild 原件重叠）；R05 终点落点数据观察：终点地板比笼底低约 1 行，站立位在笼口区下方 6px——远端再乘坐需跳进笼口（数据摆放，非代码）。注意：用户数据 M01 的 UYDJ26 当前 back=false（编辑器改回的）；今早遗留的空白 M02.json 与 gameMapId=M02 已复位为 M01。

**第卅三批（2026-09-05，井图无限世界 + 点空位建房）**：①井图（编辑器小地图）可平移范围从"房间包围盒"改为**包围盒四周各扩 4 格的探索余量**（panBounds，世界无限大的动态表达——房间建到哪余量跟到哪），右/中键拖动能移进空区；②**左键点空位弹 confirm 确认后直接创建新房间**并切过去（选点/绑定点选中时不打断），空位悬停虚线框+加号高亮；cellFromMouse 取代 roomFromMouse（空位也是格）。探针 multimap-probe 扩到 22 项（拖动余量平移/点已有房切房/点空位创建/取消不建）。另：打开编辑器（及展开井图）时**井图视口以当前工作房间为中心**（mmCenterOn；切房中仍是"必要时才滚"的 mmEnsureVisible）。

**第卅二批（2026-09-05，空笼返程拖走世界）**：用户报告 back 笼回到出发房时"角色突然瞬移回原房间"——根因：handoffElevator 对**空笼**也无条件 loadRoom(目标房)，世界（镜头+坐标系+玩家）跟着空笼跑。修复：载客/空笼分路——载客照旧 loadRoom+乘客坐标平移；**空笼不 loadRoom**，目标房=玩家所在房则直接进驻实体表，否则挂 `world.detached`（视野外照常模拟：飞行/到站/返程计时；玩家所在房加载时按 homeKey 归位并让数据原件让位；绘制按房间差平移；detached 不做登乘检测——登乘拿玩家坐标跨房比较无意义）。探针 16 项重写为断言"空笼全程玩家世界不动 + 回巢归位"。

**第卅一批（2026-09-05，编辑器顶栏排版终版）**：顶栏策略定为「文字永不折行，空间不足整行折到第二行」——topbar 全部子项 white-space:nowrap（含 ●未保存/通道警告等纯 span，上一轮只盖了 button/select/a 导致『未保/存』折行）、flex-wrap:wrap 兜底；多宽度实测 1000~1366 均为整齐两行、无溢出无断字。

**第卅批（2026-09-05，跨房电梯真正修复）**：见 §卅。第廿六批的 handoff 存在三处致命错误（阈值指向目标房原点永不触发 / adopt 后行程目标未换算坐标系 / 回巢重建出重复电梯），跨房乘坐实际不可用；本批重写并新增 `scripts/elevator-cross-probe.mjs` 16/16。

**compact 基线（2026-09-05 深夜，第卅二批完成后）**：tsc/build 绿；validate-rooms ✓（3 条警告：长藤垂落压岩 ×2 + plate M8XR4D controls 为空——那台电梯已被删，等用户重新绑或不绑）；游戏探针 14/14；编辑器探针 18/18；**多地图探针 `scripts/multimap-probe.mjs` 20/20**（含 JSON 落盘断言与 fs 还原清理）；**跨房电梯探针 `scripts/elevator-cross-probe.mjs` 21/21**（空笼去/返玩家世界不动+detached 流转+回巢归位 / 切房时机 / 终点卸客 / 载客穿越 / persist 跨房恢复与乘坐清除）；骑泡跨房探针 ✓。数据真身 = **`src/data/maps/M01.json`**（20 房）+ **`src/data/gameMap.json`**（gameMapId=M01）；写回路由 = `/__save/map/<ID>`、`/__save/game`（旧 `/__save/rooms`、`/__save/maps` 均不存在）。完整测试套件仍未跑（等用户点名）。

**待办 / 已知问题**：
0. **已闭环（第廿五批）**：a. (2,0) lens[3,0,4] 的 0 与 a2. (0,1) 长藤垂落区压岩——校验器已按新语义放行/降级为警告（显式 lens=实际长度忽略 h 上限；藤无伤，垂落区压岩属视觉穿帮），数据保留原样，等用户自行定夺；c. 根目录 probe14~25.mjs 临时脚本已删（本轮新增的回归探针在 `scripts/release-audit-probe.mjs` 与 `scripts/release-audit-editor-probe.mjs`）。
   a3. **旧存档 flag 失效**：第廿五批修复 flag 键丢序号回归后，键格式回到 `<房>#<i>`；BUG 期间存下的档里 `bud:<房>`/`sp:<房>` 等无序号键不再匹配（花苞重闭合、存档花重变暗）——上线前属预期，开新档即可。
   b. 用户报"撤销只能回退一次"未复现（探针验证多步撤销正常）——若复现，查其操作序列与浏览器旧 JS 缓存
   d. 地图存储：**已闭环（第廿七批）**——单文件扩展性以多地图结构解决：src/data/maps.ts 的 MAP_LIST 装任意多张图，编辑器可新建/导入/导出/★设为游戏图。游戏内跨图传送未做（MapDef.id 是预留钩子）。若单文件将来过大再议按文件拆分
1. **第九批+第八批尾巴的回归全都没跑**（等用户发话）：bubble-shield（场景4 已挪 col25 无藤柱位）、chain（陆跳式摆荡起跳后落点窗口大概率要重调）、vine / escape / use-buffer / music / e2e / room-cross / feature-batch / softlock / content / whip——全部脚本已同步新键位（K=跳 J=用）与新开机门（两次 Enter），跑之前先 `npm run test:rooms` 校验 rooms.ts（压力板/小树均为物件表追加）。**注意：新关键值（CRUMBLE_*、电梯速度、lens 语义、scale）无专属回归脚本；softlock 断言的 `vinebud:2,0#2` 等键现在与游戏真实键一致（第廿五批修复后）**
2. **git 已建（第卅七批）**：`git init -b main` + 完整 .gitignore（忽略 node_modules/dist/.wrangler/.playwright-mcp/wav 产物/临时文件）+ `.gitattributes`（`* text=auto eol=lf`）+ 首次提交 57bd9c7（86 文件，.git 23MB；音乐只收 mp3 母带）。**GitHub 远端已建并推送（第卅八批）**：gh CLI（winget 装 v2.100.0）+ device-code 登录（账号 aburaMSMS，https 协议、keyring 存 token）→ `gh repo create plant-well --public --source . --remote origin --push`。远端 **github.com/aburaMSMS/plant-well**（main）。**push 即上线已生效（本地 pre-push hook）**：`.git/hooks/pre-push` 在每次 push 后台跑 `npm run deploy`（日志 .deploy.log，已 ignore；跳过单次用 `git push --no-verify` 或 `SKIP_DEPLOY=1 git push`）。实测推送→自动部署 exit=0 ✓。Pages 项目是直接上传型（Settings 里无 Git integration 可绑，wrangler 也不支持给既有项目绑 git）——hook 就是本项目的 git 集成等价物。若将来想要 GitHub Actions 云端部署：需 Cloudflare API Token（用户手动建）+ repo secrets
3. 摆荡新上限的手感待真人验证（SWING_OMEGA_MAX 9、摆荡起跳 vy=−JUMP_VEL×1.3 切向——constants.ts/player.ts）
4. 已部署 Cloudflare Pages（plant-well.pages.dev，`npm run deploy`）；`npm run build` 的 dist/ 是纯静态，任意静态托管均可。注：wrangler 不在 devDependencies，deploy 时临时拉取
5. 花苞被笛子吹开后永久保留（存档 flag；重进房间不再重播开花动画），无"重新闭合"机制——若做周目可考虑
6. 移动端/触屏不支持（设计上就桌面键盘）
7. BGM 曲目只有 title/game 两首；换曲/加曲改 `src/assets/` 后重跑 `npm run convert:music`，TRACK_URLS 在 audio.ts
8. 藤蔓丛摇摆/护罩破裂的判定外扩（6/8px）与 0.55s 摇摆时长是手感值，在 entities.ts HangingVine.update
9. 蔓豆新手感值待实测：BEAN_HOLD_TIME 0.3（扎根长按）、BEAN_GROW_INTERVAL 0.5（每格秒数）、BEAN_MAX_TILES 15（总长）、BEAN_LIFE 18——都在 constants.ts
10. 旧存档兼容：蔓豆茎结构重做后存档里没有茎状态（本来就不入存档，无影响）；bud 键位见上 0.a3

**后续功能候选**（用户未确认，仅记录）：二周目、更多源种密室、手柄支持、按深度变化的 BGM 变奏。

**compact 后第一步**：读本文件 §七。**测试一律等用户点名再跑**（本会话用户已明示）；自行验证基线只跑 `npm run build`（tsc 静态检查）。dev server 用 `npx vite --port 5199 --force` 重启（后台任务随会话死亡）。

## 八、关键调试方法论（本项目验证过的方式）

- **一切集成行为用无头浏览器验证**：`?debug=1` + `__pw` 探针 + 逐帧采样（x/y/grounded/dead/embedded/t）。"循环冻结检测"= 连续两次 t 相同。
- **修完必跑**：`npm run build && npm run test:rooms && node scripts/softlock-test.mjs && node scripts/e2e-check.mjs`
- 三次大 bug 的复盘都写进了 docs/learn（出界=实心、光照坐标系错位、vy 派生状态失真）——同类问题先去翻。

## 九、给下一会话的操作建议

1. 读本文档 + `git log`（如果有）+ `npm run build` 确认基线
2. `npm run dev`（或 `npx vite --port 5199 --force`）+ 跑一遍测试套件确认全绿
3. 用户诉求 → 改动 → 对应测试 → 文档同步（讲解文档/词汇表/README）
4. 新机制 = constants.ts 数值 + entities/player 行为 + world 派发 + 功能测试四件套

## 十、引擎编辑器（`npm run dev:editor` → /editor.html，仅开发期）

第 2026-09 会话新增的可视化关卡编辑器 + 引擎工坊，**改地图/调材质/造新物件都不再需要手编数据文件**：

- **文件**：`editor.html`（UI 壳）+ `src/editor/{palette,doc,exporter,mats,workshop,render,main,dataBridge}.ts`。`?raw` 导入做注释解析；`vite build` 不含编辑器（纯 dev 工具）。
- **地图编辑**：画笔/矩形/橡皮刷瓦片（右键拖动=平移画布，跨房放置/点选；橡皮走工具栏）、物件调色板+属性检查器、房间光源、世界画布跨房导航（点空位新建房，滚轮=锚定缩放）、撤销/重做、localStorage 自动备份。
- **多地图（第廿七批，第廿九批改为 JSON 存储）**：顶栏地图簇——`#mapSelect` 选图编辑（★=游戏图）、`＋图` 新建（封闭起始房+出生点）、`导入/导出`（单图 JSON，与存储文件同格式；id 撞车自动顺延 M##）、`★ 游戏图`（保存时写 gameMap.json，游戏页只运行它）。「房间」页地图区：改名、出生点→本房、出生点 x/y、删图（保存过的新图连磁盘文件一起删）。文档模型（doc.ts）：`maps[]` 全部图 + `editMapId`（正在编辑）+ `gameMapId`（★）+ `baseJson`（各图装载基线，保存只写脏文件）；`doc.rooms/doc.keyOrder` 是指向当前编辑图的 getter，编辑器其余代码无感知。编辑图/工作房按 `plantwell.editor.map`、`plantwell.editor.room`（"图id|房键"）持久化。**删物件会联动清理双向绑定引用**（第廿九批补——此前删被控方会留下悬空 controls 引用）。
- **世界小地图（左下角井图）**：固定视口（≤248×168px）——世界大过视口时**右键/中键拖动平移**（mmX/mmY 视口偏移，钳在世界内±8px 出血），左键点选切房，切房/切图时当前房不在视口内自动滚到居中。
- **材质工坊（🎨 材质）**：15 类内置物件的主色 base / 高光 accent / 光色 glow / 自发光强度——保存写回 `src/data/materialData.ts`（编辑器生成的文件，别手改）。游戏侧经 `src/data/materials.ts` 的 `mat(type)`/`shade()`/`rgbOf()` 消费；实体 draw 里主色已全部走材质（改完游戏页自动刷新即变色）。
- **新物品工坊（✚ 新物品）**：创造数据驱动的自定义物件——7 种参数化形状（tree/crystal/mushroom/rock/flower/torch/block）、占地 w×h、solid 碰撞开关、light 自发光、材质三色。保存写回 `src/data/propData.ts`；地图里以 `{ type: "prop", id, x, y }` 引用，运行时是 `CustomProp` 实体（entities.ts 尾部，drawPropShape 与编辑器预览共用一份构图）。物件调色板会自动长出新按钮。
- **校验面板**：与 validate-rooms.ts 同源 + prop 引用检查；画布边缘洞口配对色条（绿=配对，红=漏）。
- **写回（同一通道，按文件粒度）**：`POST /__save/map/<ID>`（单图 JSON）/ `POST /__save/game`（gameMap.json）/ `DELETE /__save/map/<ID>`（删图文件，同样过哈希护栏）/ `POST /__save/{materials,props}` → vite.config.ts 内置中间件落盘。保存只写与装载基线不同的文件（doc.baseJson 脏比较），409 只拒相应文件。写回后游戏页自动刷新，编辑器经 dataBridge.ts 的 HMR 边界保内存态。通道不可用 → 顶栏红色警示 + 保存时明确报错，重启 dev server 即可。**ID 白名单 `^[A-Z0-9]{2,4}$`（同时防路径穿越）；文件不存在时哈希为空串=允许创建**。
- **铁律**：maps.ts 各图 objects 只做末尾追加（flag 键序号）；materialData/propData 是生成文件，手改会被覆盖；新增物件类型要同时在 palette.ts（字段表）+ doc.ts（校验）+ render.ts（画布示意）+ world.loadRoom（实体化）登记。
- **已知现状**：(0,1) 有 4 个 vine 垂落区压尖刺/实心的既有问题（x5 h15 那株，validate-rooms.ts 同样报）；3 蹦菇+1 小树"下一格非实心"的 info 提示是故意悬空的设计。

## 十一、悬浮荚与睡莲平台（第十一批：动态平台机关）

- **悬浮荚 `crumble`（悬浮块）**：`{ type:"crumble", x, y, w }` = 1×w 孢子荚脆平台（oneWay）。**逐格独立**：loadRoom 每格 new 一个 CrumblePod——踩上哪格（standingOn 判定）哪格 1s（CRUMBLE_SHAKE_TIME）后碎，3s（CRUMBLE_REGROW_TIME）后独立重生（0.35s 生长动画）。状态纯运行时，不入存档，重进房间复原。材质键 `crumble`。
- **睡莲平台 `lilypad`**：`{ type:"lilypad", x, y, w, mode, axis?, range?, speed?, target?, delay?, dx?, dy? }`，oneWay 平台且**搬运站上的角色**（update 里位移差直接加到 player.x/y；起跳瞬间 vy<-10 不拽）。
  - patrol：沿 axis（默认 h）在 range 格（默认 3）行程内以 speed px/s（默认 36）三角波来回，相位从 0 起（确定性）。
  - switch：target 触发 → 延迟 delay 秒 → 滑向 (x+dx, y+dy)（速度同 speed）→ 触发持续期间停住 → 触发结束滑回原位；回程中再触发会掉头。
- **瞬时触发总线（关键机制）**：switch/plate 新增可选 `reset`（秒）——配了就是**瞬时触发**：触发走 `w.pressTrigger(target, reset)`（运行时 Map 存到期时刻，`w.triggerActive(id)` 查询，过期自清），**不写存档 flag、不调用 openDoor、不 saveGame**；不配=原永久行为（完全兼容）。这就是"开关也恢复原样"的实现——压力板配 `reset:4`，睡莲配同一 target，板 4 秒后自动弹起、平台同步滑回。瞬时段的板/开关点亮状态也走 triggerActive，视觉与状态同步。
- **验证过**（2026-09 无头烟测，做完已还原数据）：逐格独立碎/重生、patrol 平移、switch 延迟移动+复位滑回，全部通过。

## 十二、第十一批后续：快捷键/苔藓/藤蔓/点缀/小地图（同会话追加）

- **数字键切道具**：input 新增动作 slot1~4（Digit1~4）→ ITEM_ORDER 直选（1=鞭 2=泡 3=笛 4=豆），未持有无反应；world.update 里在 cycle 分支后逐槽检查。
- **藤蔓逐条定长**：ObjDef vine 新增可选 `lens?: number[]`（格数数组，逐条钳 1~h）——HangingVine 重写为**单摆物理**（每条独立 angle/angVel，重力回复+阻尼+环境微风；被角色贴近时冲量∝player.vx）。判定全部逐条：`popsBubbles()` 返回 Rect[]（Entity 接口已扩为 `Rect | Rect[] | null`，Bubble 消费端兼容数组）、护罩破裂、摇摆触发都按每条实际长度+当前摆角；缺省仍按种子随机。编辑器 vine 字段加 lens（intarray，逗号分隔）；exporter 序列化数组为 `[a, b]`。
- **发光苔藓**（用户参照动物井截图点名"完整描边"；后反馈"有点厚"已调薄）：构造器把**每一段 solid/air 交界的岩壁像素**逐点烘进 320×180 离屏画布（glowLayer，一次性行；逐像素 alpha 0.14~0.39 坐标哈希微差，柔晕只向空气侧晕 1px），drawGlowScene 每帧整图 drawImage（lighter + 呼吸 0.62±0.12）。颜色：RoomDef 可选 `moss: "#hex"`，缺省按深度三色底 + 房间种子微调。编辑器右侧"发光苔藓"节可配色/恢复自动；exporter 写 `moss:` 行。原稀疏光斑（glowMoss ≤44）保留作亮斑点缀。
- **背景发光点缀**：同 drawGlowScene——萤火虫（游走+明灭）、蜡烛（壁挂烛焰摇曳）、发光晶石（地面矿簇慢脉动）、吊灯（垂链+暖焰）。构造器从瓦片扫描收集候选点（顶面=晶石、天花板=吊灯、侧壁=蜡烛、开阔空气=萤火虫）按房间种子挑 2~4/1~3/1~3/0~2 个。纯渲染无判碰。
- **编辑器小地图选房**：#worldGrid 按钮网格 → #roomMap canvas——每房按 1px/格 画场景缩略图（岩/刺/洞口绿标/出生点金点），当前房绿框+代号，悬停亮框，点击切换；空格暗框（新建仍走 col,row 输入）。
- **验证过**：数字键四槽直选、lens [3,1] → 两条判定 h=30px/10px、moss #d878c8 生效 15 处光斑、点缀生成 3萤火虫+3蜡烛+1晶石+1吊灯、小地图渲染+点击切房+苔藓色同步——全部通过（临时数据已还原）。

## 十三、猪笼草电梯 + 地刺物件化 + 编辑器分类（同会话第二批）

- **猪笼草电梯 `elevator`**：`{ type:"elevator", x, y, axis?, range?, speed?, target?, dwell? }`，笼身 1×2（x,y=笼口格）。**v 轴向上开**（基点=地面登上端）、h 轴向右；无碰撞，走入笼身（贴地+脚在笼身竖直范围内）0.25s 后吞入——riding 时 `w.hidePlayer=true`（draw 跳过玩家+鞭索），乘客锁在笼底随笼移动；到站 dwell(默认0.8s) 后吐到笼底并置 `awaitExit`（走出笼身才重新载人，防原地弹跳）。`target` 触发（配 reset 的开关/压力板）走**边沿检测**（prevTrig）→ 无客往返一趟。状态不入存档。材质复用 `lilypad`。
- **地刺物件 `spike`**：`{ type:"spike", x, y, w? }` = 1×w。loadRoom 把它**烙进房间 Tilemap.cells**（Tile.Spike）——碰撞/绘制/安全点/危险光全部复用瓦片逻辑，零特判。地图 ^ 字符仍兼容；新关卡一律用地刺物件（编辑器瓦片画笔已只留岩壁/空气）。编辑器校验：地刺下方非实心给 info。
- **编辑器分类面板**：ObjSpec 新增 `cat`，CATEGORIES 八类（建筑/开关/场景/移动/道具/伤害/生命/道具作用），调色板按类折叠、展开方可放置（建筑类默认展开）。建筑类=岩壁/空气（画笔瓦片，独立瓦片区已删）。道具类唯一性：item 全局一件（放置时 confirm 迁移）、seed 1~10 用完拒绝。自定义物件归场景类。新物件画布示意：spike 红刺排、elevator 瓶身+行程虚线+target 标签。
- **验证过**（2026-09 无头烟测，临时数据已还原）：尖刺烙瓦片精确命中、吞入上载→吐出落定无弹跳、压力板触发无客往返+reset 复位+边沿不复发、八类折叠展开、移动/伤害类条目齐全——全部通过。
- **教训**：新机制冒烟时"实体消失"先查**房间是否被悄悄切换**（玩家被机关带出边界）——pads[1] undefined 的真因是电梯载客出房，不是实体丢失。

## 十四、切换过渡：黑场眨眼（同会话第三批，快照滑动方案已废弃）

- **演进**：滑动过渡（旧房瞬间消失→空背景，录屏帧混叠成双重曝光）→ 快照滑动（旧房快照滑出，干净但仍"平移"）→ 用户反馈仍有残影：**0.22s 快速平移只要遇帧混叠必然叠画，运动式过渡天然不抗混叠**。
- **最终方案：黑场眨眼**。`World.fade = { t, phase:"out"|"in", ncx, ncy, nx, ny }`：checkTransitions 触发时**先夹回玩家到旧房边界内**、记下目标，phase=out 渐隐（FADE_T=0.1s，画面叠 rgba(3,6,9,α)）；黑透瞬间 `completeRoomSwap()` 执行原换房流程（loadRoom/resolveEmbed/骑泡搬迁/entry/lastSafe/snapCamera/saveGame）；phase=in 渐显。期间 `locked=true`、update 提前返回（游戏逻辑冻结）。任一帧只可能是旧房/纯黑/新房之一——**数学上不存在叠影**。
- **结构**：draw() 拆成 `drawScene(ctx)`（背景→实体→光照→氛围层，不含 HUD）+ draw(HUD)；LightPass 可画到任意 ctx。TRANSITION_T 常量已删，换 FADE_T=0.1。
- **苔藓调薄**：核心 alpha 0.20~0.52→0.14~0.39，柔晕从 3×3（往岩里糊）改为只向空气侧 1px，整体呼吸 0.78→0.62。颜色：RoomDef 可选 `moss: "#hex"`，缺省按深度三色底+房间种子微调；编辑器"发光苔藓"节可配色。glowLayer=每房一次性烘焙的 320×180 边缘描边层（逐像素 0.14~0.39 + 空气侧 1px 柔晕），drawGlowScene 整图 lighter 叠加。

## 十五、物件缩放 + 天花藤合并 + 检查器增强（同会话第四批）

- **视觉缩放**：ObjDef 全类型通用可选 `scale`（0.3~3）/`scaleJit`（±比例）——rooms.ts 里 `export type ObjDef = RawObj & { scale?; scaleJit? }`（交联不破坏判别联合）。loadRoom 按房间+序号 FNV 哈希确定性取 `scale×(1±jit)` 写入 `Entity.scale`；world.draw 统一 `translate(锚点)→scale→translate` 包裹绘制。**纯视觉，碰撞/判定零变化**。Door/SporeCloud 构造器补了 x,y 锚点（此前停在 0,0，缩放会瞬移）。编辑器检查器"外观"区可设两值（留空=删键=默认）。
- **天花藤合并**：调色板只留场景类一条"天花藤"（vine）；vinebud 条目 `hidden:true`（调色板不显示，检查器照常编辑）。检查器里 vine ⇄ vinebud 一键互转（保留 x/y/h + scale/scaleJit 通用键）。
- **检查器增强**：放置后自动选中并刷新检查器（此前漏了 refreshInspector——放置后看不到详情，已修）；新增"🎨 材质"按钮直达材质工坊并定位到该类型（prop 物件直达新物品工坊对应条目）。
- **编辑器瘦身**：工具合并——「放置/画笔」一体（palSel 决定：建筑瓦片=长按铺设，物件=点击放置），默认工具=选择/移动；"装饰/交互"分类角标与"自定义物件/＋创造新物品"独立按钮后于 §廿三/廿五 移除。校验结果以状态栏「校验 N 错/N 警告/OK」常显（点击列详情，doc.validate 每次刷新都会跑）。
- **验证过**（2026-09 无头烟测，临时数据已还原）：场景类单条天花藤、建筑类无空气、校验区消失；放置→外观 scale 1.5/jit 0.2→藤荚互转（scale 保留）→保存回环 `{ type:"vinebud", …, scale: 1.5, scaleJit: 0.2 }`→游戏加载该实体 scale=1.2114（确定性随机落点）——全链路通过。

## 十六、藤蔓 lens 语义重设计 + 属性可视化排查（同会话第五批）

- **lens 新语义**：`lens` 条数=根数（≤6 根），值 **-1=该条在 [hMin,h] 内随机**，其余按数值取长；`h`=长度上限，新增 `hMin`（缺省 ≈55%×h）。HangingVine 构造器签名 `(tx,ty,th,lens?,hMin?)`；无 lens=旧随机（兼容老数据）。放置默认 lens=[-1,-1]（palette.defaultsFor 特例，**必须排在 optional 跳过之前**——踩过坑）。
- **画布逐根可视化**：render.ts vine case 按 lens 画 n 根（显式=实线+实心尖端，随机=虚线+空心圈），右侧标 [hMin,h] 范围尺；**此前画布固定画两条全长藤、完全不读 lens**——这就是用户报"编辑没效果"的根因。
- **属性可视化排查**（同批补齐）：door 画脆弱侧缺口带+收缩箭头+id 标签（脆:左/右·横收/沉地）；plate/switch 加 `→ target (Ns)` 标签；item 画 r 吸附半径虚线圈；elevator 标签含速度；**scale 预览**——drawObj 全 switch 包在 translate→scale 变换里（锚点=footprint 中心），scaleJit>0 时画最小/最大两圈虚线框，选中框跟随缩放后尺寸。
- **validate-rooms.ts / doc.validate 同步**：lens 允许 -1；垂落区按**有效长度**（lens 全显式=最长条，含 -1 或缺省=h）判定——旧规则对短 lens 藤会误报。
- **验证过**（2026-09 无头烟测，临时数据已还原）：lens [1,3,-1] + h4/hMin2 → 画布三根（1 格/3 格/随机虚线）→ 保存回环 `{ h:4, lens:[1,3,-1], hMin:2 }` → 游戏逐条判定 10/30/32px（随机条落在 [20,40]）——全链路通过。
- **教训**：python 多行补丁失败会**整段不写入**（assert 在 write 之前）——连续补丁后必须核实每处都真的落盘了（本批 palette vine 字段就静默丢过一次）。

## 十七、绑定 ID 体系 + 尖刺物件化 + 光物可放置（同会话第六批，compact 前完成）

- **绑定 ID**：可绑定物件（门=id，开关/压力板/电梯/睡莲=bind）自动生成 6 位短码（字符集去掉 I L O 0 1，全文档查重：id/bind/target 都算占用）。检查器「📋 复制 ID」一键复制；开关/压力板的 target 填电梯/睡莲的 bind 即完成绑定（电梯监听 `bind ?? target`，旧 target 兼容）。编辑器探针 `window.__pwEditor = { doc, state }`（只读，冒烟用）。
- **电梯/睡莲起终点化**：新字段 `ex/ey`（终点格坐标，电梯还支持 `endRoom` 跨房）；旧 axis/range/dx/dy 兼容。电梯 `off` 改二维向量 `moveToward(endOff|0)`；到站若 endRoom≠homeKey → `w.relocatePlayer(endRoom, 终点笼底)` 直接投递（无黑场，作为乘坐的一部分）。可反复乘坐：吐客 awaitExit（走出笼身重武装）+ 触发边沿 prevTrig。
- **尖刺物件化（改回）**：撤销"烙 ^ 进瓦片"方案——新 `SpikeRow` 实体（獠牙形尖刺+寒光尖+每格红色警示呼吸光），`w.spikeAtPx` 与 `checkPlayerHazards` 同时认瓦片 ^（老数据）和 SpikeRow；findSafeSpot 避开。老数据的 ^ 仍走瓦片渲染，新关卡用地刺物件。
- **可放置光物**：`candle`（壁烛）/`lamp`（吊灯）/`glowstone`（晶簇）/`fireflies`（萤火虫群）四个场景类物件，各带动画与自发光，颜色走材质（materialData 新增四键）。
- **材质发光真正生效**：world 光源收集改 for-each-entity：有显式 lights() 用之，否则**基础微光回退**——`mat(e.matKey)`（loadRoom 按 ObjDef.type 写入 Entity.matKey）的 glow/glowStrength，强度下限 0.12（所有物件都有一点存在感）。多态发光：Bud 休眠 0.3/盛开 1.0、Switch/Plate on=材质光、Wisp calm=材质光怒=橙。ring 等无 light 实体的 glowStrength 终于可调可用。
- **杂项**：bud/vinebud 材质合并（VineBud→mat("bud")，vinebud 键已删）；毒雾去掉描边框；苔藓回亮（0.22~0.56，呼吸 0.82）；编辑器工具合并——「放置/画笔」一体（palSel 决定：建筑瓦片=长按铺设，物件=点击放置），默认工具=选择/移动。
- **验证过**：尖刺物件杀伤、四光物加载带光、电梯重复触发（板踩住→上行→复位回程）、多步撤销×3、lens 全链路（上一批）——通过。**遗留（已闭环于第廿八批）**：用户数据 (2,0) vine(23,1) `lens:[3,0,4]` 的 0 当年按"钳为 1"处理；第廿八批起 0=在 [hMin,h] 随机，该数据合法且已实测生效（2.57 格）。 Undo 用户原始场景未能复现（多重现正常），若复现再查。

## 十八、血量 + 存档花（类银河恶魔城存档系统，2026-09-04 第七批）

用户需求："做类银河恶魔城（奥日）那样"——加入存档系统、三格血、幽魂改为掉血、血尽回存档点、存档点间可传送。美术风格不变。

- **三格血**：`Player.hp/maxHp`（`HP_MAX=3`）。HUD 左上角 3 颗像素小红心（空=暗壳）；debug 房间代号挪到 y=12。受击全屏红闪 0.45s（`hurtFlashT`，onHurt 回调驱动）。
- **两档受击**：① **硬危险**（尖刺/毒雾/坠落）走 `Player.hurt()`——掉 1 血进死亡演出（0.45s 粒子），位置重置逻辑不变：`finishRespawn()` 按血量分流，**hp>0 回 lastSafe（房入口安全点），hp=0 回存档花并回满血**（`checkpoint` 为 null 时回 SPAWN）。② **软受击**（游魂碰身）走新 `Player.hitSoft(world,kx,ky)`——掉 1 血 + `HURT_INVULN=1s` 闪烁无敌 + 原地击退（±95/-70），**不再送回房间入口**（`repelToEntry` 已删）；血尽同样转死亡演出回存档花。受击闪烁阈值改 `invuln>0.15`（原来 0.6 会让 1s 无敌后半段不闪）。
- **存档花 SavePoint**（entities.ts 尾部）：石座+茎+花，未激活=合拢暗苞（弱光 r7/0.3），激活=五瓣呼吸全开（材质光 r15/0.85±）+上升光屑。材质键 `savepoint`（materialData 新增，#3f8a70/aef0d8）。激活态存 flags：`sp:房号#序号`（随存档自动持久化）。
- **交互**：身旁 8×9px 内 `nearSave`；按使用键(J)（走 useBuf，优先于道具路由、清 saveJustUsed 防蔓豆误扎根）= **激活：回满血+设 checkpoint+登记传送落点+立即 saveGame**。已激活的花旁按 **S** = 开传送菜单（≥2 株才开）。
- **传送菜单**：`travelOpen` 冻结世界（同地图分支）；↑↓ 选、J/Enter 确认、Esc/K 取消（Esc 在 pause 分支最前面拦）。确认=复用黑场眨眼 fade 直达目标花落点（completeRoomSwap 顺带设 entry/lastSafe+saveGame）。HUD 面板列出房间代号，金点标当前房。
- **存档扩展**：SaveData v1 兼容追加 `hp/checkpoint{room,x,y}/spPos{flagKey→落点}`；spPos 键=存档花 flagKey。attune 时 checkpoint=玩家脚下位置（天然安全）。
- **摆放**（objects **末尾追加**，不动既有索引）：(1,0) 4,13 前厅 · (2,3) 5,13 西苔洞 · (2,4) 4,14 游魂巢 · (1,6) 4,12 井底——浅/中/深各一档。
- **编辑器**：palette「生命」类新增「存档花」（wisp hint 同步改为新行为）；render.ts 新增 savepoint 五瓣花示意图；ObjDef union 追加 `{type:"savepoint";x;y}`（注意 union 末成员才带 `;`）。exporter 序列化通用，无需改。
- **顺手修**：`beginDeath` 清 `pull`（死亡拉拽中残留会把重生后的玩家拖向旧房间钩环坐标——原有潜伏 bug）。
- **验证**：tsc + vite build 绿。游戏性未跑（等用户点名）；重点待验：软受击无敌窗、血尽跨房回花、传送菜单流转、(2,0) lens:[3,0,4] 依旧非法（用户数据，未动）。

## 十九、尖刺全物件化 + 存档花上图 + 地图选花传送（2026-09-04 第八批）

用户三点反馈的落实：①存档点标到地图上 ②传送改成打开地图面板选花 ③rooms.ts 里所有 `^` 瓦片清掉、一律用 spike 物件；另追问"编辑器里为什么不能编辑存档花"。

- **`^` 全部转 spike 物件**：rooms.ts 五处尖刺瓦片坑（2,0 / 0,1 / 1,1 / 1,4 / 0,4）→ 7 个 `{type:"spike",x,y,w}` 物件（追加到各房 objects 末尾，既有物件索引不动）；地图字符只剩 `#` 和 `.`。validate-rooms.ts 地图字符白名单去掉 `^`，另加 spike 物件越界/覆盖实心检查。编辑器 TILES 列表删掉 `^` 画笔。recordSafeSpot 改用 spikeAtPx（瓦片尖刺与 SpikeRow 物件都避开）。瓦片尖刺的引擎支持（Tile.Spike 渲染/判定/红光）保留作兼容，但数据里已不存在。
- **存档花上图**：buildWorldMap 烙标记——到访过的房间里，激活的花=亮绿 3×3 花芯、未激活=暗绿 2×2（标记序号=物件索引，与 flags 键一致）；attune 时置 mapDirty 即时变亮。普通地图查看（Tab）也能看到。
- **传送改走地图面板（取代 §十八 的文字菜单）**：已激活花旁按 S → openTravel() 置 `travelMode=true + mapOpen=true`（视野居中当前房）。updateTravelMap：方向键在 travelList（按 flagKey 排序的已激活花）里按方向象限跳最近一株（score = 正交偏移×100 + 前向距离），centerMapOn 平移视野跟随（钳制公式同地图查看）；J/Enter 确认→黑场眨眼直达；Esc（pause 分支最前）/Tab/K 取消。drawMap 传送模式下画呼吸光框圈住选中花+房号标签，底栏提示 ARROWS CHOOSE . J GO . ESC CANCEL。update() 里 travelMode 分支在 mapOpen 之前。
- **编辑器存档花实测**（playwright 实机验证）：调色板「生命类」有「存档花」按钮、点击可放置（pointerdown/up）、检查器出 x/y/缩放字段——**编辑器本身没问题**。用户"不能编辑"的根因＝浏览器里的编辑器页面是旧代码（本会话多次改 src 后页面没刷新/dev server 是旧进程）。
- **写回覆盖防护（新增）**：rooms.ts 已第二次被"编辑器旧内存文档保存"覆盖掉手改（本次丢了存档花布点，已重新补回）。saveToSource() 现在写回前 fetch `/src/data/rooms.ts?raw` 与 lastSource 比对（EOL 归一化），不一致弹 confirm 警告可取消。**用户务必：刷新编辑器页面（旧页面里点保存会再次覆盖！）**。
- **验证**：tsc + build 绿；编辑器放置/检查器实测通过。游戏内流程（S 开图选花/血尽回花/尖刺物件杀伤）未跑——等用户点名。

## 二十、泡泡跨房修复 + 编辑器瓦片 ghost 修复（2026-09-04 第九批，用户报 bug）

- **泡泡跨房消失（根修）**：黑场眨眼方案引入的回归。checkTransitions 在渐隐开始时把玩家钳回旧房边界内（y≥4），但骑着的泡泡不跟——"人站泡顶"相对位置被拉开 10px+；黑透换房后 completeRoomSwap 按（已钳位的）玩家位移平移泡泡，落点处骑乘判定（feet∈[top-3,top+5]）不再成立 → carrying=false，泡泡被丢在原地、玩家坠落。修法：夹持玩家时把 riddenBubble() 一起平移同样的钳位差（checkTransitions 内）。**探针实测通过**：(1,4) col4 竖井骑泡上升 → 跨入 (1,3) → 泡泡同行 riding=true 持续载人。注意：泡泡 BUBBLE_LIFE=8s，长井骑乘时间紧是原有手感值，与本 bug 无关。
- **编辑器 ghost 预览错位**：选过物件再选岩壁瓦片时，hover 预览仍画上一个物件（ghost 恒用 ui.placeType），落笔却是瓦片。修法：UIState 增加 palSel，render.ts 的 ghost 分支按 palSel.kind 分流——tile → 半透明瓦片色块（色取 TILES 表），obj → 原物件 ghost。main.ts frame() 传参补 palSel。
- **验证**：tsc + build 绿；两修复均实测（游戏探针 + 编辑器实机）。实测后 dev server 已清理。

## 二十一、坐标体系重构：location/end 语义坐标 + 全面去兼容（2026-09-04 第十批，用户定规矩）

**用户立的新规矩：以后所有新内容一律直接改写成新写法，不做任何旧写法兼容**。本次把坐标体系整体换掉：

- **新坐标 schema**：`ObjPos = { room_id: string; x: number; y: number }`（rooms.ts 导出）。x/y 是 room_id 房间内的相对格坐标。**所有物件的扁平 x/y 已删除**，统一 `location: ObjPos`；电梯/睡莲的终点统一 `end: ObjPos`（电梯 end.room_id 可填其他房间=跨房，替换原 endRoom/ex/ey）。rooms.ts 全部 153 个实例 + 类型 union 已转换（脚本按行转换，注释保留）。
- **兼容字段全删（游戏侧）**：LilyPad/PitcherElevator 构造函数重写为 `(pos: ObjPos, end: ObjPos, opts, homeKey)`——旧的 axis/range/dx/dy/ex/ey/endRoom/target 分支全部移除，触发统一走 `bind`（睡莲的"旧版触发（兼容）"字段不复存在）。电梯 endPt/endOff 由 end-location 直接算。loadRoom 全部走 `o.location`；跨房边界破门、地图存档花标记同步改。switch/plate 的 `target` 保留——那是现行语义（指向门 id），不是兼容字段。
- **编辑器**：FieldSpec 新增 `location` kind——检查器里 location/end 渲染为一行分组输入（room_id 文本 + x + y + 🎯 选点按钮），手填实时落进文档。**🎯 选点模式**：点房间画布=落点（room_id=当前房）；点小地图=切到那个房间继续选（跨房终点选法）；Esc/再点按钮取消。defaultsFor：location=放置格；end 缺省起点右 3 格。PlaceCtx 增加 roomKey。拖拽移动、vine⇄vinebud morph、hitObject（footprint）全部走 location。exporter serializeObject 支持嵌套对象（location: { room_id: "...", x: 1, y: 2 }）。
- **睡莲/电梯虚线 bug 修掉**：示意图的行程虚线原来画的是 axis/range（旧字段），用户改终点当然没反应——现在按 location→end 画虚线+终点落位框，电梯跨房时标注 `→ room_id`，实时跟随。
- **validate-rooms.ts** 同步 location 读取。当前校验有 7 个报错全是用户数据问题：(2,0) lens[3,0,4] 的 0、(2,4) 用户自加 vine lens[7,6,7] 超 h=3、(0,1) 长藤垂落区碰尖刺行——留给用户处理。
- **验证**：tsc + build 绿；实机探针：游戏各代表性房间实体全部按 location 正常加载（存档花/拾取/藤/门/开关/刺排/游魂）；编辑器放置睡莲→检查器分组输入→手填终点→🎯画布选点全链路通过，控制台无新错误。

## 二十二、旧页面覆盖事故恢复 + 写回 If-Match 硬护栏（2026-09-04 第十一批）

**事故**：用户用重写前的旧编辑器页面点了一次保存——旧内存文档（扁平 x/y schema + 旧 union）整体盖回 rooms.ts：新坐标体系全丢、4 株存档花丢失、房间注释整体右移一位（旧页解析 bug）、游戏因读不到 `location` 直接起不来。**恢复**：重跑 schema 转换（含用户新放的睡莲 ex/ey→end，在 2,4）、`^` 再转刺排、补回存档花、按 canonical 对照表修正 9 条房间注释。用户另一会话的改动（2,4 电梯+睡莲、游戏/编辑器多处修改）与新 schema 无冲突，全部保留。

**If-Match 硬护栏（防再犯，服务端强制）**：vite 中间件 `/__save/*` 现在要求 POST 带 `x-pw-base` = 目标文件磁盘内容的 sha1 前 12 位（GET `/__save/<name>` 可取 `{"hash"}`）。哈希不符或未带（= 旧页面/外部已改）→ **409 拒写**。编辑器（main.saveToSource + workshop.saveFile）保存前 GET 哈希、POST 带头；收到 409 明确提示"刷新编辑器页面"。旧版页面没有这段代码→不带 header→必被拒，**从机制上杜绝旧页面覆盖**。原 window.confirm 软确认方案已删除（被硬护栏取代）。⚠ 中间件改动需重启 dev server 生效。

**验证**：tsc/build 绿；curl 实测三态（错哈希 409 / 无头 409 / 对哈希 200）；编辑器完整保存往返一轮后 156 个 location 对象、存档花、用户睡莲/电梯全部无损（tsc+validator+游戏探针全过）。剩余 4 个校验报错全是既有用户数据问题（(2,0) lens 0、(0,1) 长藤垂落区碰刺排）。

## 二十三、房间 id 体系 + 光源类 + 触发语义统一 + 十四项打磨（2026-09-05 第十二批）

用户新规矩延续：不兼容旧写法。本轮：

- **房间 3 位唯一 id**：`RoomDef.id`（R01~R20，按 (cx,cy) 排序分配；新房间 doc.addRoom 自动取未占用号）。物件坐标 `room_id` 全部改为房间 id（不再是 "m,n"），`ObjPos.room_id` 语义=目标房间 id + 房内局部格坐标。游戏内部（寻路/转场/存档 flag）仍用网格键；电梯 end.room_id 经 `ROOM_KEY_BY_ID`（rooms.ts 导出）解析成网格键再投递。校验器查 id 3 位/唯一/room_id 可解析；机关 target 合法集合=门 id ∪ 电梯/睡莲 bind。
- **光源类（新分类）**：candle/lamp/glowstone/fireflies 移入 `light` 分类，统一带 `radius`（光照半径 px）与 `intensity`（亮度）属性，构造函数接 opts（留空用各类默认 14/18/12/12）。**位置即光源中心**。decor.ts 的程序生成 glowProps（凭空的萤火虫/蜡烛/晶石/吊灯）整体删除——场景光源全部来自编辑器摆放。
- **开关/压力板复位语义统一**：有 reset=可再触发（喂 TTL 脉冲）；**无 reset=一次性**：门走永久 flag + 触发总线挂 `TRIGGER_HOLD`（1e9 s）常驻——**永久开关从此也能遥控电梯/睡莲**（此前永久开关只开门不发脉冲=「开关对电梯无效」的根因之一）。**门跟随触发开合**：Door.open = flag ∥ triggerActive(id)，触发到期门自动长回（动画对称）；永久 flag 门收干净后仍会移除。
- **电梯可反复乘坐**：新增「呼叫」——角色站在另一端笼位上 0.35s，笼子自动回航接人（terminusWaiting 判定两端笼位）。prevTrig 改为任何 idle 帧都更新（riding 期间边沿不丢）。探针实测：起点乘→到站吐客→坠回底部→走回站台→自动回航→再乘坐 全链路 ✓；2,0 的 reset=1 开关→睡莲触发 ✓。
- **其它打磨**：天花藤摆幅收敛（阻尼 1.6→2.4、拨藤冲量 3.4→1.8、角速度上限 7→3.5、风力 0.22→0.09）；**lens 显式值=实际长度（忽略 h 上限）**（游戏/校验器/编辑器可视化三处同步）；花苞盛开视觉放大到与 24px 花台一致；**小树位置=树根**（编辑器 footprint 向上占位+示意图画根须）；编辑器电梯终点落位框改为笼口对齐 end 格（原低一格）；物品栏按钮删「装饰/交互」角标；场景类删「自定义物件/＋创造新物品」按钮；shroom 可悬空（校验提示移除）；**存档点传送改为 WASD 自由光标**——地图上逐格移动光标（视野跟随），压住存档花才能 J 确认，不再方向键瞬跳。
- **排障插桩**：__pw 增加 `title`（Title 实例）。标题门 Enter 探针必须 keydown+keyup 成对，否则 held 不释放、justPressed 不再触发（本次排障踩坑，非产品 bug）。
- **验证**：tsc/build 绿；游戏探针（电梯全链路、开关→睡莲、旅行光标跨图转移）；编辑器实机（光源分类、无角标、无 prop 按钮）。剩余 4 个校验报错=既有用户数据（(2,0) lens 0、(0,1) 长藤垂落区）。

## 二十四、实体 OOP 体系重构（2026-09-05 第十三批，用户架构提议）

用户提议的类层级已落地：**Entity（接口）→ BaseEntity（抽象基类）→ 分类次级基类 → 具体物品**。

- **BaseEntity**（entities.ts）：公共字段 x/y/dead/scale/matKey/homeKey + 环境相位 `protected t`（原先 14 个类各自 `private t = Math.random()*10`）+ 抽象 update/draw。26 个实体类全部继承（`implements Entity` 已绝迹；Entity 接口保留作类型标注，结构化兼容基类实例）。
- **三个次级基类**（只在有真共享逻辑处建）：
  - `LightSource`：candle/lamp/glowstone/fireflies——lum{r,k} 解析自数据的 radius/intensity，构造传默认半径。
  - `TriggerSource`：switch/plate——target/flagPrefix/triggerKey/reset + `on(w)`（瞬时=TTL 总线；一次性=flag）+ `fire(w,n,speed)`（一次性分支：flag + TRIGGER_HOLD 常驻脉冲 + openDoor + saveGame）。
  - `MoverPlatform`：lilypad/elevator——off 向量 + `moveToward(target,speed,dt)`（返回剩余距离）+ `carry(w,dx,dy,rect)`（平台搬人）。
- **ENTITY_TYPES 注册表**（entities.ts 尾部）：`type → (o: ObjOf<"type">, key, flags) => BaseEntity | BaseEntity[]`，ObjOf=Extract 判别收窄（每条工厂拿精确类型）；loadRoom 的大 switch 删除，剩 5 行查表循环；返回数组支持一格多实体（crumble）。**新增物品 = 写类 + 注册一行 + 编辑器 OBJ_SPECS 挂字段**。
- **注意**：抽象基类字段如 x/y/dead 与子类声明会撞 useDefineForClassFields 语义——子类不再重复声明这些字段；`Entity`/`Rect` 接口字段在脚本批量转换时曾被误删（已修复），再跑批量字段清理务必把接口块排除。
- **回归**：tsc/build 绿；探针——五房间实体计数、电梯乘坐/到站/呼叫回航/再乘坐、一次性开关 fire()（脉冲+常驻）全过。

## 二十五、上线前全面审查（2026-09-05 第十四批）

用户指令："全面核查代码文档等各种内容，完善功能的实现，修复错误和潜在的问题以及可能的屎山代码，持续迭代和核验，直到达到上线标准"。做法：本人深读游戏核心（entities/world/player/engine/title/decor）+ 两个并行审查代理分别扫编辑器（8 文件）与脚本/文档侧，全部发现汇总修复后用无头探针回归。

### 高危修复（游戏侧）

1. **loadRoom flag 键丢序号（§廿四 引入的回归）**：`factory(o, key, …)` 传了网格键而非 `k = "${key}#${i}"` → bud/vinebud/switch/plate/sp 的存档 flag 全部退化为 `bud:<房>` 无序号键：同房多花苞共享一键（吹一朵全房齐开）、同房双藤荚同砍同没、地图存档花"激活变亮"永不生效（地图标记查 `sp:<房>#<i>`，两套键互相不认）、softlock 回归断言的 `vinebud:2,0#2` 必挂。**修一行：`factory(o, k, this.flags)`**。副作用：BUG 期间的旧存档里无序号键不再匹配（花苞重闭合、花重变暗），上线前开新档即可。
2. **传送光标"开菜单即挪一格"（本批新功能自触发 bug）**：按住 S 开传送时 held("down") 仍为真，新加的连发计时器初始 0 → 下一帧就把光标挪走 → J 确认压不到花、传送看似失灵。修法：`travelArmed` 保险——开传送那一下方向键松开前不许连发。顺带保留"点按一格/按住 0.3s 后 16 格每秒连发"的手感。
3. **vite 写回中间件分块 UTF-8 解码**：`body += chunk`（chunk 是 Buffer）在 chunk 边界截断多字节汉字 → rooms.ts 中文注释可能被静默写坏（哈希护栏防不了写前损坏）。改为收集 Buffer 后 `Buffer.concat(...).toString("utf8")`。
4. **game 侧小修**：`hitSoft`（游魂碰身）补 `swing = null`（摆荡中被撞该掉下来）；LilyPad delay 态双重 if 简化（延迟途中触发取消→不出发）。

### 编辑器修复（审查代理报 24 项 + 探针追加 2 项）

- **【高】doc.validate 缺 "end 只有电梯/睡莲有" 守卫** → 当前数据报 156 条 `end.room_id 为空` 假错误，真错误全被淹没。照抄校验脚本的 continue。
- **【高】工坊「放置到地图」放不出 prop**：requestPlace 只设 placeType 不设 palSel，画布落点/ghost 都按 palSel 分流 → 点画布落的是上一次的调色板选择。已同步。
- **【中】lens 三处旧语义**：doc.validate 仍按 1~h 拒绝（空分支残留）、effH 钳 h；与游戏"显式值=实际长度"一致化（0→警告、>h 合法、混合数组取 max(h, 显式)）。校验脚本 validate-rooms.ts 同步（0=警告、垂落区降警告、条数>6 警告、混合 lens 有效长度、bind 只收电梯/睡莲、spike w 缺省按 1、location 越界 error、location.room_id≠本房 warn、lilypad end 跨房 error）。
- **【中】addRoom 封闭边框顶底敞开**（30 格大洞，保存即校验报错）→ 首末行全实心。
- **【中】工坊删光物件后没有保存按钮**，空 propData.ts 写不回去 → 保存按钮常驻。
- 死代码/陈旧清理：死工具 "brush"、`^` 尖刺分支 ×3（doc 字符集/状态栏/缩略图+画布）、buildTilePalette 空壳、KeyO 重复快捷键、EMPTY_COMMENTS 死导出、机关 bind 死字段（数据里 (2,0) switch 的 `bind:"4QDRZN"` 一并清掉，游戏从不读机关 bind）、doc `o.bind ?? o.target` 残留、prop 按钮高亮条件 `dataset.prop` 永假、场景类计数虚增、room_id 输入框 tooltip 还是 "1,0" 旧示例、hMin 警告文案与游戏行为不符、switch/plate reset min 0→1、工坊 propData 头注释与 mats 注释过时、vite 注释 "If-Match" 实为 x-pw-base。
- 性能：placeCtx()（gen6 全文档扫描+nextSeedId）原先每帧 60 次，改 refreshAll 时缓存。
- 保存链路：页面刚装载 probeChannel 未返回时 Ctrl+S 会带空哈希被 409 误报 → 保存前先 await 探测；409 stale 不再误置 channelOK（通道没坏，是内容过期）。
- 中间删除物件会在日志里警示"其后物件存档序号位移"（检查器常驻提示同步改写）。
- 编辑器 id 校验收紧为 `^[A-Z0-9]{3}$`；新增 location.room_id≠本房 warn。

### 文档对齐

- README：键位表改 K 跳/J 用 + 直选槽/地图/下穿/传送行；"14 房 3 道具"→"20 房 4 道具"；补血量/存档花/编辑器条目。
- CONTEXT.md：蔓豆词条改 v2 链条语义；新增 血量/存档花/猪笼草电梯/睡莲平台/悬浮荚/天花藤 词条。
- HANDOFF：§二 softlock 命令格式、§四 藤蔓丛（location+lens/hMin）与压力板（现行布点+触发语义）条目重写、§十五 校验面板描述对齐现状、§七 待办闭环（probe 文件已删、lens/垂落区降警告、部署状态）、头部日期。
- rooms.ts：清除机关身上的死 bind 字段（原位编辑，不动索引）。

### 验证（全绿）

- `npx tsc --noEmit` + `npx vite build` 绿；`scripts/validate-rooms.ts` ✓（3 条警告均为用户刻意保留：lens 0 钳 1 ×1、长藤垂落压岩 ×2）。
- `node scripts/release-audit-probe.mjs`（新增，13 项）：电梯实体/载人离站/终点再触发、睡莲吃脉冲/reset 滑回、存档花激活/S 开传送/J 确认黑场直达、If-Match 三态（无头 409/错哈希 409/对哈希同内容 200 且哈希不变）、无页面 JS 错误。
- `node scripts/release-audit-editor-probe.mjs`（新增，11 项）：写回通道探测、校验无错、放置/检查器 location 分组/Ctrl+Z、工坊新建→保存→放置到地图→画布落点→撤销→删除→空态写回（propData.ts 还原为 {}）、机关无 bind、无 JS 错误。
- **探针编写教训（又踩）**：绝不能 `fetch("/src/data/rooms.ts?raw")` 当原文 POST——HTTP 上拿到的是 vite 转换后的**模块包装代码**（`export default "<转义全文>"`），POST 回去会把 rooms.ts 整个写坏。本次靠 `JSON.parse` 字符串字面量逐字节救回（哈希比对原值一致）。编辑器侧无此问题（用编译期 `?raw` import）。两个探针脚本都写明了这条。
- 完整测试套件仍未跑（等用户点名）。

### 遗留（不阻塞上线）

- vite 写回的并发 TOCTOU（双标签同时保存）未加锁——单人本地工具，风险可接受。
- package.json deploy 依赖的 wrangler 未进 devDependencies（临时拉取，版本不锁定）。

### §廿五 补记（同日，用户四项反馈：rooms.ts 报错 / 校验 185 错 / 保存后回起点房 / 光源提亮）

- **导出器漏写房间 id（185 错根因）**：§廿三 给房间加了 id，但 `generateRoomsLiteral` 从不序列化 `id:`——用户第一次真实保存就把 20 个房间的 id 全剥掉，158 个物件的 room_id 全部"无法解析"，编辑器/校验器爆 185 错。已修：导出时写 `    id: "...",`。**数据恢复**：按各房物件 room_id 多数派生补回 20 个 id（与 (cx,cy) 排序的既定编号完全一致；3,3 无物件用排除法 R13）；修正 10 处回退成网格键的 room_id（id 缺失期编辑器回退填了 "2,0" 式键）；删掉 switch 上残留的旧 schema `dwell` 字段。用户新增内容（三台电梯、压力板、光源、开关改接 UYDJ26）全部保留。
- **保存后停留当前房间**：保存触发 vite 全页刷新，curKey 回退 SPAWN——已把当前编辑房间持久化 localStorage（`plantwell.editor.room`），启动时恢复。
- **editors 探针新增两条回归**：「保存后停留当前房间」「保存后校验仍无错误（id 未被剥掉）」。
- **同房电梯"伪跨房"投递（第廿五批 flag 键修复的次生 bug）**：`factory(o, k, …)` 把带序号键传给了电梯的 homeKey，`homeKey="2,0#40"` 永远 ≠ `endRoom="2,0"` → 同房电梯到站也走 relocatePlayer → **整个房间被重载、运行实体全变僵尸**。修法：工厂签名拆成 `(o, flagKey, flags, homeKey)` 两个键各司其职（flag 键带序号、homeKey 是网格键），电梯/四类光源工厂取 homeKey。此前 (2,4) 电梯探针没抓住它，是因为断言的绝对坐标在重载后仍然成立——**教训：引用型断言（`room.entities.includes(el)`）要进探针**。
- **光源类提亮**（用户点名）：默认半径 蜡烛14→18 / 吊灯18→24 / 晶石12→16 / 萤火虫12→16，强度 0.9→1.15 / 0.85→1.1 / 0.7→1.0 / 0.5→0.7；绘制加 lighter 光晕（烛焰摇曳晕、灯下光池、晶石呼吸晕、萤火虫增亮）。数据里显式 radius/intensity 仍优先生效。
- **外部回退警告**：修复过程中 entities.ts 被外部改回旧版（提亮全部丢失，其余文件未受影响）——疑似 IDE 旧缓冲区覆盖。已重做。**改代码期间请勿让闲置的编辑器缓冲区自动覆盖 src/ 下的文件**（与编辑器旧页面覆盖 rooms.ts 是同一类事故）。
- 验证：tsc/build 绿；校验器 ✓（3 条既有警告）；游戏探针 13/13；编辑器探针 13/13。

### §廿五 补记 2（同日，用户四项新需求：电梯单程 / 多对多绑定 / 右键平移跨房编辑 / 绑定点选 UI）

**游戏机制改动**
- **电梯改单程**：删掉「乘客等待自动回航」（terminusWaiting/callTimer）与「开关无客往返」（autoBack）。现在：笼子停在哪端，玩家走进笼口就从哪端出发，到另一端吐客后**停住**；开关触发=无客单程一趟，到端停住。要回程就再乘坐或再触发。数据注释与编辑器 hint 同步。
- **绑定多对多（新 schema，直接改写不兼容）**：`switch/plate` 的 `target/bind` 字段删除，改 **`controls: string[]`**（它触发的 binding id 列表）；`door`/`elevator`/`lilypad` 增 **`triggeredBy: string[]`**（触发它的开关/压力板 flagKey `房#序号` 列表）。触发分派收口在 `world.fireControls(controls, kind, reset)`：门=一次性写 flag 永久开 / 配 reset 走 TTL（到期门自动关）；载具=只喂边沿脉冲（TRIGGER_HOLD 或 reset）。`BINDING_KIND`（rooms.ts 导出）按 binding id 查种类。多个开关控同一物件、一个开关控多物件都天然支持。
- 数据迁移：4 个既有机关改 controls、2 台电梯 + 2 扇门补 triggeredBy（对称）。
- 校验器（validate-rooms.ts 与 doc.validate 同步）：binding id 全集=门 id ∪ 载具 bind、controls 引用存在性、triggeredBy 指向真实触发方、双向对称性警告；旧 target 校验删除。

**编辑器改动**
- **跨房编辑**：渲染器加世界相机（camX/camY + centerOnRoom），画布一次显示视野内多房间（当前房亮、邻房淡显）；`toWorldTile` 按世界坐标命中"哪个房间的哪格"。**右键/中键拖动=平移画布（右键橡皮已删，橡皮走工具栏）**；物件放置/选中/拖动/绑定点选都可落在视野内任意房间（瓦片画笔/矩形/橡皮仍限当前房）；拖动物件跨房会更新 location.room_id。当前工作房持久化（保存刷新后停留原房间）。
- **绑定点选 UI**：检查器新增 `binding` 字段（触发方=controls 列表、被控方=triggeredBy 列表，每项带 ×）+「🔗 绑定」按钮。点按钮进点选模式→画布上点配对物件（可跨房）=**双向绑定同时写两端**；任意一端发起皆可；× =**双向解除**；点空白/Esc 取消。载具无 bind 时绑定瞬间自动分配。switch/plate 的 target/bind 字段从检查器与调色板移除。
- **【根因】exporter 数组序列化修复**：`serializeObject` 原来数组用裸 `join(", ")`——字符串元素永带不上引号，**编辑器每次保存都会把 rooms.ts 写成语法错误**（`controls: [UYDJ26]`）。改为逐元素 `JSON.stringify`（空数组省略）。此前 rooms.ts 反复出现"数组没引号"就是它 + bash 内联转义脚本两层叠加；**以后改数据一律用文件脚本**。
- render：switch/plate 示意图标签改显示 controls 列表（原 o.target 恒 undefined）。

**探针**：编辑器探针 18 项（新增：被控端绑定按钮存在、双向绑定写入两端、× 双向解除、撤销还原——全部真实画布点击）；游戏探针 13 项（场景 1/2 改单程语义：载客到站不回航、开关脉冲单程到端停住）。**教训补充**：page.evaluate 的回调在浏览器执行，Node 侧变量必须作参数传入（本次踩了 3 次）。

**验证（全绿）**：tsc / vite build / validate-rooms（3 条既有警告）/ 游戏探针 13/13 / 编辑器探针 18/18。完整测试套件仍未跑（等用户点名）。

### §廿五 补记 3（同日，用户三项反馈：绑定 id 统一 / 无存档复活 / 藤蔓物理）

- **绑定属性名统一为 `id`**：电梯/睡莲的 `bind` 字段删除，全部可绑定物件（门/开关/压力板/电梯/睡莲）统一用 **`id: string`**（6 位唯一短码，gen6 同字符集，全文档两两不同）。开关/压力板补上了自己的 id（此前没有——被控方 triggeredBy 无法记录它们）。数据迁移：4 个机关生成新 id（T2VKQP/M8XR4D/H7NW2S/Q5JG9B）、2 台电梯+1 睡莲 bind 改名 id、triggeredBy 全部从 flagKey（"房#序号"）换成触发方 id。**triggeredBy 的语义从"触发方列表序号"改为"触发方 id"——列表重排不再影响绑定**（顺带修掉了序号引用的脆弱性）。TriggerSource 存档 flag 键也从 `switch:房#i` 改为 `switch:<id>`（旧档 flag 失效，上线前无所谓）。游戏侧 LilyPad/PitcherElevator 构造器、Switch/PressurePlate、ENTITY_TYPES、BINDING_KIND、编辑器（palette 字段表/tryBind/unbind/placeObject 分配 id/copyId/render 标签/doc.validate/校验器）全链同步；探针断言同步（triggeredBy 回写断言改为触发方 id）。
- **无存档血尽回出生点房间**：finishRespawn 的 bug——checkpoint 为 null 时只传送 SPAWN 坐标但**不 loadRoom**，人会"在当前房间原地复活"。已修：checkpoint 为 null 时显式 loadRoom(SPAWN.room)。探针新增场景（1,6 清 checkpoint 自杀 → 断言落在 2,0 且满血）。
- **藤蔓物理（靠近永动/幅度过大）**：根因是拨藤冲量里的**方向常量项** `(player.x < sx ? 0.28 : -0.28)`——玩家只要在判定盒附近（哪怕站着不动）每帧都被充能，藤永远停不下来且迅速打满角速度上限 3.5。修法：冲量只与横向速度成正比（`player.vx * 0.02 / len`，静止=零冲量），上限 3.5→1.8，环境微风 0.09→0.06。走近拨一下会摆、停几秒内阻尼收稳。
- 探针：游戏 14 项（+无存档复活场景）、编辑器 18 项（绑定断言改 id 口径）。
- 验证（全绿）：tsc / vite build / validate-rooms（3 条既有警告）/ 游戏探针 14/14 / 编辑器探针 18/18。完整测试套件仍未跑（等用户点名）。

### §廿六、用户八项需求（2026-09-05 深夜批次）

1. **ROOMS 数组化**：数据真身改为 `export const ROOM_LIST: RoomDef[]`（RoomDef 新增 `x/y` 网格坐标字段），"m,n" 字符串键不再是数据形态；尾部派生 `export const ROOMS = Object.fromEntries(ROOM_LIST.map(...))` 供游戏/编辑器内部索引（loadRoom/checkTransitions/存档 flag 等内部机制零改动）。编辑器三件套（parseSourceComments/generateRoomsLiteral/spliceRoomsSource）适配数组形态：锚点 `export const ROOM_LIST`、元素解析 id/x/y 推导网格键、写回含 x/y。
2. **编辑器校验错误**：实测 doc.validate 只剩 3 条既有数据警告——用户看到的错误是 rooms.ts 坏文件时期的产物（数组无引号），根因（exporter 裸 join）已在前一批修复。
3. **id 只读展示**：五类可绑定物件（门/开关/压力板/电梯/睡莲）的 id 在检查器中渲染为只读徽章（FieldSpec 新增 `readonly`，id 由放置/绑定自动分配）。
4. **压力板离开才计时**：可复位压力板（配 reset）踩着期间每帧续期触发 TTL，**离开板面才开始倒计时**；刚踩上播一次音效/粒子。
5. **存档点突出**：未激活也有呼吸地面光环+光屑+苞尖亮点（光 r11/0.55 呼吸）；激活光环更大更亮（r18/0.95）。
6. **传送地图四项**：光标连发加速（按住 ≈28 格/s）；**视野贴边跟随**——光标在视野内侧舒适带内不滚动，出带才把 pan 目标连续推移，实际 pan 每帧 0.3 插值（不再瞬跳、不再强制居中）；QE 缩放可用；传送黑场过场加长到 0.32s（fade 结构加可选 dur）。旧 centerMapOn 删除。
7. **骑泡跨房下坠修复**：checkTransitions 的边界夹持在骑泡时跳过（骑泡越界是行程的一部分，夹持才是"突然下坠"的来源）。探针 `scripts/bubble-cross-probe.mjs`：(1,4)col4 竖井骑泡升入 (1,3)——跨房前 0 下坠、骑乘保持、满血。
8. **跨房电梯重做**：
   - **旧实现是错的**：endOff 忽略 end.room_id（把目标房局部坐标当本房算），笼子飞到错误长度后 relocatePlayer 瞬移玩家。编辑器虚线同理只画本房相对坐标。
   - **新实现**：endOff=端到端世界向量（含邻房网格偏移），笼子真实飞越边界；越过边界的瞬间 `world.handoffElevator` loadRoom 目标房+笼子 adopt（off 平移房间差）进驻新房实体表，行程无缝继续；到站吐客即目标房本地坐标。回程（back）对称地迁回出发房。
   - **riding 屏蔽换房**：world.update 里 `if (!this.hidePlayer) checkTransitions()`——笼子锁人飞越边界期间玩家坐标越界是行程的一部分。
   - **编辑器跨房虚线**：drawObj 增加 doc/roomKey 上下文，end.room_id 定位目标房网格，虚线+终点框越过边界画进邻房。
   - **back 属性**：`{ back?: boolean }`（默认 false）。true=送客到站（出舱后）1s 空笼沿原路返回（跨房时在边界迁回出发房）。编辑器 FieldSpec 新增 `bool` 类型（checkbox），elevator/lilypad 检查器可勾选。
   - **滚轮缩放锚定鼠标**：renderer.zoomAt(mx,my,dir)——滚轮下的世界点缩放前后不动，缩放不再带平移错觉。
- **验证（全绿）**：tsc / vite build / validate-rooms（3 条既有警告）/ 游戏探针 14/14 / 编辑器探针 18/18（含新导出器保存往返）/ 骑泡跨房定向探针 ✓。
- **注意**：ROOMS 数组化后 rooms.ts 无 "m,n" 键——脚本/工具若按旧键解析需改读 ROOM_LIST 或派生 ROOMS。存档 flag 的 `房#序号` 序号=ROOM_LIST 顺序索引（ROOMS 派生顺序一致），既有存档不受影响。

## 廿七、多地图系统（第七次刷新：用户两项需求）

**需求原文**：①给编辑器中的世界小地图也加上右键按住移动（要做一个很大的世界）；②改进编辑器和关卡系统——可创建多张不同游戏地图（把当前 rooms.ts 提炼出来就是一张图）、可创建/导入/导出地图、编辑器中可设置游戏采用哪张地图；游戏内"跨大地图传送"只留心不做（现阶段只玩指定单张图）。

### 数据层（src/data/maps.ts，替代已删除的 rooms.ts）

- **MapDef** = `{ id, name, spawn: {room(房间id), x, y(房内像素)}, rooms: RoomDef[] }`。一张地图=一个完整可玩世界。
- **MAP_LIST**：数据真身（当前只有 M01"古井"，原 rooms.ts 全部内容提炼为它的 rooms，字节级无损搬迁）。
- **GAME_MAP_ID = "M01"**：游戏采用哪张图。编辑器「★ 设为游戏地图」保存时改写。
- **尾部派生段（游戏运行时只消费这一段，手工别改）**：`GAME_MAP`（按 GAME_MAP_ID 查，兜底第一张）→ `ROOM_LIST`（=GAME_MAP.rooms）→ `ROOMS`（网格键索引）/`ROOM_KEY_BY_ID`/`BINDING_KIND` 同旧；`SPAWN`（spawn.room 的房间 id **换算成网格键**，world.ts 零改动；房间 id 解析不到会 throw，数据错误启动即炸）；`SEED_TOTAL`（=本图源种最大编号，HUD 槽位数）。
- **写回区域**：`export const MAP_LIST` 行起、`export const GAME_MAP_ID` 行止（exporter.spliceMapsSource），其余字节原样保留（含派生段）。

### 编辑器（doc.ts / exporter.ts / main.ts / editor.html）

- **doc.ts**：`maps: MapRec[]` + `editMapId`（正在编辑）+ `gameMapId`（★）；`doc.rooms/doc.keyOrder/doc.spawn()` 全是**指向当前编辑图的 getter**（spawn() 把出生房 id 换算回网格键，渲染/小地图零改动）。地图级 API：`addMap()`（M## 顺延+封闭起始房+出生点）/`deleteMap()`（最后一张不可删；删游戏图自动转移★）/`renameMap()`/`setGameMap()`/`switchMap()`（写入 localStorage `plantwell.editor.map`）/`setSpawnRoom()/setSpawnPos()`/`exportMap()`/`importMap()`（JSON `{kind:"plantwell-map",version:1,id,name,spawn,rooms}`；id 撞车顺延、无效房丢弃计数、出生房失效兜底第一房）。撤销快照=整文档（含全部地图+两个 id 指针），跨图操作可整体回退。校验新增：地图 id 2~4 位大写数字/唯一、GAME_MAP_ID 必须存在、每图出生房可解析、出生像素越界 warn、编辑图≠游戏图 info 提示；源种改查编号非法/重复（不再对全局 SEED_TOTAL 查范围）。
- **exporter.ts**：`parseSourceComments` 按缩进区分层级（地图元素缩进 2、房间元素缩进 6）解析地图头/房间头/物件行内注释（键 `${mapId}::x,y`）；`generateMapsLiteral` 生成整块；`spliceMapsSource` 按上述区域拼接。**保存链路换路由**：`POST /__save/maps`（vite.config.ts SAVE_ROUTES "/maps"→"src/data/maps.ts"），saveHash 键 rooms→maps，probeChannel 探测 routes=["maps","materials","props"]。
- **main.ts / editor.html**：顶栏地图簇（`#mapSelect`+`#mapNew`+`#mapImport`+`#mapExport`+`#mapGame`★+隐藏 `#mapFile`）；「房间」页地图区（`#mapName` 改名、`#mapSetSpawn` 出生点→本房、`#spawnX/#spawnY`、`#mapDelete`）；`applyEditMap()` 切图后工作房失效即落回该图出生点房；工作房按 `"图id|房键"` 持久化。绑定 id 全文档（跨图）查重；`__pwEditor.state` 新增 `map/gameMap/maps/mm`。
- **世界小地图**：固定视口（≤248×168）——世界装不下时**右键/中键拖动平移**（`mmX/mmY` 视口偏移，钳制 ±8px 出血；世界小于视口则强制居中不可拖），左键点选切房不变，`mmEnsureVisible` 在切房/切图时把视口滚到当前房居中。

### 游戏侧

- world.ts / entities.ts / decor.ts 的 `from "../data/rooms"` 全部改 `from "../data/maps"`——**消费的导出名（ROOMS/SPAWN/SEED_TOTAL/ROOM_KEY_BY_ID/BINDING_KIND/RoomDef/ObjDef/ObjPos）一个没变，游戏逻辑零改动**。游戏内跨图传送未做；MapDef.id 即未来钩子。

### 验证（全绿）+ 踩坑

- tsc / vite build / validate-rooms ✓（3 条既有警告）；游戏探针 14/14；编辑器探针 18/18；骑泡跨房 ✓；**新探针 `scripts/multimap-probe.mjs` 20/20**（新建/改名/导出→真实文件导入往返/切图回 M01/小地图右键拖动+左键点选/★设 M02+保存落盘 GAME_MAP_ID/游戏页出生在 M02 (0,0)(160,86)/清理恢复原文件+哈希一致）。
- **探针教训（又添两条）**：①探针中途崩溃会留下"已保存未清理"的脏 maps.ts——无 git 兜底时只能写过滤脚本按缩进 2 抠块恢复（本次 repair 后 `];` 也被过滤掉，二次修复才对）；②编辑器点保存后 maps.ts 变更冒泡到入口→**编辑器页全页刷新**（dataBridge 的 accept 只拦自己，拦不住依赖的 maps.ts），探针必须 `waitForFunction(__pwEditor)` 重建后再 evaluate；③玩家出生 y=90 会物理落体到 86 站稳——位置断言要留落地容差。
- **注意**：所有引用 rooms.ts 的脚本/探针/文档均已改指 maps.ts 或 /__save/maps；`?raw` 警示注释同步。rooms.ts 不复存在（无兼容层，直接改写）。

## 廿九、地图数据 JSON 化（第九次迭代：用户需求）

**需求原文**：能不能把地图的数据用 json 或者别的什么方法保存，而不是直接写到 ts 当中，毕竟可能会有很多张地图。

### 存储布局（第廿九批起）

```
src/data/
  maps.ts            类型定义（MapDef/RoomDef/ObjDef/ObjPos/SpawnPoint，手写）+
                     派生索引：import.meta.glob("./maps/*.json", {eager:true}) → MAP_LIST →
                     GAME_MAP/ROOM_LIST/ROOMS/ROOM_KEY_BY_ID/BINDING_KIND/SPAWN/SEED_TOTAL（游戏消费的导出名一个没变）
  gameMap.json       {"gameMapId": "M01"} —— 游戏采用哪张图（编辑器★写）
  maps/M01.json      一张图一个文件；内容 = 编辑器导入/导出的同一格式
                     {kind:"plantwell-map", version:1, id, name, spawn:{room(房间id),x,y}, rooms:[...]}
```

- 图多了 = 目录里多几个 JSON；新建/删除 JSON 文件后 dev server 自动感知（glob 是编译期收集，vite 会触发重载）。手编数据 = 直接改 JSON（编辑器外改过就要刷新编辑器页面，哈希护栏会拦旧页面保存）。

### 保存通道（vite.config.ts 中间件）

- `GET/POST /__save/map/<ID>`：读哈希 / 写单图（ID 白名单 `^[A-Z0-9]{2,4}$` 防路径穿越；文件不存在时哈希返回空串、POST 空基=允许创建）。
- `DELETE /__save/map/<ID>`：删图文件（同样过 x-pw-base 护栏；文件已不在=幂等 200）。编辑器删「保存过的图」时调用。
- `GET/POST /__save/game`：gameMap.json（只存 gameMapId）。
- materials/props 路由不变（还是 TS，由工坊生成）。
- 编辑器保存 = **只写与装载基线不同的文件**（doc.baseJson 逐图比较 serializeMap 输出；gameMapId 变了才写 game）；409 只拒相应文件并汇总报错，成功的照常落盘。这意味着「没改动时点保存」不写任何文件。

### 编辑器侧

- exporter.ts 缩成两个函数：`serializeMap`（一张图 → JSON 文本，存储/导入/导出/脏比较四用）+ `downloadText`。**TS 字面量生成、注释解析、源码拼接（parseSourceComments/generateRoomsLiteral/spliceRoomsSource 一族）全部退役**——JSON 无注释，当初为注释保留 TS 的理由不复存在。
- doc.ts：`baseJson`（各图装载基线）/`baseGame` + `dirtyMapIds()/gameDirty()/markBasesClean()`；`exportMap()` = `serializeMap(curMap())`。
- main.ts：`probeChannel` 探测 game+每图+materials+props 的哈希；`saveToSource` 按脏文件逐个 POST；「复制」按钮 = 复制当前图 JSON；删图联动 DELETE 文件；**删物件联动清理双向绑定引用**（删被控方→各触发方 controls 摘掉它；删触发方→各被控方 triggeredBy 摘掉它）。
- validate-rooms.ts（Node 环境跑不了 import.meta.glob）改为 **直读 JSON** + 本地重算派生（ROOMS/SEED_TOTAL）。

### 踩坑记录

- **外部会话/IDE 并发改写**：maps.ts 在本批改造中途被外部覆盖回「新头+旧内联 MAP_LIST」的混合体（此前 entities.ts 也发生过一次）——**改代码期间请关掉闲置的编辑器缓冲区/其他会话**。同批发现 M01 数据里 plate M8XR4D 的 controls 指向已不存在的电梯 54JW9S（迁移前就被删了）——已清掉悬空引用，编辑器从此删物件会自动清绑定。
- dev server 端口竞态：旧进程没死透时新 vite 会 **漂到 5200**——重启务必确认旧进程已退（或像本次用 `--strictPort` 让它直接报错）。
- resetFromSource 重写时曾漏掉 `this.editMapId = GAME_MAP_ID;`，editMapId 停留在字段初值 ""（curMap 的兜底让大部分功能看着正常，探针抓住）——**改 EditorDoc 构造路径时对照 state.map 断言**。

### 验证（全绿）

tsc / vite build / validate-rooms（3 条警告：垂落压岩×2 + plate M8XR4D controls 为空=实情）/ 游戏探针 14/14 / 编辑器探针 18/18（保存往返已按新路由）/ 多地图探针 20/20（断言 gameMap.json 落盘、三张图三个文件、fs 还原清理）/ 骑泡跨房 ✓。

## 卅、跨房电梯真正修复（第九次刷新：用户报告"视角滞留/入口卸客/电梯消失"）

**用户报告**：随电梯到另一个房间时视角还停在当前房间，过一会突然切换、角色停在目标房间**入口**（不是电梯终点）且**电梯原地消失**。用户猜的两个方向（骑乘时不检测换房 / 新房间数据里没电梯）——第二个方向撞对了根因，但机制比想的深：**第廿六批的 handoff 实现有三处致命错误，跨房乘坐从来没真正工作过**（同房电梯探针测不到它）。

### 三处错误 + 两处连带（全部修复）

1. **handoff 触发阈值指向"目标房原点"而不是"边界"**：`sumX*sign(endShift) >= |endShift|` 对向左的行程等于要求 `sumX <= -320`（整整一屏之外），而行程终点 sumX 只到 -40——**永不触发**。笼子带着人飞完全程（房间还是出发房、视角不动），吐客后普通 checkTransitions 才启动→玩家被映射到边界口→新房间数据里没电梯→原地消失。**修复**：阈值=笼身**完全越界**（横向 `sumX <= -TILE` / `sumX >= ROOM_W`，纵向 `sumY <= -2*TILE` / `sumY >= ROOM_H`，按行进方向取）。
2. **adopt 换坐标系后行程目标没换算**：goal 永远是出发房坐标的 endOff/0——即使 handoff 触发，笼子也会在目标房坐标系里飞反方向。**修复**：新增 `goalNow()` 按段取目标：去程未迁= endOff / 已迁= endOff-endShift；返程未迁= -endShift / 已迁= {0,0}。
3. **回巢时 loadRoom 重建出"数据原件"**：返回 handoff 的 loadRoom 会把同一台电梯按数据重建一遍，与 adopt 回来的笼子**重叠成两只**；新实例 prevTrig=false，若触发仍在有效期会立刻幽灵发车（探针的 1e9 TTL 下=无限穿梭）。**修复**：handoffElevator push 前过滤同 id 的其他电梯，只留 adopt 回巢的这只。
4. **back=true 空笼送达也装填返程**：第卅批早先把 returnTimer 加到"空笼送达"分支时没限定端点——**回到原点的到达也装填**→无限往返（探针的强制登乘被拖着跨界触发 fade 换房、笼子孤儿化，就是它）。**修复**：两个装填点都加 `this.end === 1` 门控（只在送达远端时返回，语义="送到对面后回来原地等"）。
5. **handoffElevator 的乘客坐标平移**：只在 `el.carrying` 时平移（空笼行程不动出发房的玩家——此前的无条件平移会把玩家推出边界引发连锁换房）。

### 现在的正确行为（探针 16 项逐条验证）

开关触发空笼：发车→**笼身完全越界的瞬间** loadRoom 目标房+视角切换（`cx` 在 moving 中翻转）→停在最末格→1s 后返程→越界瞬间切回→停回原格。载人：玩家进笼口被吞（hidePlayer）→笼子锁人飞越边界（ riding 屏蔽 checkTransitions，handoff 负责换房+乘客坐标同步平移）→到站吐客**在电梯终点**（不是房间入口）→电梯在新房间继续存在可再乘坐。

### 基础设施

- **新探针 `scripts/elevator-cross-probe.mjs`（16 项）**：几何 sanity / 发车 / 切房时机（cx 翻转时 state 必须仍是 moving）/ 空笼到站位 / 电梯存活 / back 返程回巢 / 自然落体登乘 / 载客穿越 / 终点卸客（笼底中心）/ 二次返程。**健壮性**：每步采样校验 game 态——其他会话并发改 src 触发 vite 整页重载时自动重开机重跑（最多 3 次）。
- **world.loadRoom 换房日志（debug 态）**：`w.debugLog`（cap 60）记录每次 loadRoom 的时间/目标/调用栈来源 + `handoffElevator` 入口日志。探针可直接 dump 定位"谁换了房"。本次靠它抓到 completeRoomSwap 抢跑。

### 补记（第卅二批：空笼返程拖走世界）

用户报告：back 笼回到出发房时角色瞬移回去。根因：handoffElevator 对空笼也无条件 loadRoom。现行为：**载客=世界跟着笼子走；空笼=玩家的世界纹丝不动**——空笼跨界后挂 `world.detached: PitcherElevator[]`（世界级列表，update 照常跑，draw 按其 homeKey 与当前房的房间差平移绘制，跨界时自然出入画面边缘）；其 homeKey 房间被 loadRoom 时自动归位进该房实体表（同 id 数据原件让位）。detached 状态跳过登乘检测（拿玩家坐标跨房系比较无意义且可能误吞）。探针 16 项重写覆盖该场景。

### 探针教训（新增）

- **强制登乘别硬写 vy/grounded**：每帧 `vy=0` 让玩家永远悬空落不了地，grounded 恒 false、boarding timer 永不积累——正确姿势是只钉横向坐标，纵向让物理自然落到笼口区的地板上。
- **浮点阈值**：0.667px/帧的移动恰好落在 `sumX = -9.9999999`（阈值 -10 的浮点上侧）——阈值判断写 `<=` 且下一帧必过，但如果实体因其他原因（fade 换房孤儿化）不再更新，就会永久冻在阈值上一根头发丝的位置。看到"冻结在阈值上"先查孤儿化，再查浮点。
- **探针中间态崩溃会污染数据**（第廿七批教训重演）：本轮 debugLog + 逐帧历史 dump 是定位"孤儿实体"的最快路径——直接把 `w.debugLog` 和逐帧 `cx|state|off|handedOff|电梯数` 打进断言的 extra 里。
