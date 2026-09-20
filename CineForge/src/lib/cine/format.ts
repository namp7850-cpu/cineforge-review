/**
 * Định dạng thời lượng (giây) sang dạng dễ đọc.
 * < 60s  -> "12.3s"
 * >= 60s -> "2 phút 05s" (và kèm mm:ss dạng đồng hồ khi cần)
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds || 0);
  if (s < 60) return `${s.toFixed(1)}s`;
  const minutes = Math.floor(s / 60);
  const seconds = Math.round(s % 60);
  return `${minutes} phút ${seconds.toString().padStart(2, '0')}s`;
}

/** Dạng đồng hồ mm:ss (hoặc h:mm:ss nếu vượt 1 giờ) */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Ngược lại với formatClock — cho phép người dùng gõ trực tiếp thời điểm
 * chính xác vào ô nhập liệu, chấp nhận cả "12.5" (giây) lẫn "1:02" / "1:02:03"
 * (mm:ss / h:mm:ss). Trả về null nếu chuỗi không hợp lệ.
 */
export function parseClock(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!raw.includes(':')) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const parts = raw.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  let seconds = 0;
  if (nums.length === 2) {
    const [m, s] = nums;
    seconds = m * 60 + s;
  } else if (nums.length === 3) {
    const [h, m, s] = nums;
    seconds = h * 3600 + m * 60 + s;
  } else {
    return null;
  }
  return seconds >= 0 ? seconds : null;
}

/** Xóa thẻ ID kiểu yt-dlp (ví dụ " [xV8Yhov6S3M]") khỏi tên video/tiêu đề. */
export function stripYoutubeIdTag(text: string): string {
  return text.replace(/\s*\[[A-Za-z0-9_-]{11}\]/g, "").trim();
}
