// 全局常量。物理量单位：像素 / 秒（逻辑步恒为 1/60，见 engine/loop.ts）。
// 跳跃数值是设计好的：起跳速度 224、重力 980 → 跳跃顶点 ≈ 25.6px ≈ 2.5 格。
// 这意味着"能跳上 2 格台阶、跳不上 3 格"——所有谜题的身高都按这条规则设计。
export const TILE = 10;
export const ROOM_COLS = 32;
export const ROOM_ROWS = 18;
export const ROOM_W = ROOM_COLS * TILE; // 320 = 屏幕宽，房间即一屏
export const ROOM_H = ROOM_ROWS * TILE; // 180

export const GRAVITY = 980;
export const MOVE_SPEED = 72;
export const GROUND_ACCEL = 900;
export const AIR_ACCEL = 520;
export const FRICTION = 1100;
export const JUMP_VEL = 224;
export const JUMP_CUT = 0.35; // 松开跳跃键时保留的上升速度比例（可变跳高）
export const COYOTE_TIME = 0.08; // 离开边缘后仍可起跳的宽限
export const JUMP_BUFFER = 0.1; // 落地前按下跳跃的预输入宽限
export const USE_BUFFER = 0.15; // 使用道具的预输入宽限：转换/受击期间按下的 K 不丢失

// ---- 血量与存档点（类银河恶魔城式惩罚循环）----
export const HP_MAX = 3; // 血量上限：受伤掉 1 格，血尽回存档花
export const HURT_INVULN = 1.0; // 软受击（游魂碰身）后的闪烁无敌时长（秒）
export const TRIGGER_HOLD = 1e9; // 一次性开关的常驻触发：压力/开关无 reset 时给触发总线的超长 TTL
export const MAX_FALL = 250;

export const PLAYER_W = 6;
export const PLAYER_H = 8;

// 动作 → 判定半径等调参
export const WHIP_SWEEP_REACH = ROOM_W / 2; // 藤鞭最长长度（屏宽一半）
export const WHIP_GROW_TIME = 3; // 按住后鞭长从初始长到最长的秒数（线性增长，之后保持）
export const WHIP_START_LEN = 10; // 藤鞭初始长度（松手再按从这重新长起）
export const WHIP_SPIN_RATE = 16; // 旋转角速度 rad/s（≈2.5 圈/秒，快但残影+鞭梢光能跟上）
export const RING_GRAB_RADIUS = 6; // 鞭身扫过钩环多少像素内算"挂上"
export const SWING_LENGTH = 18; // 摆长（挂上之后固定不变）
export const FLUTE_RADIUS = 70; // 孢子笛作用半径
export const BUBBLE_RISE = 16; // 泡泡被踩着时的上升速度
export const BUBBLE_LIFE = 8; // 泡泡寿命（秒）：静止漂浮可当平台/护罩原料
export const BUBBLE_DOOM = 0.5; // 召唤第二个泡泡后，前一个泡泡延迟破裂的宽限（秒）
export const SHIELD_LIFE = 2.5; // 泡泡罩身时长
export const SHIELD_SPEED = 55; // 罩身泡泡的水平飞行速度
export const WHIP_PULL_SPEED = 240; // 锁定钩环后把角色拉过去的速度
export const BOUNCE_VEL = 330; // 蹦菇弹起速度（≈5.5 格，比跳高两格多）
export const SWING_OMEGA_MAX = 9; // 摆荡角速度上限 rad/s（切向 ≈162px/s，泵摆能荡得飞快）
export const BEAN_MAX_TILES = 15; // 蔓豆茎总长度上限（格，含根节）
export const BEAN_GROW_INTERVAL = 0.5; // 长按方向键时的生长速度：1 格 / 0.5s
export const BEAN_HOLD_TIME = 0.3; // 长按使用键扎根所需的时长（点按则是取消）
export const BEAN_LIFE = 18; // 蔓豆茎存活秒数，到时枯萎
export const BEAN_PARK_TIME = 5; // 离开豆茎所在房间后的停泊时长（秒）：期内返回则继续保留
export const CRUMBLE_SHAKE_TIME = 1; // 悬浮荚被踩后到碎裂的时长（秒）
export const CRUMBLE_REGROW_TIME = 3; // 悬浮荚碎裂后到重生的时长（秒）
export const CLIMB_SPEED = 70; // 攀爬藤茎的速度
export const MAP_ZOOM_MIN = 1; // 地图缩放档位（QE 调整）
export const MAP_ZOOM_MAX = 4;
