/**
 * Dựng tham số FFmpeg (chạy 100% phía máy chủ).
 *
 * File này thuần hàm — không import Node API, không đụng hệ thống tệp — nên
 * kiểm thử được độc lập. Mọi dữ liệu từ client đều đi qua `sanitizeSettings`
 * (ép kiểu + kẹp khoảng giá trị) và KHÔNG BAO GIỜ được nối vào chuỗi shell:
 *   - FFmpeg được gọi bằng `spawn(args[])`, không qua shell;
 *   - văn bản hiển thị được ghi ra tệp UTF-8 rồi đưa vào `drawtext=textfile=`,
 *     nên ký tự đặc biệt trong tiêu đề/phụ đề không thể chèn thêm filter.
 */

export const MAX_CLIP_SECONDS = 1200; // 20 phút

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type ColorFilter = "normal" | "cinematic" | "vibrant" | "vintage" | "bw" | "noir" | "warm";

export interface RenderSettings {
  aspectRatio: AspectRatio;
  trimStart: number;
  trimEnd: number;
  colorFilter: ColorFilter;
  brightness: number;
  contrast: number;
  saturation: number;
  overlayText: string;
  textPosition: "top" | "center" | "bottom";
  textColor: string;
  textBgColor: string;
  textSize: number;
  enableSubtitles: boolean;
  subtitlesScript: string;
  brandName1: string;
  enableBrandName1: boolean;
  brandName1Opacity: number;
  brandName1Size: number;
  brandName2: string;
  enableBrandName2: boolean;
  brandName2Opacity: number;
  brandName2Size: number;
  brandName2Mode: "marquee" | "fixed";
  enableOriginalAudio: boolean;
  /** 0.5x – 2.0x */
  originalVideoVolume: number;
}

/** Chiều rộng tham chiếu của khung preview — PHẢI khớp `PREVIEW_REF_WIDTH` ở lib/cine/filters.ts */
export const PREVIEW_REF_WIDTH: Record<AspectRatio, number> = {
  "9:16": 360,
  "1:1": 480,
  "4:5": 432,
  "16:9": 640,
};

export const OUTPUT_SIZE: Record<AspectRatio, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
  "16:9": { w: 1920, h: 1080 },
};

const RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const FILTERS: ColorFilter[] = ["normal", "cinematic", "vibrant", "vintage", "bw", "noir", "warm"];

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(v: unknown, maxLen: number, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  // bỏ ký tự điều khiển, gộp xuống dòng thành khoảng trắng
  const noControl = Array.from(v, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? " " : ch;
  }).join("");
  return noControl.replace(/\s+/g, " ").trim().slice(0, maxLen) || fallback;
}

export function sanitizeSettings(raw: unknown): RenderSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ratio = RATIOS.includes(r.aspectRatio as AspectRatio) ? (r.aspectRatio as AspectRatio) : "16:9";
  const start = num(r.trimStart, 0, 86400, 0);
  const end = num(r.trimEnd, 0, 86400, 0);
  return {
    aspectRatio: ratio,
    trimStart: start,
    trimEnd: end,
    colorFilter: FILTERS.includes(r.colorFilter as ColorFilter) ? (r.colorFilter as ColorFilter) : "normal",
    brightness: num(r.brightness, 0.4, 1.6, 1),
    contrast: num(r.contrast, 0.4, 1.8, 1),
    saturation: num(r.saturation, 0, 2.2, 1),
    overlayText: str(r.overlayText, 200),
    textPosition: r.textPosition === "bottom" || r.textPosition === "center" ? r.textPosition : "top",
    textColor: str(r.textColor, 40, "#ffffff"),
    textBgColor: str(r.textBgColor, 60, "rgba(0,0,0,0.7)"),
    textSize: num(r.textSize, 8, 120, 22),
    enableSubtitles: r.enableSubtitles === true,
    subtitlesScript: str(r.subtitlesScript, 240).slice(0, 80),
    brandName1: str(r.brandName1, 80),
    enableBrandName1: r.enableBrandName1 === true,
    brandName1Opacity: num(r.brandName1Opacity, 0, 1, 1),
    brandName1Size: num(r.brandName1Size, 6, 120, 20),
    brandName2: str(r.brandName2, 80),
    enableBrandName2: r.enableBrandName2 === true,
    brandName2Opacity: num(r.brandName2Opacity, 0, 1, 0.15),
    brandName2Size: num(r.brandName2Size, 6, 120, 13),
    brandName2Mode: r.brandName2Mode === "fixed" ? "fixed" : "marquee",
    enableOriginalAudio: r.enableOriginalAudio !== false,
    originalVideoVolume: num(r.originalVideoVolume, 0, 2, 1),
  };
}

/** Thời lượng cần xuất (giây), đã kẹp tối đa 20 phút. `sourceDuration` lấy từ ffprobe. */
export function resolveClip(s: RenderSettings, sourceDuration: number): { start: number; duration: number } {
  const start = Math.min(s.trimStart, Math.max(0, sourceDuration - 0.5));
  const end = s.trimEnd > start + 0.1 ? Math.min(s.trimEnd, sourceDuration) : sourceDuration;
  const duration = Math.max(0.5, Math.min(end - start, MAX_CLIP_SECONDS));
  return { start, duration };
}

