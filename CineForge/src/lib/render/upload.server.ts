/**
 * Tải video từ máy lên máy chủ + kiểm tra tệp nguồn khi render.
 *
 * - Video được ghi thẳng ra đĩa trong thư mục `./uploads` (đổi bằng UPLOAD_DIR).
 * - Đường dẫn trả về cho trình duyệt luôn có dạng `./uploads/<tên>` — trình
 *   duyệt chỉ giữ chuỗi này (`sourceVideoPath`) rồi gửi lại khi render.
 * - `resolveUploadedSource` là NƠI DUY NHẤT quyết định "video nguồn không đọc
 *   được": chỉ khi tệp không tồn tại hoặc dung lượng = 0 byte.
 * - Tên tệp do máy chủ tự sinh; khi đọc lại chỉ nhận đúng mẫu tên đó (không
 *   dấu "/", không "..", không symlink) nên không thể trỏ ra ngoài `./uploads`.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
/** Tiền tố hiển thị/trao đổi với trình duyệt. */
export const UPLOAD_PUBLIC_PREFIX = "./uploads/";

export const MAX_UPLOAD_BYTES = (Number(process.env.UPLOAD_MAX_MB || process.env.RENDER_MAX_UPLOAD_MB) || 1024) * 1024 * 1024;
const TTL_MS = (Number(process.env.UPLOAD_TTL_HOURS) || 24) * 60 * 60 * 1000;

const ALLOWED_EXT = [".mp4", ".webm", ".mov", ".m4v"];
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
};
const SAFE_NAME = /^[A-Za-z0-9_-]{1,80}\.(mp4|webm|mov|m4v)$/;

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface SavedUpload {
  /** Đường dẫn thật trên máy chủ, ví dụ `./uploads/video_1758342000000_a1b2c3d4.mp4` */
  path: string;
  name: string;
  size: number;
}

function pickExtension(file: File): string | null {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (ALLOWED_EXT.includes(fromName)) return fromName;
  return MIME_TO_EXT[(file.type || "").toLowerCase()] ?? null;
}

/** Từ chối sớm theo Content-Length, trước khi phải đọc cả tệp. */
export function assertDeclaredLength(len: number | null): void {
  if (len !== null && Number.isFinite(len) && len > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new UploadError(`Video quá lớn (tối đa ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).`, 413);
  }
}

/** Ghi tệp vào `./uploads` và trả về đường dẫn thật. */
export async function saveUpload(file: File): Promise<SavedUpload> {
  if (file.size === 0) throw new UploadError("Tệp video rỗng (0 byte). Hãy chọn lại tệp khác.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(`Video quá lớn (tối đa ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB).`, 413);
  }
  const ext = pickExtension(file);
  if (!ext) throw new UploadError("Định dạng không được hỗ trợ — chỉ nhận MP4, WebM, MOV, M4V.", 415);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `video_${Date.now()}_${randomBytes(4).toString("hex")}${ext}`;
  const dest = path.join(UPLOAD_DIR, name);

  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(dest, { flags: "wx" }));
    const st = await lstat(dest);
    if (!st.isFile() || st.size === 0) throw new UploadError("Ghi tệp lên máy chủ thất bại (tệp rỗng).", 500);
    void sweepOldUploads();
    return { path: UPLOAD_PUBLIC_PREFIX + name, name, size: st.size };
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined);
    if (e instanceof UploadError) throw e;
    console.error("[upload] write failed", e);
    throw new UploadError("Không lưu được video lên máy chủ.", 500);
  }
}

/**
 * Đổi `sourceVideoPath` (dạng `./uploads/<tên>`) thành đường dẫn tuyệt đối và
 * kiểm tra tệp. CHỈ báo lỗi khi tệp không tồn tại hoặc file_size == 0.
 */
export async function resolveUploadedSource(raw: unknown): Promise<{ absPath: string; size: number }> {
  const notFound = new UploadError(
    "Không đọc được video nguồn: tệp không còn trong thư mục /uploads. Hãy tải lại video từ máy.",
    404,
  );
  if (typeof raw !== "string") throw notFound;
  const rel = raw.trim().replace(/^\.?\/?uploads\//, "");
  if (!SAFE_NAME.test(rel)) throw notFound;

  const abs = path.join(UPLOAD_DIR, rel);
  let st;
  try {
    st = await lstat(abs); // lstat: không đi theo symlink
  } catch {
    throw notFound;
  }
  if (!st.isFile()) throw notFound;
  if (st.size === 0) throw new UploadError("Video nguồn trong /uploads có dung lượng 0 byte. Hãy tải lại video từ máy.", 422);
  return { absPath: abs, size: st.size };
}

let lastSweep = 0;
/** Dọn tệp tải lên cũ hơn UPLOAD_TTL_HOURS (mặc định 24 giờ), tối đa 1 lần/10 phút. */
async function sweepOldUploads(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 10 * 60 * 1000) return;
  lastSweep = now;
  try {
    for (const name of await readdir(UPLOAD_DIR)) {
      if (!SAFE_NAME.test(name)) continue;
      const p = path.join(UPLOAD_DIR, name);
      const st = await lstat(p).catch(() => null);
      if (st?.isFile() && now - st.mtimeMs > TTL_MS) await rm(p, { force: true }).catch(() => undefined);
    }
  } catch {
    // thư mục chưa có / không đọc được — bỏ qua
  }
}
