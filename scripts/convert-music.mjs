// 把 src/assets 下的 MP3 母带转成 8-bit 风格的游戏 BGM。
//
// 处理链（每一步为什么存在，写在行内）：
//   1. loudnorm 两遍式响度归一（第一遍只测量，第二遍 linear=true 纯静态增益）
//      —— 两首曲子母带响度差 3 LU 以上，直接播切歌会一惊一乍；linear 模式不做动态压缩，
//         只整体抬/降增益并用 true-peak 顶限，保住母带动态。
//   2. lowpass ×2 —— 一阶低通叠两次 ≈12dB/oct，把 6.5kHz 以上压掉：
//         芯片机带宽就那么宽，砍掉高频后 8-bit 量化噪声也听得更"像机器"而不刺耳。
//   3. aresample=16000 —— 采样率砍到 1/3，再叠一步"糊化"，Nyquist 只有 8k。
//   4. acrusher bits=8 —— 真正的 8-bit 量化；mode=log 压扩让安静段噪声小一点，aa=0 不平滑（要的就是颗粒感）。
//   5. afade 首 20ms / 尾 30ms —— WAV 循环拼接点若不归零会"咔"一声。
//
// 输出 mono/16kHz/8bit 无符号 PCM WAV 到 src/assets/music/（约 16KB/s，标题曲 3 分钟 ≈ 2.9MB）。
// 换了新母带后重跑一次即可：node scripts/convert-music.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(root, "src", "assets");
const OUT = path.join(SRC, "music");
const TARGET = { I: -16, TP: -2, LRA: 11 }; // BGM 目标响度比流媒体标准(-14)安静，给音效让位
const SR = 16000;

const TRACKS = [
  { input: "title.mp3", output: "title-8bit.wav" },
  { input: "游戏中.mp3", output: "game-8bit.wav" },
];

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg 退出码 ${r.status}\n${(r.stderr || "").slice(-800)}`);
  return { out: r.stdout ?? "", err: r.stderr ?? "" };
}

// 第一遍 loudnorm：只测不处理（print_format=json 输出到 stderr）
function measureLoudness(file) {
  const { err } = ffmpeg([
    "-hide_banner", "-nostats", "-i", file,
    "-af", `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`,
    "-f", "null", "-",
  ]);
  const m = err.match(/\{[^{}]*\}/);
  if (!m) throw new Error(`loudnorm 测量失败（没解析到 JSON）：${file}`);
  return JSON.parse(m[0]);
}

function probeDuration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  const v = Number(String(r.stdout).trim());
  if (!Number.isFinite(v) || v <= 0) throw new Error(`读不到时长：${file}\n${r.stderr}`);
  return v;
}

mkdirSync(OUT, { recursive: true });
for (const t of TRACKS) {
  const src = path.join(SRC, t.input);
  // 中文文件名在 Windows 上传给 ffmpeg 可能被代码页搞坏——统一走 ASCII 临时副本
  const tmp = path.join(OUT, "_tmp-input.mp3");
  const dst = path.join(OUT, t.output);
  try {
    copyFileSync(src, tmp);
    const dur = probeDuration(tmp);
    const m = measureLoudness(tmp);
    ffmpeg([
      "-hide_banner", "-y", "-i", tmp,
      "-af",
      [
        `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}` +
        `:measured_I=${m.input_i}:measured_LRA=${m.input_lra}:measured_TP=${m.input_tp}` +
        `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
        "lowpass=f=6500", "lowpass=f=6500",
        `aresample=${SR}`,
        "acrusher=bits=8:mode=log:aa=0",
        "afade=t=in:st=0:d=0.02",
        `afade=t=out:st=${(dur - 0.03).toFixed(3)}:d=0.03`,
      ].join(","),
      "-ac", "1", "-ar", String(SR), "-c:a", "pcm_u8",
      dst,
    ]);
    const kb = Math.round(statSync(dst).size / 1024);
    console.log(`${t.input} → ${t.output}  ${dur.toFixed(1)}s  ${m.input_i} LUFS → ${TARGET.I} LUFS  ${kb} KB`);
    // 部署版：同一处理链再出一份 mono 96k MP3（dist 只打包 MP3；WAV 母带留档不入包）
    const mp3 = dst.replace(/\.wav$/, ".mp3");
    ffmpeg([
      "-hide_banner", "-y", "-i", dst,
      "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k",
      mp3,
    ]);
    const mk = Math.round(statSync(mp3).size / 1024);
    console.log(`  ↳ ${path.basename(mp3)}  ${mk} KB（部署版）`);
  } finally {
    rmSync(tmp, { force: true });
  }
}
console.log("转换完成");
