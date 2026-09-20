/**
 * Hàng đợi render FFmpeg phía máy chủ.
 *
 * - Video tải lên được ghi thẳng ra đĩa (streaming), không giữ trong RAM.
 * - FFmpeg gọi bằng spawn(args[]) — không qua shell.
 * - Client CHỈ nhận trạng thái/tiến độ bằng tiếng Việt; log của FFmpeg chỉ ghi
 *   ở console máy chủ, không bao giờ trả về trình duyệt.
 * - Tệp tạm nằm ở thư mục tạm của hệ điều hành và tự dọn sau TTL.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MAX_CLIP_SECONDS,
  buildFfmpegCommand,
  resolveClip,
  sanitizeSettings,
  type RenderSettings,
} from "./ffmpegCommand.ts";
import { resolveUploadedSource } from "./upload.server.ts";

export type JobStatus = "queued" | "probing" | "rendering" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0-100 (phần phía máy chủ)
  message: string;
  error: string | null;
  dir: string;
  inputPath: string;
  /** true: tệp đầu vào là bản tạm của job (được xóa khi xong). false: tệp trong /uploads — KHÔNG được xóa. */
  ownsInput: boolean;
  outputPath: string;
  settings: RenderSettings;
  duration: number;
  outputSize: number;
  createdAt: number;
  finishedAt: number | null;
  proc: ChildProcess | null;
}

const MAX_UPLOAD_BYTES = (Number(process.env.RENDER_MAX_UPLOAD_MB) || 1024) * 1024 * 1024;
const MAX_CONCURRENT = Math.max(1, Number(process.env.RENDER_MAX_CONCURRENT) || 1);
const MAX_QUEUE = 8;
const JOB_TTL_MS = 30 * 60 * 1000;
const RENDER_TIMEOUT_MS = 60 * 60 * 1000;
const ROOT = path.join(os.tmpdir(), "cineforge-render");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const ALLOWED_FORMATS = ["mov", "matroska", "avi", "flv", "mpegts", "mpeg", "ogg", "asf"];

interface Store {
  jobs: Map<string, Job>;
  queue: string[];
  sweeper: NodeJS.Timeout | null;
}
// Giữ trạng thái xuyên qua HMR của dev server
const g = globalThis as unknown as { __cineforgeRender?: Store };
const store: Store = (g.__cineforgeRender ??= { jobs: new Map(), queue: [], sweeper: null });

export class RenderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------ tiện ích tiến trình

