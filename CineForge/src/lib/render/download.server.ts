/**
 * Module D — tải video từ link YouTube/TikTok bằng yt-dlp, chạy phía máy chủ.
 *
 * - Chỉ nhận host trong danh sách cho phép (chống SSRF/lạm dụng làm proxy tải).
 * - yt-dlp gọi bằng spawn(args[]) + "--" trước URL; không qua shell.
 * - Không trả log của yt-dlp về trình duyệt.
 * - Chỉ dùng cho nội dung của bạn hoặc bạn có quyền sử dụng; tuân thủ điều khoản nền tảng.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DlStatus = "downloading" | "done" | "error";

interface DlJob {
  id: string;
  status: DlStatus;
  progress: number;
  message: string;
  error: string | null;
  dir: string;
  filePath: string | null;
  size: number;
  createdAt: number;
  finishedAt: number | null;
  proc: ChildProcess | null;
}

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const ROOT = path.join(os.tmpdir(), "cineforge-download");
const MAX_ACTIVE = 2;
const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 15 * 60 * 1000;
const MAX_FILESIZE = process.env.DOWNLOAD_MAX_SIZE || "1G";
const HOSTS = [
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  ...(process.env.DOWNLOAD_EXTRA_HOSTS?.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) ?? []),
];

const g = globalThis as unknown as { __cineforgeDl?: Map<string, DlJob> };
const jobs: Map<string, DlJob> = (g.__cineforgeDl ??= new Map());

export class DownloadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Trả về URL chuẩn hóa nếu hợp lệ + thuộc host cho phép, ngược lại null. */
export function normalizePlatformUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!HOSTS.some((h) => host === h || host.endsWith("." + h))) return null;
  return u.toString();
}

let availCache: { at: number; ok: boolean } | null = null;
export function isDownloadAvailable(): Promise<boolean> {
  if (availCache && Date.now() - availCache.at < 60_000) return Promise.resolve(availCache.ok);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      availCache = { at: Date.now(), ok };
      resolve(ok);
    };
    try {
      const p = spawn(YTDLP, ["--version"], { stdio: "ignore", windowsHide: true });
      p.on("error", () => done(false));
      p.on("close", (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

export function getDlJob(id: string): DlJob | undefined {
  return /^[a-f0-9]{32}$/.test(id) ? jobs.get(id) : undefined;
}

export async function removeDlJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.proc?.kill("SIGKILL");
  jobs.delete(id);
  await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
}

let sweeper: NodeJS.Timeout | null = null;
function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const j of jobs.values()) {
      if (Date.now() - (j.finishedAt ?? j.createdAt) > TTL_MS) void removeDlJob(j.id);
    }
  }, 60_000);
  sweeper.unref?.();
}

export async function startDownload(rawUrl: unknown): Promise<DlJob> {
  const url = normalizePlatformUrl(rawUrl);
  if (!url) throw new DownloadError("Chỉ hỗ trợ link YouTube hoặc TikTok hợp lệ.");
  if (!(await isDownloadAvailable())) throw new DownloadError("Máy chủ chưa hỗ trợ tải video từ link.", 503);
  if ([...jobs.values()].filter((j) => j.status === "downloading").length >= MAX_ACTIVE) {
    throw new DownloadError("Máy chủ đang bận, vui lòng thử lại sau ít phút.", 429);
  }
  ensureSweeper();
  const id = randomBytes(16).toString("hex");
  const dir = path.join(ROOT, id);
  await mkdir(dir, { recursive: true });
  const job: DlJob = {
    id,
    status: "downloading",
    progress: 1,
    message: "Đang lấy video từ liên kết…",
    error: null,
    dir,
    filePath: null,
    size: 0,
    createdAt: Date.now(),
    finishedAt: null,
    proc: null,
  };
  jobs.set(id, job);

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-part",
    "--newline",
    "--socket-timeout", "20",
    "--retries", "3",
    "--max-filesize", MAX_FILESIZE,
    "--match-filter", "!is_live",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4",
    "--progress-template", "PCT:%(progress._percent_str)s",
    "-o", path.join(dir, "video.%(ext)s"),
    "--",
    url,
  ];

  let errLog = "";
  let buf = "";
  const p = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  job.proc = p;
  const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT_MS);
  p.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const m = /^PCT:\s*([\d.]+)%/.exec(line);
      if (m) job.progress = Math.min(98, Math.max(job.progress, Math.round(Number(m[1]))));
    }
  });
  p.stderr?.on("data", (d: Buffer) => {
    if (errLog.length < 6000) errLog += d.toString();
  });
  const fail = (msg: string) => {
    job.status = "error";
    job.error = msg;
    job.message = msg;
    job.finishedAt = Date.now();
    job.proc = null;
  };
  p.on("error", () => {
    clearTimeout(timer);
    fail("Không thể tải video từ liên kết này.");
  });
  p.on("close", async (code) => {
    clearTimeout(timer);
    if (code !== 0) {
      console.error(`[download ${id}] yt-dlp exit ${code}\n${errLog}`);
      fail("Không tải được video từ liên kết này (video riêng tư, bị chặn hoặc quá lớn).");
      return;
    }
    try {
      const files = (await readdir(dir)).filter((f) => /^video\.(mp4|mkv|webm|mov)$/.test(f));
      if (!files.length) throw new Error("no output");
      const file = files.includes("video.mp4") ? "video.mp4" : files[0];
      job.filePath = path.join(dir, file);
      job.size = (await stat(job.filePath)).size;
      job.status = "done";
      job.progress = 100;
      job.message = "Đã lấy xong video!";
      job.finishedAt = Date.now();
      job.proc = null;
    } catch {
      fail("Không tìm thấy video sau khi tải.");
    }
  });
  return job;
}

export function publicDlStatus(j: DlJob) {
  return { id: j.id, status: j.status, progress: j.progress, message: j.message, error: j.error, size: j.size };
}
