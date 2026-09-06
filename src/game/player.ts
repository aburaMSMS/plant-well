// 玩家"种子"：移动、跳跃、摆荡、泡泡罩、受击重生。
// 物理全部用固定步长（1/60s）下的 px/s 积分——见 constants.ts 顶部的跳跃设计说明。
import type { Input } from "../engine/input";
import type { Rect, Ring } from "./entities";
import {
  AIR_ACCEL,
  CLIMB_SPEED,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_BUFFER,
  JUMP_CUT,
  JUMP_VEL,
  COYOTE_TIME,
  HP_MAX,
  HURT_INVULN,
  MAX_FALL,
  MOVE_SPEED,
  PLAYER_H,
  PLAYER_W,
  SHIELD_LIFE,
  SHIELD_SPEED,
  SWING_LENGTH,
  SWING_OMEGA_MAX,
  WHIP_GROW_TIME,
  WHIP_PULL_SPEED,
  WHIP_SPIN_RATE,
  WHIP_START_LEN,
  WHIP_SWEEP_REACH,
} from "./constants";
import { audio } from "../engine/audio";

const EPS = 0.01;
const HW = PLAYER_W / 2;
const HH = PLAYER_H / 2;

export const FLUTE_TIME = 0.55;

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing = 1;
  grounded = false;
  wasGrounded = false;

  // 计时器（秒）
  coyote = 0;
  jumpBuf = 0;
  squash = 0; // 落地/起跳挤压，>0 播放中
  invuln = 0;
  deadT = 0;
  hp = HP_MAX;
  maxHp = HP_MAX;
  shieldT = 0; // 泡泡罩身剩余
  whipId = 0; // 每次挥鞭自增，实体用它保证一次挥鞭只命中一次
  fluteT = 0;
  stepDust = 0;

  // 摆荡状态（藤鞭 + 钩环）
  swing: { ring: Ring; theta: number; omega: number } | null = null;

  // 泡泡护罩：罩住后首次横向输入决定飞行方向，J 跳出
  shieldDir = 0;
  pullVx = 0; // 拉拽开始时的水平动量，转化为起摆角速度
  pullDir = 1; // 拉拽的接近方向，决定起摆方向
  // 螺旋扫击挂钩拉拽
  pull: { ring: Ring } | null = null;
  // 藤鞭持续旋转：按住使用键一直转；长度线性长满后保持，松手即收、再按重长
  whipHeld = false;
  whipT = 0; // 本次旋转已持续的秒数（决定鞭长）
  private whipA0 = 0; // 起手角（朝向起手、向上开始转）
  private whipDir = 1; // 旋转方向
  whipPrevT = 0; // 上一步已扫到的时刻：下一步的"经过"判定从这里续扫，不漏扇面

  // 攀爬蔓豆茎
  climb: StalkLike | null = null;
  // 松键短跳只属于"玩家主动跳"——蹦菇弹起/摆荡脱手等完整冲量不可被截短
  jumpCutting = false;
  // 按 S 主动下穿单向平台（根台/盛开的花苞）的短暂宽限
  dropT = 0;
  private vt = 0; // 视觉相位（头顶嫩芽摆动），纯渲染

  lastSafeX = 0;
  lastSafeY = 0;

  spawnAt(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.swing = null;
    this.deadT = 0;
    this.invuln = 0.5;
    this.lastSafeX = x;
    this.lastSafeY = y;
  }

  get box(): { x0: number; y0: number; x1: number; y1: number } {
    return { x0: this.x - HW, y0: this.y - HH, x1: this.x + HW, y1: this.y + HH };
  }

  update(world: WorldLike, input: Input): void {
    const dt = 1 / 60;
    this.vt += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.squash = Math.max(0, this.squash - dt * 4);
    this.fluteT = Math.max(0, this.fluteT - dt);

    if (world.locked) return;

    if (this.deadT > 0) {
      this.deadT -= dt;
      if (this.deadT <= 0) {
        this.deadT = 0; // 归零！否则残留负数会让所有"活着"判定永久失效
        world.finishRespawn();
      }
      return;
    }

    // 蔓豆生长状态：角色原地扎根，方向输入由 world 转交给茎，J 结束
    if (world.isBeanGrowing()) {
      this.vx = 0;
      this.vy = 0;
      world.checkPlayerHazards();
      return;
    }

    // 按住使用键：藤鞭持续旋转；松开即收
    if (this.whipHeld) {
      if (!input.held("use")) this.endWhip();
      else this.whipT += dt;
    }

    // 蔓豆茎攀爬：身体在茎上且按住上/下就抓住
    if (!this.climb && !this.swing && !this.pull && this.shieldT <= 0) {
      const st = world.stalkAt(this.x, this.y);
      if (st && (input.held("up") || input.held("down"))) this.climb = st;
    }
    if (this.climb) {
      this.updateClimb(world, input, dt);
      return;
    }

    if (this.swing) {
      this.updateSwing(world, input, dt);
      return;
    }

    if (this.pull) {
      this.updatePull(world, dt);
      return;
    }

    if (this.shieldT > 0) {
      this.updateShield(world, input, dt);
      return;
    }

    // ---- 水平 ----
    const dir = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    const speed = MOVE_SPEED * (this.shieldT > 0 ? 0.65 : 1);
    if (dir !== 0) {
      this.facing = dir;
      const accel = (this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt;
      this.vx += dir * accel;
      this.vx = Math.max(-speed, Math.min(speed, this.vx));
    } else if (this.grounded) {
      const f = FRICTION * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }

    // ---- 跳跃：土狼时间 + 预输入 + 可变跳高 ----
    if (input.pressed("jump")) this.jumpBuf = JUMP_BUFFER;
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = -JUMP_VEL;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      this.squash = -0.5; // 负值 = 拉伸
      this.jumpCutting = true;
      world.onJump();
    }
    if (this.jumpCutting && this.vy < 0 && !input.held("jump")) {
      this.vy *= Math.pow(JUMP_CUT, dt * 60); // 松键短跳——按帧率无关的方式衰减
    }

    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);

    // 站在单向平台上按 S：主动下穿（对瓦片地面无效果，做了也无害）
    this.dropT = Math.max(0, this.dropT - dt);
    if (input.pressed("down") && this.grounded) this.dropT = 0.22;

    // ---- 位移与碰撞 ----
    this.wasGrounded = this.grounded;
    this.moveCollide(world, this.vx * dt, this.vy * dt);

    if (this.grounded && !this.wasGrounded && this.vy >= 0) {
      this.squash = 1; // 落地挤压
      world.onLand(Math.abs(this.vy));
    }

    // 走路扬尘
    if (this.grounded && Math.abs(this.vx) > 30) {
      this.stepDust -= dt;
      if (this.stepDust <= 0) {
        this.stepDust = 0.12;
        world.dust(this.x - this.facing * 2, this.y + HH - 1, 1);
      }
    }

    world.checkPlayerHazards();
    if (this.grounded && this.deadT === 0) world.recordSafeSpot();
  }

  /** 罩身泡泡：漂浮，重力关闭；首次横向输入决定飞行方向，J 跳出。 */
  private updateShield(world: WorldLike, input: Input, dt: number): void {
    this.shieldT -= dt;
    if (this.shieldT <= 0) {
      this.shieldT = 0;
      audio.bubblePop();
      world.checkPlayerHazards(); // 到期还在毒雾里就地受伤
      return;
    }
    this.vy = 0;
    this.vx = 0;
    const d = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    if (this.shieldDir === 0 && d !== 0) {
      this.shieldDir = d;
      this.facing = d;
    }
    if (this.shieldDir !== 0) {
      const dx = this.shieldDir * SHIELD_SPEED * dt;
      this.x += dx;
      // 前缘撞墙：停在墙前（泡泡不穿墙）
      const edge = this.x + (this.shieldDir > 0 ? HW : -HW);
      for (const sy of [this.y - HH + 0.1, this.y, this.y + HH - 0.1]) {
        if (world.solidAtPx(edge, sy)) {
          this.x -= dx;
          break;
        }
      }
    }
    if (input.pressed("jump")) {
      // 跳出泡泡
      this.shieldT = 0;
      this.vy = -140;
      this.jumpCutting = false; // 完整冲量，不随松键截短
      audio.bubblePop();
      world.onShieldExit();
      return;
    }
    world.checkPlayerHazards();
  }

  /** 攀爬蔓豆茎：沿茎链四向移动，J 跳出；离茎或茎枯萎即脱落。 */
  private updateClimb(world: WorldLike, input: Input, dt: number): void {
    const st = this.climb!;
    if (st.dead || !st.holds(this.x, this.y)) {
      this.climb = null;
      return;
    }
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    const dx = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    const dy = (input.held("down") ? 1 : 0) - (input.held("up") ? 1 : 0);
    const step = CLIMB_SPEED * dt;
    if (dx !== 0) {
      const nx = this.x + dx * step;
      const edge = nx + Math.sign(dx) * (HW + 0.1);
      if (
        !world.climbSolidAtPx(edge, this.y - 2) &&
        !world.climbSolidAtPx(edge, this.y + 2) &&
        world.stalkAt(nx, this.y) === st
      ) {
        this.x = nx;
      }
    }
    if (dy !== 0) {
      const ny = this.y + dy * step;
      const edge = ny + Math.sign(dy) * (HH + 0.1);
      if (!world.climbSolidAtPx(this.x, edge) && world.stalkAt(this.x, ny) === st) {
        this.y = ny;
      }
    }
    if (input.pressed("jump")) {
      this.climb = null;
      this.vy = -JUMP_VEL; // 茎上起跳=正常跳跃：满跳力，可变跳高照常（松键短跳）
      this.jumpCutting = true;
      world.onJump();
    }
    world.checkPlayerHazards();
  }

  /** 被藤鞭锁定的钩环：把角色拉过去，到位后接标准摆荡。 */
  private updatePull(world: WorldLike, dt: number): void {
    const r = this.pull!.ring;
    const dx = r.x - this.x;
    const dy = r.y + SWING_LENGTH - this.y; // 目标：悬在环正下方
    const d = Math.hypot(dx, dy);
    const step = WHIP_PULL_SPEED * dt;
    if (d <= step + 2) {
      // 起摆：沿接近方向的固定初速——拉过来后是当前默认幅度的摆荡，且顺势向前
      this.x = r.x;
      this.y = r.y + SWING_LENGTH;
      this.swing = { ring: r, theta: 0, omega: this.pullDir * 2.2 };
      this.pull = null;
      world.onAttach();
      return;
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    this.vx = 0;
    this.vy = 0;
  }

  startPull(ring: Ring): void {
    this.pullVx = this.vx;
    this.pullDir = Math.sign(ring.x - this.x) || 1;
    this.pull = { ring };
    this.whipHeld = false; // 鞭梢挂上钩环：旋转结束，鞭子从此变成绳子
    this.whipT = 0;
    this.whipPrevT = 0;
    this.climb = null;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
  }

  private moveCollide(world: WorldLike, dx: number, dy: number): void {
    // X 轴：先移动，再检测前缘三个采样点（盒子宽 6px，三点覆盖足够）
    this.x += dx;
    if (dx !== 0) {
      const edge = dx > 0 ? this.x + HW : this.x - HW;
      for (const sy of [this.y - HH + 0.1, this.y, this.y + HH - 0.1]) {
        if (world.solidAtPx(edge, sy)) {
          this.x = dx > 0 ? Math.floor(edge / 10) * 10 - HW - EPS : (Math.floor(edge / 10) + 1) * 10 + HW + EPS;
          this.vx = 0;
          break;
        }
      }
      // 动态矩形（门/藤/花苞平台）不按瓦片网格对齐，用精确 AABB 推离。
      // 瓦片公式会把玩家推到矩形所在"瓦片列"的另一侧——矩形错位时等于穿墙。
      // 单向平台不挡横向。
      for (const r of world.dynamicSolids()) {
        if (r.oneWay) continue;
        if (this.box.x0 < r.x + r.w && this.box.x1 > r.x && this.box.y0 < r.y + r.h && this.box.y1 > r.y) {
          this.x = dx > 0 ? r.x - HW - EPS : r.x + r.w + HW + EPS;
          this.vx = 0;
        }
      }
    }
    // Y 轴
    const prevY = this.y;
    this.y += dy;
    this.grounded = false;
    if (dy > 0) {
      const edge = this.y + HH;
      for (const sx of [this.x - HW + 0.1, this.x + HW - 0.1]) {
        if (world.solidAtPx(sx, edge)) {
          this.y = Math.floor(edge / 10) * 10 - HH - EPS;
          this.vy = 0;
          this.grounded = true;
          break;
        }
      }
      for (const r of world.dynamicSolids()) {
        // 单向平台：只接"这步之前脚还在平台上方"的下落；主动下穿（dropT）时也不接
        if (r.oneWay && (this.dropT > 0 || prevY + HH > r.y + 0.5)) continue;
        if (this.box.x0 < r.x + r.w && this.box.x1 > r.x && this.box.y0 < r.y + r.h && this.box.y1 > r.y) {
          this.y = r.y - HH - EPS;
          this.vy = 0;
          this.grounded = true;
        }
      }
    } else if (dy < 0) {
      const edge = this.y - HH;
      for (const sx of [this.x - HW + 0.1, this.x + HW - 0.1]) {
        if (world.solidAtPx(sx, edge)) {
          this.y = (Math.floor(edge / 10) + 1) * 10 + HH + EPS;
          this.vy = 0;
          break;
        }
      }
      for (const r of world.dynamicSolids()) {
        if (r.oneWay) continue; // 单向平台不挡上升
        if (this.box.x0 < r.x + r.w && this.box.x1 > r.x && this.box.y0 < r.y + r.h && this.box.y1 > r.y) {
          this.y = r.y + r.h + HH + EPS;
          this.vy = 0;
        }
      }
    }
    // 站立探测：没有下落碰撞时，脚下 1px 是否有支撑（土狼时间依赖这个）
    if (!this.grounded && this.vy >= 0) {
      const foot = this.y + HH + 1;
      for (const sx of [this.x - HW + 0.1, this.x + HW - 0.1]) {
        if (world.solidAtPx(sx, foot)) {
          this.grounded = true;
          break;
        }
      }
    }
  }

  // ---- 摆荡：单摆。θ 自竖直向下方向度量，ω 角速度 ----
  private updateSwing(world: WorldLike, input: Input, dt: number): void {
    const s = this.swing!;
    const L = SWING_LENGTH;
    s.omega += -(980 / L) * Math.sin(s.theta) * dt;
    // 速度分量与位置导数保持一致——vy 是摆荡的真实状态，别系统会读它
    this.vy = -s.omega * L * Math.sin(s.theta);
    this.vx = s.omega * L * Math.cos(s.theta);
    // 泵摆：只有顺着摆动方向加力才有共振放大——幅度逐摆增长，越荡越高
    const pump = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0);
    if (pump !== 0 && s.omega * pump > 0) {
      s.omega += pump * 3.2 * dt;
    }
    s.omega = Math.max(-SWING_OMEGA_MAX, Math.min(SWING_OMEGA_MAX, s.omega));
    s.theta += s.omega * dt;

    this.x = s.ring.x + Math.sin(s.theta) * L;
    this.y = s.ring.y + Math.cos(s.theta) * L;
    this.facing = s.omega >= 0 ? 1 : -1;

    if (input.pressed("jump")) {
      // 摇摆中起跳 = 陆地起跳：完整跳高，切向动量全额保留——荡得越快甩得越远
      this.vx = s.omega * L * Math.cos(s.theta) * 1.3;
      this.vy = -JUMP_VEL;
      this.jumpCutting = false; // 甩出是完整冲量——tap 松键不该把弧线砍掉
      this.swing = null;
      world.onSwingRelease();
    }
  }

  attachSwing(ring: Ring): void {
    const dx = this.x - ring.x;
    const dy = this.y - ring.y;
    const theta = Math.atan2(dx, Math.max(dy, 1));
    // 把当前水平动量转成角速度，跑跳上钩会自然荡起来
    const omega = Math.max(
      -SWING_OMEGA_MAX,
      Math.min(SWING_OMEGA_MAX, (this.vx * Math.cos(theta)) / SWING_LENGTH),
    );
    this.swing = { ring, theta, omega };
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
  }

  startWhip(): void {
    this.whipHeld = true;
    this.whipT = 0; // 松手后再按：长度从初始值重新长起
    this.whipPrevT = 0;
    // 旋转方向跟当前朝向：朝右=屏幕顺时针、朝左=逆时针（画布 y 向下，θ 增即顺时针）；
    // 起手都朝上。挥舞中途变向不翻转——方向只在这里定一次
    this.whipA0 = -Math.PI / 2;
    this.whipDir = this.facing > 0 ? 1 : -1;
    this.whipId++;
  }

  endWhip(): void {
    this.whipHeld = false;
    this.whipT = 0;
    this.whipPrevT = 0;
  }

  startFlute(): void {
    this.fluteT = FLUTE_TIME;
  }

  startShield(): void {
    this.shieldT = SHIELD_LIFE;
    this.shieldDir = 0;
    this.swing = null;
    this.pull = null;
    this.climb = null;
    this.endWhip(); // 鞭子化进了罩身泡泡里
  }

  /** 旋转角：起手角 + 恒速旋转（向上起手）。 */
  private angleAt(t: number): number {
    return this.whipA0 + this.whipDir * WHIP_SPIN_RATE * t;
  }

  /** 鞭长：WHIP_GROW_TIME 秒内从初始长度线性长到最长（屏宽一半），之后保持。 */
  private lengthAt(t: number): number {
    return WHIP_START_LEN + (WHIP_SWEEP_REACH - WHIP_START_LEN) * Math.min(1, t / WHIP_GROW_TIME);
  }

  /** 本逻辑步鞭身扫过的扇面，切成的小线段（每段转角 ≤0.08rad）——"经过"判定不漏检。 */
  whipSegs(): { x0: number; y0: number; x1: number; y1: number }[] {
    if (!this.whipHeld) return [];
    const n = Math.max(
      1,
      Math.min(8, Math.ceil(Math.abs(this.angleAt(this.whipT) - this.angleAt(this.whipPrevT)) / 0.08)),
    );
    const hx = this.x + this.facing * 3;
    const segs: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let k = 1; k <= n; k++) {
      const t = this.whipPrevT + ((this.whipT - this.whipPrevT) * k) / n;
      const r = this.lengthAt(t);
      const a = this.angleAt(t);
      segs.push({ x0: hx, y0: this.y, x1: hx + Math.cos(a) * r, y1: this.y + Math.sin(a) * r });
    }
    return segs;
  }

  /** 尝试受击（尖刺/毒雾/坠落等硬危险）：掉 1 血进入死亡演出；
   *  位置由 world.finishRespawn 决定——还有血回安全点，血尽回存档花。 */
  hurt(world: WorldLike, ignoreInvuln = false): boolean {
    if ((this.invuln > 0 && !ignoreInvuln) || this.deadT > 0 || world.locked) return false;
    this.hp = Math.max(0, this.hp - 1);
    this.beginDeath();
    world.onHurt();
    return true;
  }

  /** 软受击（游魂碰身一类）：掉 1 血、闪烁无敌 HURT_INVULN 秒、原地击退，
   *  不重置位置。血被打光才转入死亡演出（回存档点）。 */
  hitSoft(world: WorldLike, kx: number, ky: number): boolean {
    if (this.invuln > 0 || this.deadT > 0 || world.locked) return false;
    this.hp = Math.max(0, this.hp - 1);
    this.shieldT = 0;
    this.climb = null;
    this.swing = null; // 被撞脱手：击退只在自由状态下才有意义
    if (this.hp <= 0) {
      this.beginDeath();
    } else {
      this.invuln = HURT_INVULN;
      this.vx = kx;
      this.vy = ky;
    }
    world.onHurt();
    return true;
  }

  /** 死亡演出：粒子飞散 0.45s 后由 world 接管重生落点。 */
  beginDeath(): void {
    this.deadT = 0.45;
    this.vx = 0;
    this.vy = 0;
    this.swing = null;
    this.pull = null; // 拉拽目标属旧房间，重生后不得续拉
    this.shieldT = 0;
    this.climb = null;
    this.endWhip();
  }

  finishRespawnAt(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.invuln = 1;
  }

  // ---- 绘制 ----

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.deadT > 0) return; // 死亡期间由粒子表现

    const sq = this.squash; // (0,1] 落地压扁 / [-0.5,0) 起跳拉伸
    const w = PLAYER_W + (sq > 0 ? 2 * sq : -1.4 * sq);
    const h = PLAYER_H - (sq > 0 ? 2 * sq : -2.4 * sq);
    const bx = Math.round(this.x - w / 2);
    const by = Math.round(this.y + PLAYER_H / 2 - h);

    // 影子
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(this.x - 3, Math.round(this.y + HH) - 1, 6, 1);

    // 身体：圆角种子。深描边 + 双色壳，和冷苔草不同族
    const blink = this.invuln > 0.15 && Math.floor(this.invuln * 16) % 2 === 0;
    const bw = Math.round(w);
    const bh = Math.round(h);
    ctx.fillStyle = "#120c06";
    ctx.fillRect(bx - 1, by, bw + 2, bh);
    ctx.fillRect(bx, by - 1, bw, bh + 1);
    ctx.fillStyle = blink ? "#6a5838" : "#8a6a38";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = blink ? "#8a7448" : "#c9a05a";
    ctx.fillRect(bx + 1, by + 1, Math.max(1, bw - 2), Math.max(1, bh - 2));
    ctx.fillStyle = blink ? "#6a5838" : "#a88848";
    ctx.fillRect(bx + 1, by + bh - 2, Math.max(1, bw - 2), 1);
    ctx.fillStyle = blink ? "#b8a070" : "#e8d080";
    ctx.fillRect(bx + 1, by + 1, Math.max(1, bw - 2), 1);
    ctx.fillStyle = blink ? "#d8c898" : "#f4e8b8";
    ctx.fillRect(bx + 1, by + 1, 1, 1);
    // 头顶嫩芽：暖橄榄双叶
    const lean = Math.max(-2, Math.min(2, this.vx * 0.02)) + (this.facing > 0 ? 0.5 : -0.5);
    const flut = Math.sin(this.vt * 4) * 0.8;
    const sx = Math.round(this.x + lean * 0.5);
    ctx.fillStyle = "#2a3a1c";
    ctx.fillRect(sx, by - 3, 1, 3);
    ctx.fillStyle = "#6a7a38";
    ctx.fillRect(sx - 1, by - 4, 2, 1);
    ctx.fillStyle = "#8a9a48";
    ctx.fillRect(sx + 1 + Math.round(flut), by - 4, 2, 1);

    // 眼睛：黑瞳 + 一点神光
    ctx.fillStyle = "#1a140c";
    const eyeY = by + 2;
    ctx.fillRect(bx + Math.round(w / 2) - 2 + this.facing, eyeY, 1, 2);
    ctx.fillRect(bx + Math.round(w / 2) + this.facing, eyeY, 1, 2);
    ctx.fillStyle = "#fff3cf";
    ctx.fillRect(bx + Math.round(w / 2) - 2 + this.facing, eyeY, 1, 1);

    // 藤鞭：按住持续旋转——长度线性长满后保持，拖两道残影表达转速
    // 判定走 whipSegs（所见即所得：画到哪、判定到哪）
    if (this.whipHeld) {
      const hx = this.x + this.facing * 3;
      const hy = this.y;
      for (const [dts, alpha] of [[0.12, 0.25], [0.06, 0.5], [0, 1]] as [number, number][]) {
        const t = Math.max(0, this.whipT - dts);
        const r = this.lengthAt(t);
        const a = this.angleAt(t);
        const ex = hx + Math.cos(a) * r;
        const ey = hy + Math.sin(a) * r;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#3a5a40";
        ctx.lineWidth = dts === 0 ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        const mx = hx + Math.cos(a) * r * 0.55 + Math.cos(a - Math.PI / 2) * r * 0.07;
        const my = hy + Math.sin(a) * r * 0.55 + Math.sin(a - Math.PI / 2) * r * 0.07;
        ctx.quadraticCurveTo(mx, my, ex, ey);
        ctx.stroke();
        ctx.strokeStyle = "#7fd4a0";
        ctx.lineWidth = dts === 0 ? 1.4 : 0.9;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(mx, my, ex, ey);
        ctx.stroke();
        if (dts === 0) {
          ctx.fillStyle = "#d8ffe8";
          ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 3, 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 孢子笛
    if (this.fluteT > 0) {
      const t = 1 - this.fluteT / FLUTE_TIME;
      ctx.fillStyle = "#c9a86a";
      ctx.fillRect(Math.round(this.x + this.facing * 2), Math.round(this.y - 3), this.facing * 5 || 5, 2);
      for (let i = 0; i < 3; i++) {
        const nt = t * 3 - i;
        if (nt > 0 && nt < 1) {
          ctx.fillStyle = "#cfe8d8";
          ctx.fillRect(
            Math.round(this.x + this.facing * (6 + nt * 6)),
            Math.round(this.y - 6 - nt * 5),
            1,
            1,
          );
        }
      }
    }

    // 泡泡罩
    if (this.shieldT > 0) {
      const r = 7 + Math.sin(this.shieldT * 20) * 0.5;
      ctx.fillStyle = `rgba(150, 220, 255, ${Math.min(0.12, this.shieldT * 0.08 + 0.05).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r - 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(80, 150, 190, ${Math.min(0.7, this.shieldT + 0.25).toFixed(2)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(150, 220, 255, ${Math.min(0.9, this.shieldT + 0.3).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(200,240,255,0.6)";
      ctx.fillRect(Math.round(this.x + 2), Math.round(this.y - r + 2), 1, 1);
    }
  }

  drawSwingRope(ctx: CanvasRenderingContext2D): void {
    const target = this.swing?.ring ?? this.pull?.ring ?? null;
    if (!target) return;
    ctx.strokeStyle = this.pull ? "#b8f0cc" : "#7fd4a0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
  }
}

// world.ts 提供的能力面。用接口而不是直接 import World 类型，
// 避免 player ↔ world 循环依赖在运行时互相拖拽。
export interface StalkLike {
  dead: boolean;
  holds(px: number, py: number): boolean;
}

export interface WorldLike {
  locked: boolean;
  solidAtPx(x: number, y: number): boolean;
  /** 攀爬豆茎专用：无视藤蔓墙的实心判定（原生藤蔓与豆茎互不干扰）。 */
  climbSolidAtPx(x: number, y: number): boolean;
  dynamicSolids(): Rect[];
  stalkAt(x: number, y: number): StalkLike | null;
  /** 蔓豆茎生长中：角色被根须固定在原地，方向输入归茎。 */
  isBeanGrowing(): boolean;
  onJump(): void;
  onLand(impact: number): void;
  onSwingRelease(): void;
  onHurt(): void;
  dust(x: number, y: number, n: number): void;
  checkPlayerHazards(): void;
  recordSafeSpot(): void;
  finishRespawn(): void;
  onShieldExit(): void;
  onAttach(): void;
}