function run(cmd: string, args: string[], timeoutMs = 30_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    let out = "";
    let p: ChildProcess;
    try {
      p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", () => undefined);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

let healthCache: { at: number; ok: boolean } | null = null;

/** FFmpeg + FFprobe + font có sẵn trên máy chủ này không? */
export async function isRenderAvailable(): Promise<boolean> {
  if (healthCache && Date.now() - healthCache.at < 60_000) return healthCache.ok;
  let ok = false;
  try {
    const a = await run(FFMPEG, ["-hide_banner", "-version"], 5000);
    const b = await run(FFPROBE, ["-hide_banner", "-version"], 5000);
    const f = await run(FFMPEG, ["-hide_banner", "-filters"], 5000);
    ok = a.code === 0 && b.code === 0 && /\bdrawtext\b/.test(f.out) && existsSync(resolveFontFile());
  } catch {
    ok = false;
  }
  healthCache = { at: Date.now(), ok };
  return ok;
}

export function resolveFontFile(): string {
  const candidates = [
    process.env.RENDER_FONT_FILE,
    path.join(process.cwd(), "server-assets", "fonts", "DejaVuSans-Bold.ttf"),
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

let nvencCache: { at: number; supported: boolean } | null = null;

/** Kiểm tra GPU NVIDIA (NVENC) có hoạt động trên FFmpeg không */
export async function isNvencAvailable(): Promise<boolean> {
  if (nvencCache && Date.now() - nvencCache.at < 5 * 60_000) return nvencCache.supported;
  let supported = false;
  try {
    const res = await run(
      FFMPEG,
      ["-hide_banner", "-f", "lavfi", "-i", "color=s=64x64:d=0.04", "-c:v", "h264_nvenc", "-f", "null", "-"],
      5000,
    );
    supported = res.code === 0;
  } catch {
    supported = false;
  }
  nvencCache = { at: Date.now(), supported };
  return supported;
}

/** Xác định codec video: NVENC (GPU) hoặc libx264 (CPU) */
export async function resolveVideoCodec(): Promise<string> {
  const envCodec = (process.env.FFMPEG_VIDEO_CODEC || "auto").trim().toLowerCase();
  if (envCodec === "h264_nvenc" || envCodec === "nvenc") {
    return "h264_nvenc";
  }
  if (envCodec === "libx264" || envCodec === "cpu") {
    return "libx264";
  }
  // Mặc định auto: tự dò GPU NVIDIA
  const hasNvenc = await isNvencAvailable();
  if (hasNvenc) {
    console.log("[render] Đã phát hiện GPU NVIDIA — kích hoạt phần cứng h264_nvenc.");
    return "h264_nvenc";
  }
  return "libx264";
}

/** Xác định preset tốc độ: veryfast/ultrafast (CPU) hoặc p4/fast (NVENC) */
export function resolvePreset(codec: string): string {
  if (process.env.FFMPEG_PRESET) {
    return process.env.FFMPEG_PRESET.trim();
  }
  return codec.includes("nvenc") ? "p4" : "veryfast";
}

export function resolveQuality(): number | string | undefined {
  if (process.env.FFMPEG_CRF) {
    return process.env.FFMPEG_CRF.trim();
  }
  return undefined;
}

// ------------------------------------------------------------ vòng đời job

function ensureSweeper() {
  if (store.sweeper) return;
  store.sweeper = setInterval(() => {
    const now = Date.now();
    for (const job of store.jobs.values()) {
      const age = now - (job.finishedAt ?? job.createdAt);
      if ((job.finishedAt !== null && age > JOB_TTL_MS) || age > JOB_TTL_MS * 4) void removeJob(job.id);
    }
  }, 60_000);
  store.sweeper.unref?.();
}

export function getJob(id: string): Job | undefined {
  return /^[a-f0-9]{32}$/.test(id) ? store.jobs.get(id) : undefined;
}

export async function removeJob(id: string): Promise<void> {
  const job = store.jobs.get(id);
  if (!job) return;
  job.proc?.kill("SIGKILL");
  store.jobs.delete(id);
  store.queue = store.queue.filter((q) => q !== id);
  await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Nhận video (stream) + cấu hình, tạo job và đưa vào hàng đợi. */
export async function createJob(body: ReadableStream<Uint8Array>, rawSettings: unknown, declaredLength: number | null): Promise<Job> {
  if (!(await isRenderAvailable())) throw new RenderError("Máy chủ chưa hỗ trợ xuất MP4.", 503);
  if (declaredLength !== null && declaredLength > MAX_UPLOAD_BYTES) {
    throw new RenderError(`Video quá lớn (tối đa ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).`, 413);
  }
  const active = [...store.jobs.values()].filter((j) => j.status !== "done" && j.status !== "error").length;
  if (active >= MAX_CONCURRENT + MAX_QUEUE) throw new RenderError("Máy chủ đang bận, vui lòng thử lại sau ít phút.", 429);

  ensureSweeper();
  const id = randomBytes(16).toString("hex");
  const dir = path.join(ROOT, id);
  await mkdir(dir, { recursive: true });
  const job: Job = {
    id,
    status: "queued",
    progress: 0,
    message: "Đang tải video lên…",
    error: null,
    dir,
    inputPath: path.join(dir, "input.bin"),
    ownsInput: true,
    outputPath: path.join(dir, "output.mp4"),
    settings: sanitizeSettings(rawSettings),
    duration: 0,
    outputSize: 0,
    createdAt: Date.now(),
    finishedAt: null,
    proc: null,
  };
  store.jobs.set(id, job);

  try {
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) cb(new RenderError("Video quá lớn.", 413));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(job.inputPath));
    if (received === 0) throw new RenderError("Không nhận được dữ liệu video.");
  } catch (e) {
    await removeJob(id);
    throw e instanceof RenderError ? e : new RenderError("Tải video lên thất bại.", 400);
  }

  job.message = "Đang chờ đến lượt xử lý…";
  store.queue.push(id);
  pump();
  return job;
}

/**
 * Tạo job từ video ĐÃ nằm sẵn trên máy chủ (`sourceVideoPath` = `./uploads/<tên>`),
 * không cần trình duyệt gửi lại nội dung video. Chỉ lỗi khi tệp không tồn tại hoặc 0 byte.
 */
export async function createJobFromUpload(sourceVideoPath: unknown, rawSettings: unknown): Promise<Job> {
  if (!(await isRenderAvailable())) throw new RenderError("Máy chủ chưa hỗ trợ xuất MP4.", 503);
  const active = [...store.jobs.values()].filter((j) => j.status !== "done" && j.status !== "error").length;
  if (active >= MAX_CONCURRENT + MAX_QUEUE) throw new RenderError("Máy chủ đang bận, vui lòng thử lại sau ít phút.", 429);

  const source = await resolveUploadedSource(sourceVideoPath); // ném UploadError nếu thiếu / 0 byte

  ensureSweeper();
  const id = randomBytes(16).toString("hex");
  const dir = path.join(ROOT, id);
  await mkdir(dir, { recursive: true });
  const job: Job = {
    id,
    status: "queued",
    progress: 0,
    message: "Đang chờ đến lượt xử lý…",
    error: null,
    dir,
    inputPath: source.absPath,
    ownsInput: false,
    outputPath: path.join(dir, "output.mp4"),
    settings: sanitizeSettings(rawSettings),
    duration: 0,
    outputSize: 0,
    createdAt: Date.now(),
    finishedAt: null,
    proc: null,
  };
  store.jobs.set(id, job);
  store.queue.push(id);
  pump();
  return job;
}

function running(): number {
  return [...store.jobs.values()].filter((j) => j.status === "probing" || j.status === "rendering").length;
}

function pump() {
  while (running() < MAX_CONCURRENT && store.queue.length) {
    const id = store.queue.shift() as string;
    const job = store.jobs.get(id);
    if (job && job.status === "queued") void processJob(job);
  }
}

function fail(job: Job, message: string) {
  job.status = "error";
  job.error = message;
  job.message = message;
  job.finishedAt = Date.now();
  job.proc = null;
  if (job.ownsInput) void rm(job.inputPath, { force: true }).catch(() => undefined);
  pump();
}

async function probe(job: Job): Promise<{ duration: number; hasAudio: boolean }> {
  const res = await run(FFPROBE, [
    "-v", "error",
    "-protocol_whitelist", "file",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    job.inputPath,
  ]);
  if (res.code !== 0) throw new RenderError("Tệp không phải video hợp lệ.");
  let info: { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string }[] };
  try {
    info = JSON.parse(res.out);
  } catch {
    throw new RenderError("Không đọc được thông tin video.");
  }
  const formats = (info.format?.format_name ?? "").split(",");
  // Chặn playlist/concat/... (có thể trỏ tới tệp khác trên máy chủ)
  if (!formats.some((f) => ALLOWED_FORMATS.includes(f))) throw new RenderError("Định dạng video không được hỗ trợ.");
  const streams = info.streams ?? [];
  if (!streams.some((s) => s.codec_type === "video")) throw new RenderError("Tệp không có hình ảnh video.");
  const duration = Number(info.format?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : MAX_CLIP_SECONDS,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

async function processJob(job: Job): Promise<void> {
  try {
    job.status = "probing";
    job.progress = 2;
    job.message = "Đang bóc tách video…";
    const { duration: srcDuration, hasAudio } = await probe(job);

    const videoCodec = await resolveVideoCodec();
    const preset = resolvePreset(videoCodec);
    const quality = resolveQuality();
    console.log(`[render ${job.id}] Bắt đầu render: codec=${videoCodec}, preset=${preset}`);

    const cmd = buildFfmpegCommand({
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      workDir: job.dir,
      fontFile: resolveFontFile(),
      settings: job.settings,
      hasAudio,
      sourceDuration: srcDuration,
      videoCodec,
      preset,
      quality,
    });
    await Promise.all(cmd.textFiles.map((t) => writeFile(path.join(job.dir, t.name), t.content, "utf8")));
    job.duration = resolveClip(job.settings, srcDuration).duration;

    job.status = "rendering";
    job.progress = 8;
    job.message = "Đang xử lý hiệu ứng & render…";

    await new Promise<void>((resolve, reject) => {
      const p = spawn(FFMPEG, cmd.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      job.proc = p;
      const timer = setTimeout(() => p.kill("SIGKILL"), RENDER_TIMEOUT_MS);
      let buf = "";
      let errLog = "";
      p.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m && job.duration > 0) {
            const sec = Number(m[1]) / 1_000_000;
            job.progress = Math.min(97, Math.max(job.progress, 8 + Math.round((sec / job.duration) * 89)));
          }
        }
      });
      p.stderr?.on("data", (d: Buffer) => {
        if (errLog.length < 8000) errLog += d.toString();
      });
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          console.error(`[render ${job.id}] ffmpeg exit ${code}\n${errLog}`);
          reject(new RenderError("Không thể xử lý video này.", 500));
        }
      });
    });

    const st = await stat(job.outputPath);
    job.outputSize = st.size;
    job.status = "done";
    job.progress = 100;
    job.message = "Đã hoàn thành!";
    job.finishedAt = Date.now();
    job.proc = null;
    if (job.ownsInput) void rm(job.inputPath, { force: true }).catch(() => undefined);
    pump();
  } catch (e) {
    fail(job, e instanceof RenderError ? e.message : "Xử lý video thất bại.");
    if (!(e instanceof RenderError)) console.error(`[render ${job.id}]`, e);
  }
}

export function publicStatus(job: Job) {
  const queuePos = job.status === "queued" ? store.queue.indexOf(job.id) + 1 : 0;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.status === "queued" && queuePos > 0 ? `Đang chờ đến lượt (vị trí ${queuePos})…` : job.message,
    error: job.error,
    duration: job.duration,
    size: job.outputSize,
  };
}