// ---------------------------------------------------------------- màu

/** "#rrggbb" | "#rgb" | "rgb(a)(…)" -> "0xRRGGBB@alpha" cho FFmpeg. */
export function toFfColor(input: string, extraAlpha = 1, fallback = "0xffffff"): string {
  const s = input.trim().toLowerCase();
  let rgb: [number, number, number] | null = null;
  let a = 1;
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    rgb = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  } else if ((m = /^#([0-9a-f]{3})$/.exec(s))) {
    rgb = [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  } else if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s))) {
    rgb = [Math.min(255, +m[1]), Math.min(255, +m[2]), Math.min(255, +m[3])];
    if (m[4] !== undefined) a = Math.min(1, Math.max(0, parseFloat(m[4])));
  }
  if (!rgb) return fallback;
  const hex = rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  const alpha = Math.min(1, Math.max(0, a * extraAlpha));
  return `0x${hex}@${alpha.toFixed(2)}`;
}

// ---------------------------------------------------------------- bộ lọc màu

interface Look {
  sat: number;
  contrast: number;
  bright: number;
  sepia: number;
  gray: boolean;
}

const LOOKS: Record<ColorFilter, Look> = {
  normal: { sat: 1, contrast: 1, bright: 0, sepia: 0, gray: false },
  cinematic: { sat: 1.1, contrast: 1.06, bright: 0, sepia: 0, gray: false },
  noir: { sat: 1, contrast: 1.4, bright: -0.03, sepia: 0, gray: true },
  vintage: { sat: 1, contrast: 0.92, bright: 0.02, sepia: 0.5, gray: false },
  warm: { sat: 1.25, contrast: 1, bright: 0, sepia: 0.28, gray: false },
  vibrant: { sat: 1.55, contrast: 1.12, bright: 0, sepia: 0, gray: false },
  bw: { sat: 1, contrast: 1.2, bright: 0, sepia: 0, gray: true },
};

function sepiaMix(a: number): string {
  const S = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const names = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"];
  return "colorchannelmixer=" + names.map((n, i) => `${n}=${((1 - a) * I[i] + a * S[i]).toFixed(3)}`).join(":");
}

// ---------------------------------------------------------------- văn bản

/** Ngắt dòng theo số ký tự ước lượng (chữ Latin ~0.58 × cỡ chữ). */
export function wrapText(text: string, fontPx: number, maxWidthPx: number): string {
  const perLine = Math.max(8, Math.floor(maxWidthPx / (fontPx * 0.58)));
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= perLine) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

/** Thoát đường dẫn để dùng trong giá trị option của filter (kể cả `C:\` trên Windows). */
export function escFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface TextFile {
  /** tên tệp (tương đối trong thư mục job) */
  name: string;
  content: string;
}

export interface BuiltCommand {
  args: string[];
  textFiles: TextFile[];
  width: number;
  height: number;
  duration: number;
}

export interface BuildInput {
  inputPath: string;
  outputPath: string;
  /** thư mục job (chứa các tệp văn bản) */
  workDir: string;
  fontFile: string;
  settings: RenderSettings;
  hasAudio: boolean;
  sourceDuration: number;
  /** Codec video: "libx264" (CPU) hoặc "h264_nvenc" (GPU NVIDIA) */
  videoCodec?: string;
  /** Preset tốc độ: libx264 ("veryfast", "ultrafast", "fast") / NVENC ("p1" - "p7", "fast") */
  preset?: string;
  /** Chất lượng: CRF cho libx264 (mặc định 20), CQ cho NVENC (mặc định 22) */
  quality?: number | string;
}

