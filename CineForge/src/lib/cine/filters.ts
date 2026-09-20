import type { ColorFilter, VideoEditSettings } from "./types";

export const COLOR_FILTERS: { id: ColorFilter; label: string; css: string }[] = [
  { id: "normal", label: "Gốc", css: "" },
  { id: "cinematic", label: "Điện ảnh", css: "contrast(1.08) saturate(1.1)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.35)" },
  { id: "vintage", label: "Cổ điển", css: "sepia(0.2) contrast(1.02)" },
  { id: "warm", label: "Ấm", css: "sepia(0.1) saturate(1.15)" },
  { id: "vibrant", label: "Rực", css: "saturate(1.35) contrast(1.08)" },
  { id: "bw", label: "Đen trắng", css: "grayscale(1) contrast(1.2)" },
];

export function buildFilterCss(edit: VideoEditSettings): string {
  const preset = COLOR_FILTERS.find((f) => f.id === edit.colorFilter)?.css ?? "";
  return `brightness(${edit.brightness}) contrast(${edit.contrast}) saturate(${edit.saturation}) ${preset}`.trim();
}

export function aspectBoxClass(ratio: VideoEditSettings["aspectRatio"]): string {
  if (ratio === "9:16") return "aspect-[9/16]";
  if (ratio === "1:1") return "aspect-square";
  if (ratio === "4:5") return "aspect-[4/5]";
  return "aspect-video";
}

/**
 * Chiều rộng THAM CHIẾU (px) của khung xem trước cho từng tỷ lệ.
 * Cỡ chữ/khoảng cách người dùng chỉnh được hiểu theo đơn vị này; khi render,
 * mọi giá trị nhân với `canvasWidth / PREVIEW_REF_WIDTH[ratio]` để chữ giữ
 * đúng tỷ lệ so với khung hình (xem trước = xuất ra).
 */
export const PREVIEW_REF_WIDTH: Record<VideoEditSettings["aspectRatio"], number> = {
  "9:16": 360,
  "1:1": 480,
  "4:5": 432,
  "16:9": 640,
};

/** Đổi px theo khung tham chiếu sang đơn vị container-query (cqw) cho preview. */
export function refPx(px: number, ratio: VideoEditSettings["aspectRatio"]): string {
  return `${((px / PREVIEW_REF_WIDTH[ratio]) * 100).toFixed(3)}cqw`;
}
