// 音频系统：音效与环境音用振荡器+噪声现场合成（零素材）；BGM 用 8-bit 化的真实曲目
// （scripts/convert-music.mjs 从 src/assets/*.mp3 转出的 WAV，循环播放），素材加载失败时退回
// 浏览器要求 AudioContext 必须在用户手势后创建/恢复——所以第一次按键时 ensure()。
// 曲目加载失败即静音（兜底音序器已删：与真曲叠播，已按用户要求移除）。
// 部署版用 MP3（mono 96k，各约 2.5MB）；8-bit WAV 母带留在同目录不入包
import titleTrackUrl from "../assets/music/title-8bit.mp3?url";
import gameTrackUrl from "../assets/music/game-8bit.mp3?url";

const VOL_KEY = "plantwell.volume.v1";

/** BGM 曲目名：标题画面 / 井内探索。 */
export type TrackName = "title" | "game";

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private dripTimer = 0;
  muted = false;
  private volume = 0.8;

  // 曲目系统状态
  private static TRACK_URLS: Record<TrackName, string> = { title: titleTrackUrl, game: gameTrackUrl };
  private musicGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private currentTrack: TrackName | null = null;
  private trackBuffers = new Map<TrackName, AudioBuffer>();

  constructor() {
    try {
      const raw = localStorage.getItem(VOL_KEY);
      if (raw !== null) this.volume = Math.max(0, Math.min(1, Number(raw)));
    } catch {
      /* 用默认音量 */
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOL_KEY, String(this.volume));
    } catch {
      /* 存不进就算了 */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5 * this.volume, this.ctx.currentTime, 0.03);
    }
  }

  /** 在首次用户手势时调用；之后随时安全。 */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5 * this.volume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    // 曲目已归一到 -16 LUFS，这里再整体压一档，让音效站前排
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    // ensure() 之前就 setTrack 过的话，此刻补开
    if (this.currentTrack) void this.startTrack(this.currentTrack);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5 * this.volume, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  // ---- 曲目系统：8-bit 化 WAV 循环，setTrack 驱动标题/游戏内切换 ----

  /** 当前曲目名（测试探针用）。 */
  get trackName(): TrackName | null {
    return this.currentTrack;
  }

  /** 是否有 BGM 在响。测试探针用。 */
  get musicPlaying(): boolean {
    return !!this.musicSource;
  }

  /** 开机预热：页面加载即后台下载并解码曲目进缓存——
   *  fetch/decode 不需要用户手势（播放才需要），慢网络下按键瞬间就能出声，
   *  PRESS ANY KEY 画面天然兼任加载画面。失败即静音。 */
  prewarm(): void {
    this.ensure();
    void this.loadTrack("title").catch(() => {});
    void this.loadTrack("game").catch(() => {});
  }

  /** 切换 BGM。幂等；ensure() 之前调用会先记住意图，ensure 后自动开播。 */
  setTrack(name: TrackName | null): void {
    if (this.currentTrack === name) return;
    this.currentTrack = name;
    if (!this.ctx || !this.musicGain) return;
    this.stopMusic();
    if (name) void this.startTrack(name);
  }

  private async startTrack(name: TrackName): Promise<void> {
    if (!this.ctx || !this.musicGain) return;
    try {
      const buf = await this.loadTrack(name);
      // 等待加载期间用户已切到别的曲目 → 丢弃这份迟到的结果
      if (this.currentTrack !== name || !this.ctx || !this.musicGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicSource = src;
    } catch {
      // 素材不可达（网络失败等）→ 保持安静；下轮 setTrack 会重试
    }
  }

  private async loadTrack(name: TrackName): Promise<AudioBuffer> {
    const hit = this.trackBuffers.get(name);
    if (hit) return hit;
    const url = AudioSys.TRACK_URLS[name];
    // IndexedDB 优先：首次下载后存本地，刷新/再访直接读盘——不再吃网络延迟
    let raw = await this.idbGet(`track:${url}`);
    if (!raw || raw.byteLength === 0) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.arrayBuffer();
      await this.idbPut(`track:${url}`, raw); // 必须先入库再解码：decodeAudioData 会抽干缓冲
    }
    const buf = await this.ctx!.decodeAudioData(raw);
    this.trackBuffers.set(name, buf);
    return buf;
  }

  /** 私有 IndexedDB（plantwell.audio）。不可用（隐私模式等）时静默退回网络。 */
  private idbOpen(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("plantwell.audio", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("tracks");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async idbGet(key: string): Promise<ArrayBuffer | null> {
    const db = await this.idbOpen();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction("tracks", "readonly").objectStore("tracks").get(key);
        tx.onsuccess = () => resolve((tx.result as ArrayBuffer | undefined) ?? null);
        tx.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async idbPut(key: string, raw: ArrayBuffer): Promise<void> {
    const db = await this.idbOpen();
    if (!db) return;
    try {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").put(raw, key);
    } catch {
      /* 存不进就算了：下次还是走网络 */
    }
  }

  private stopMusic(): void {
    if (!this.musicSource) return;
    try {
      this.musicSource.stop();
    } catch {
      /* 已经停了 */
    }
    this.musicSource.disconnect();
    this.musicSource = null;
  }


  // ---- 合成原语 ----

  private tone(o: {
    type: OscillatorType;
    f0: number;
    f1?: number;
    dur: number;
    vol: number;
    delay?: number;
    attack?: number;
  }): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(o: {
    dur: number;
    vol: number;
    type?: BiquadFilterType;
    f0: number;
    f1?: number;
    q?: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const len = Math.ceil(this.ctx.sampleRate * o.dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = o.type ?? "lowpass";
    filt.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    filt.Q.value = o.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(o.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
  }

  // ---- 音效 ----

  jump(): void {
    this.tone({ type: "square", f0: 200, f1: 430, dur: 0.12, vol: 0.1 });
  }
  land(): void {
    this.noise({ dur: 0.07, vol: 0.12, f0: 400, f1: 120 });
    this.tone({ type: "sine", f0: 95, f1: 60, dur: 0.08, vol: 0.12 });
  }
  whip(): void {
    this.noise({ dur: 0.12, vol: 0.14, type: "bandpass", f0: 1400, f1: 350, q: 2 });
  }
  attach(): void {
    this.tone({ type: "sine", f0: 620, f1: 880, dur: 0.07, vol: 0.1 });
  }
  release(): void {
    this.noise({ dur: 0.1, vol: 0.08, type: "bandpass", f0: 600, f1: 1600, q: 1.5 });
  }
  bubbleBlow(): void {
    this.tone({ type: "triangle", f0: 280, f1: 660, dur: 0.16, vol: 0.12 });
  }
  bubblePop(): void {
    this.tone({ type: "sine", f0: 900, f1: 130, dur: 0.07, vol: 0.14 });
    this.noise({ dur: 0.04, vol: 0.06, type: "highpass", f0: 2000 });
  }
  flute(): void {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => this.tone({ type: "triangle", f0: f, dur: 0.24, vol: 0.09, delay: i * 0.13 }));
  }
  bloom(): void {
    [262, 330, 392].forEach((f, i) =>
      this.tone({ type: "triangle", f0: f, dur: 0.5, vol: 0.06, delay: i * 0.04, attack: 0.03 }),
    );
  }
  pacify(): void {
    this.tone({ type: "sine", f0: 440, f1: 660, dur: 0.3, vol: 0.07 });
  }
  seedGet(): void {
    this.tone({ type: "sine", f0: 784, dur: 0.12, vol: 0.1 });
    this.tone({ type: "sine", f0: 1046, dur: 0.3, vol: 0.1, delay: 0.09 });
    this.noise({ dur: 0.25, vol: 0.03, type: "highpass", f0: 5000, delay: 0.05 });
  }
  itemGet(): void {
    this.tone({ type: "square", f0: 523, f1: 784, dur: 0.16, vol: 0.08 });
  }
  switchClick(): void {
    this.tone({ type: "square", f0: 170, dur: 0.05, vol: 0.12 });
    this.tone({ type: "square", f0: 90, dur: 0.08, vol: 0.1, delay: 0.06 });
  }
  doorOpen(): void {
    this.noise({ dur: 0.45, vol: 0.16, f0: 140, f1: 60 });
  }
  hurt(): void {
    this.tone({ type: "sawtooth", f0: 300, f1: 70, dur: 0.25, vol: 0.1 });
  }
  bounce(): void {
    this.tone({ type: "triangle", f0: 120, f1: 60, dur: 0.16, vol: 0.14 });
    this.tone({ type: "square", f0: 180, f1: 520, dur: 0.14, vol: 0.05, delay: 0.02 });
  }
  plant(): void {
    this.tone({ type: "triangle", f0: 300, f1: 170, dur: 0.14, vol: 0.11 });
    this.noise({ dur: 0.08, vol: 0.05, f0: 900, f1: 300 });
  }
  ending(): void {
    [262, 330, 392, 494, 523].forEach((f, i) =>
      this.tone({ type: "triangle", f0: f, dur: 2.2, vol: 0.07, delay: i * 0.35, attack: 0.25 }),
    );
  }

  // ---- 环境音 ----

  startAmbient(): void {
    if (!this.ctx || !this.master || this.ambientGain) return;
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    this.ambientGain.connect(this.master);
    // 双振荡器轻微失谐 → 缓慢的"拍频"，井底低鸣
    for (const f of [54, 54.6]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.connect(this.ambientGain);
      osc.start();
      this.droneOscs.push(osc);
    }
    this.dripTimer = 2 + Math.random() * 4;
  }

  /** depth: 0(井口)~1(井底)，控制低鸣强弱与水滴频率。每逻辑步调用。 */
  updateAmbient(depth: number): void {
    if (!this.ctx || !this.ambientGain || this.muted) return;
    this.ambientGain.gain.setTargetAtTime(0.04 + depth * 0.05, this.ctx.currentTime, 0.5);
    this.dripTimer -= 1 / 60;
    if (this.dripTimer <= 0) {
      this.dripTimer = (5.5 - depth * 3.5) * (0.6 + Math.random() * 0.8);
      const f = 900 + Math.random() * 600;
      this.tone({ type: "sine", f0: f, f1: f * 0.35, dur: 0.35, vol: 0.045 });
    }
  }
}

export const audio = new AudioSys();