export function buildFfmpegCommand(b: BuildInput): BuiltCommand {
  const s = b.settings;
  const { w: W, h: H } = OUTPUT_SIZE[s.aspectRatio];
  const u = W / PREVIEW_REF_WIDTH[s.aspectRatio]; // hệ số phóng preview -> render
  const { start, duration } = resolveClip(s, b.sourceDuration);
  const textFiles: TextFile[] = [];
  const font = escFilterPath(b.fontFile);
  const wd = b.workDir.replace(/\\/g, "/");

  const drawtext = (name: string, content: string, opts: string[]): string => {
    textFiles.push({ name, content });
    return [
      `drawtext=fontfile='${font}'`,
      `textfile='${escFilterPath(`${wd}/${name}`)}'`,
      "expansion=none",
      ...opts,
    ].join(":");
  };

  // ---- video
  const look = LOOKS[s.colorFilter];
  const vf: string[] = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W}:${H}`,
    "setsar=1",
  ];
  if (look.sepia > 0) vf.push(sepiaMix(look.sepia));
  if (look.gray) vf.push("hue=s=0");
  const contrast = +(s.contrast * look.contrast).toFixed(3);
  const saturation = +(s.saturation * look.sat).toFixed(3);
  const gamma = +(s.brightness * (1 + look.bright)).toFixed(3);
  const eqParts: string[] = [];
  if (contrast !== 1) eqParts.push(`contrast=${contrast}`);
  if (saturation !== 1) eqParts.push(`saturation=${saturation}`);
  if (gamma !== 1) eqParts.push(`gamma=${gamma}`);
  if (eqParts.length > 0) {
    vf.push(`eq=${eqParts.join(":")}`);
  }
  vf.push("unsharp=5:5:0.6:5:5:0.0");

  // Tiêu đề (overlay)
  if (s.overlayText) {
    const fs = Math.round(s.textSize * u);
    const yc = s.textPosition === "top" ? 0.12 : s.textPosition === "bottom" ? 0.85 : 0.5;
    vf.push(
      drawtext("title.txt", wrapText(s.overlayText, fs, W * 0.86), [
        `fontsize=${fs}`,
        `fontcolor=${toFfColor(s.textColor)}`,
        "x=(w-text_w)/2",
        `y=h*${yc}-text_h/2`,
        "box=1",
        `boxcolor=${toFfColor(s.textBgColor, 1, "0x000000@0.70")}`,
        `boxborderw=${Math.round(fs * 0.45)}`,
        "line_spacing=4",
      ]),
    );
  }

  // Phụ đề
  if (s.enableSubtitles && s.subtitlesScript) {
    const fs = Math.round(12 * u);
    vf.push(
      drawtext("subtitle.txt", wrapText(s.subtitlesScript, fs, W * 0.86), [
        `fontsize=${fs}`,
        "fontcolor=0xf4f0e8",
        "x=(w-text_w)/2",
        `y=h-${Math.round(30 * u)}-text_h`,
        "box=1",
        "boxcolor=0x000000@0.85",
        `boxborderw=${Math.round(6 * u)}`,
        "line_spacing=3",
      ]),
    );
  }

  // Watermark 1 (góc trên trái)
  if (s.enableBrandName1 && s.brandName1) {
    vf.push(
      drawtext("brand1.txt", s.brandName1, [
        `fontsize=${Math.round(s.brandName1Size * u)}`,
        `fontcolor=0xffffff@${s.brandName1Opacity.toFixed(2)}`,
        `x=${Math.round(12 * u)}`,
        `y=${Math.round(12 * u)}`,
        "shadowcolor=0x000000@0.85",
        `shadowx=${Math.max(1, Math.round(u))}`,
        `shadowy=${Math.max(1, Math.round(u))}`,
      ]),
    );
  }

  // Watermark 2 (giữa khung, chạy ngang hoặc đứng yên)
  if (s.enableBrandName2 && s.brandName2) {
    const x =
      s.brandName2Mode === "fixed"
        ? "(w-text_w)/2"
        : `w-mod(t*${Math.round(140 * u)}\\,w+text_w)`;
    vf.push(
      drawtext("brand2.txt", s.brandName2, [
        `fontsize=${Math.round(s.brandName2Size * u)}`,
        `fontcolor=0xffffff@${s.brandName2Opacity.toFixed(2)}`,
        `x=${x}`,
        "y=h*0.46-text_h/2",
      ]),
    );
  }

  vf.push("format=yuv420p");

  // ---- âm thanh: giữ đúng luồng gốc, không bao giờ map nguồn câm
  const wantAudio = b.hasAudio && s.enableOriginalAudio && s.originalVideoVolume > 0;
  const filterComplex: string[] = [`[0:v:0]${vf.join(",")}[vout]`];
  const map: string[] = ["-map", "[vout]"];
  if (wantAudio) {
    if (Math.abs(s.originalVideoVolume - 1) < 0.001) {
      map.push("-map", "0:a:0");
    } else {
      filterComplex.push(`[0:a:0]volume=${s.originalVideoVolume.toFixed(2)}[aout]`);
      map.push("-map", "[aout]");
    }
  }

  const codec = b.videoCodec || "libx264";
  const isNvenc = codec.includes("nvenc");
  const preset = b.preset || (isNvenc ? "p4" : "veryfast");
  const quality = b.quality ?? (isNvenc ? 22 : 20);

  const videoEncodeArgs = isNvenc
    ? [
        "-c:v",
        codec,
        "-preset",
        preset,
        "-cq:v",
        String(quality),
      ]
    : [
        "-c:v",
        codec,
        "-preset",
        preset,
        "-crf",
        String(quality),
      ];

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    "-protocol_whitelist",
    "file",
    "-ss",
    start.toFixed(3),
    "-i",
    b.inputPath,
    "-t",
    duration.toFixed(3),
    "-filter_complex",
    filterComplex.join(";"),
    ...map,
    ...videoEncodeArgs,
    "-pix_fmt",
    "yuv420p",
    ...(wantAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"] : []),
    // Tệp không có tiếng khi người dùng tắt âm / nguồn không có audio — chủ động, không nhúng track câm.
    ...(wantAudio ? [] : ["-an"]),
    "-movflags",
    "+faststart",
    b.outputPath,
  ];

  return { args, textFiles, width: W, height: H, duration };
}
