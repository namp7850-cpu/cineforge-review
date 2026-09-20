import type { AudioSettings, VideoEditSettings, VideoItem } from "@/lib/cine/types";

export interface ServerRenderResult {
  url: string;
  blob?: Blob;
  duration: number;
  size: string;
  audioDetails: string;
}

type Progress = (percent: number, message: string) => void;

/** Máy chủ có hỗ trợ xuất MP4 bằng FFmpeg không? */
export async function isServerRenderAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/render/health", { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { available?: boolean };
    return data.available === true;
  } catch {
    return false;
  }
}

function encodeSettings(audio: AudioSettings, edit: VideoEditSettings): string {
  const payload = {
    aspectRatio: edit.aspectRatio,
    trimStart: edit.trimStart,
    trimEnd: edit.trimEnd,
    colorFilter: edit.colorFilter,
    brightness: edit.brightness,
    contrast: edit.contrast,
    saturation: edit.saturation,
    overlayText: edit.overlayText,
    textPosition: edit.textPosition,
    textColor: edit.textColor,
    textBgColor: edit.textBgColor,
    textSize: edit.textSize,
    enableSubtitles: edit.enableSubtitles,
    subtitlesScript: edit.subtitlesScript,
    brandName1: edit.brandName1,
    enableBrandName1: edit.enableBrandName1,
    brandName1Opacity: edit.brandName1Opacity,
    brandName1Size: edit.brandName1Size,
    brandName2: edit.brandName2,
    enableBrandName2: edit.enableBrandName2,
    brandName2Opacity: edit.brandName2Opacity,
    brandName2Size: edit.brandName2Size,
    brandName2Mode: edit.brandName2Mode,
    enableOriginalAudio: audio.enableOriginalAudio,
    originalVideoVolume: audio.originalVideoVolume,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function upload(blob: Blob, settings: string, onUpload: (fraction: number) => void, signal?: AbortSignal): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/render");
    xhr.setRequestHeader("x-render-settings", settings);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUpload(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Mất kết nối tới máy chủ khi tải video lên."));
    xhr.onabort = () => reject(new Error("Đã hủy."));
    xhr.onload = () => {
      let data: { id?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // phản hồi không phải JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve({ id: data.id });
      else reject(new Error(data.error || "Không thể bắt đầu xuất video."));
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}

export interface UploadedSource {
  /** Đường dẫn thật trên máy chủ, ví dụ `./uploads/video_123.mp4` */
  path: string;
  name: string;
  size: number;
}

/**
 * Gửi video từ máy lên máy chủ bằng FormData → `POST /api/upload`.
 * Trả về đường dẫn file thật trên máy chủ để lưu vào `sourceVideoPath`.
 */
export function uploadSourceVideo(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedSource> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Mất kết nối tới máy chủ khi tải video lên."));
    xhr.onabort = () => reject(new Error("Đã hủy."));
    xhr.onload = () => {
      let data: Partial<UploadedSource> & { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // phản hồi không phải JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof data.path === "string" && data.path) {
        resolve({ path: data.path, name: data.name ?? file.name, size: data.size ?? file.size });
      } else {
        reject(new Error(data.error || "Không tải được video lên máy chủ."));
      }
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

/** Bắt đầu render từ video ĐÃ nằm trên máy chủ (không gửi lại nội dung video). */
async function startRenderFromServerFile(
  sourceVideoPath: string,
  settings: string,
  signal?: AbortSignal,
): Promise<{ id: string }> {
  const res = await fetchWithRetry(
    "/api/render",
    { method: "POST", headers: { "x-render-settings": settings, "x-source-video-path": sourceVideoPath }, signal },
    3,
    1000,
  );
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error || "Không thể bắt đầu xuất video.");
  return { id: data.id };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * FIX ("Failed to fetch" làm hỏng cả tiến trình render đang chạy dở):
 * `fetch()` gốc trả lỗi mạng tức thời (mất mạng chập chờn, dev server bận xử
 * lý FFmpeg vài giây, Windows Defender/antivirus chặn tạm một request...) dưới
 * dạng `TypeError: Failed to fetch` — trước đây lỗi này rơi thẳng ra UI y
 * nguyên văn tiếng Anh, và làm dừng hẳn một tiến trình render có thể đang chạy
 * dở nhiều phút chỉ vì một request bị trượt. Giờ mọi fetch quan trọng (đặc
 * biệt là polling trạng thái/kết quả — chạy lặp lại rất nhiều lần trong lúc
 * FFmpeg xử lý) đều thử lại vài lần trước khi thật sự báo lỗi cho người dùng.
 */
async function fetchWithRetry(
  input: string,
  init: RequestInit | undefined,
  attempts: number,
  delayMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (init?.signal?.aborted) throw new Error("Đã hủy.");
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  console.error("[render] fetch thất bại sau khi thử lại:", lastErr);
  throw new Error(
    `Mất kết nối tới máy chủ (đã thử lại ${attempts} lần). Kiểm tra máy chủ dev vẫn đang chạy, tường lửa/antivirus không chặn kết nối cục bộ, rồi thử lại.`,
  );
}

/**
 * Xuất MP4 (H.264 + AAC, yuv420p — chuẩn TikTok/YouTube) bằng FFmpeg trên máy chủ.
 * Tiến độ: 0-20% chuẩn bị + tải lên, 20-99% máy chủ xử lý, 100% xong.
 */
export async function renderOnServer(
  video: VideoItem,
  audio: AudioSettings,
  edit: VideoEditSettings,
  onProgress: Progress,
  opts: { signal?: AbortSignal; sourceVideoPath?: string | null } = {},
): Promise<ServerRenderResult> {
  const { signal, sourceVideoPath } = opts;
  onProgress(2, "Đang chuẩn bị video…");
  const settings = encodeSettings(audio, edit);

  let id: string;
  if (sourceVideoPath) {
    // Video đã nằm sẵn trong ./uploads trên máy chủ → dựng ngay, không tải lại qua trình duyệt.
    // Máy chủ chỉ báo lỗi khi tệp không tồn tại hoặc dung lượng = 0 byte.
    onProgress(8, "Đang mở video nguồn trên máy chủ…");
    ({ id } = await startRenderFromServerFile(sourceVideoPath, settings, signal));
    onProgress(20, "Đang chờ máy chủ xử lý…");
  } else {
    // Nguồn chưa có trên máy chủ (video mẫu / link trực tiếp): đọc về rồi gửi lên như trước.
    let source: Blob;
    try {
      const res = await fetchWithRetry(video.url, { signal }, 3, 800);
      if (!res.ok) throw new Error(String(res.status));
      source = await res.blob();
    } catch {
      throw new Error("Không đọc được video nguồn. Hãy tải video về máy rồi chọn \"Tải video từ máy\".");
    }
    ({ id } = await upload(
      source,
      settings,
      (f) => onProgress(Math.round(4 + f * 16), "Đang tải video lên máy chủ…"),
      signal,
    ));
  }

  let duration = 0;
  let completedStatus: { duration: number; size?: number } = { duration: 0 };
  try {
    for (;;) {
      if (signal?.aborted) throw new Error("Đã hủy.");
      // 6 lần thử, backoff tăng dần — một request bị trượt giữa lúc FFmpeg đang
      // xử lý (có thể kéo dài nhiều phút) không được phép làm hỏng cả tiến trình.
      const res = await fetchWithRetry(`/api/render/${id}`, { cache: "no-store", signal }, 6, 1000);
      if (!res.ok) throw new Error("Mất liên lạc với máy chủ.");
      const st = (await res.json()) as {
        status: string;
        progress: number;
        message: string;
        error: string | null;
        duration: number;
        size?: number;
      };
      if (st.status === "error") throw new Error(st.error || "Xử lý video thất bại.");
      duration = st.duration;
      if (st.status === "done") {
        completedStatus = st;
        break;
      }
      onProgress(Math.min(99, 20 + Math.round(st.progress * 0.79)), st.message);
      await sleep(800);
    }

    onProgress(99, "Đang chuẩn bị video để xem và tải về…");
    const fileUrl = `/api/render/${id}/file`;
    const formattedSize = completedStatus.size && completedStatus.size > 0
      ? (completedStatus.size / (1024 * 1024)).toFixed(2) + " MB"
      : "MP4";

    // Thử tạo blob cục bộ nếu trình duyệt cho phép, nếu bị extension/CORS chặn thì dùng URL máy chủ trực tiếp
    let blob: Blob | null = null;
    try {
      const fileRes = await fetch(fileUrl, { signal });
      if (fileRes.ok) {
        blob = await fileRes.blob();
      }
    } catch (e) {
      console.warn("[render] Trình duyệt hoặc extension chặn tải blob vào RAM, chuyển sang dùng URL máy chủ trực tiếp:", e);
    }

    onProgress(100, "Đã hoàn thành!");
    return {
      url: blob ? URL.createObjectURL(blob) : fileUrl,
      blob: blob ?? undefined,
      duration: duration || completedStatus.duration,
      size: formattedSize,
      audioDetails: "MP4 · H.264 · AAC 48kHz",
    };
  } catch (err) {
    // Chỉ dọn dẹp khi thật sự có lỗi trong lúc xử lý
    void fetch(`/api/render/${id}`, { method: "DELETE" }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------- Module D: link YouTube/TikTok

/** Link thuộc YouTube/TikTok (cần máy chủ tải hộ, trình duyệt không tự phát được). */
export function isPlatformPageUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return ["youtube.com", "youtu.be", "tiktok.com"].some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

export async function isPlatformDownloadAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/render/health", { cache: "no-store" });
    if (!res.ok) return false;
    return ((await res.json()) as { download?: boolean }).download === true;
  } catch {
    return false;
  }
}

/** Nhờ máy chủ tải video từ link YouTube/TikTok rồi trả về Blob MP4. */
export async function fetchPlatformVideo(url: string, onProgress: Progress): Promise<Blob> {
  onProgress(1, "Đang lấy video từ liên kết…");
  const start = await fetchWithRetry(
    "/api/fetch-video",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) },
    3,
    1000,
  );
  const first = (await start.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!start.ok || !first.id) throw new Error(first.error || "Không thể bắt đầu tải video.");
  const id = first.id;
  try {
    for (;;) {
      const res = await fetchWithRetry(`/api/fetch-video/${id}`, { cache: "no-store" }, 6, 1000);
      if (!res.ok) throw new Error("Mất liên lạc với máy chủ.");
      const st = (await res.json()) as { status: string; progress: number; message: string; error: string | null };
      if (st.status === "error") throw new Error(st.error || "Không tải được video.");
      if (st.status === "done") break;
      onProgress(st.progress, `${st.message} ${st.progress}%`);
      await sleep(900);
    }
    onProgress(99, "Đang tải video về…");
    const file = await fetchWithRetry(`/api/fetch-video/${id}/file`, undefined, 3, 800);
    if (!file.ok) throw new Error("Không tải được video từ máy chủ.");
    return await file.blob();
  } finally {
    void fetch(`/api/fetch-video/${id}`, { method: "DELETE" }).catch(() => undefined);
  }
}
