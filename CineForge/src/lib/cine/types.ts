export type StepId = "import" | "script" | "edit" | "export";

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export type ColorFilter =
  | "normal"
  | "cinematic"
  | "vibrant"
  | "vintage"
  | "bw"
  | "noir"
  | "warm";

export type VideoSource = "search" | "url" | "upload" | "sample";

export interface VideoItem {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  duration: number;
  source: VideoSource;
  category: string;
  resolution: string;
  aspectRatio: AspectRatio;
  author: string;
  views?: string;
  filmYear?: string;
  filmGenre?: string;
}

export interface AudioSettings {
  originalVideoVolume: number;
  sfxVolume: number;
  enableOriginalAudio: boolean;
  normalizeAudio: boolean;
  sampleRate: 44100 | 48000;
  audioBitrate: string;
}

export interface VideoEditSettings {
  trimStart: number;
  trimEnd: number;
  colorFilter: ColorFilter;
  brightness: number;
  contrast: number;
  saturation: number;
  playbackSpeed: number;
  overlayText: string;
  textPosition: "top" | "center" | "bottom";
  textColor: string;
  textBgColor: string;
  textSize: number;
  enableSubtitles: boolean;
  subtitlesScript: string;
  aspectRatio: AspectRatio;
  brandName1: string;
  enableBrandName1: boolean;
  brandName1Opacity: number;
  brandName1Size: number;
  brandName2: string;
  enableBrandName2: boolean;
  brandName2Opacity: number;
  brandName2Size: number;
  /** "marquee" = chạy ngang khắp video (như cũ) · "fixed" = đứng yên một chỗ */
  brandName2Mode: "marquee" | "fixed";
}

export interface ReviewBrief {
  filmTitle: string;
  year: string;
  genre: string;
  tone: string;
  spoilerLevel: "none" | "light" | "full";
  targetSeconds: number;
  platform: "youtube" | "tiktok" | "both";
}

export interface GeneratedScript {
  catchyTitle: string;
  hook: string;
  content: string;
  cta: string;
  subtitles: string;
  hashtags: string[];
  thumbnailText: string;
  provider?: string;
}

export interface RenderResult {
  isRendering: boolean;
  progress: number;
  statusMessage: string;
  exportedUrl: string | null;
  exportedBlob: Blob | null;
  exportedFilename: string;
  exportedDuration: number;
  exportedSize: string;
  hasAudio: boolean;
  audioDetails: string;
  error?: string | null;
}

export const DEFAULT_AUDIO: AudioSettings = {
  originalVideoVolume: 1.0,
  sfxVolume: 0.8,
  enableOriginalAudio: true,
  normalizeAudio: true,
  sampleRate: 48000,
  audioBitrate: "192k",
};

export const DEFAULT_EDIT: VideoEditSettings = {
  trimStart: 0,
  trimEnd: 0,
  colorFilter: "normal",
  brightness: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  playbackSpeed: 1.0,
  overlayText: "VEEK REVIEW",
  textPosition: "top",
  textColor: "#f4f0e8",
  textBgColor: "rgba(12, 10, 9, 0.72)",
  textSize: 22,
  enableSubtitles: true,
  subtitlesScript:
    "Cảnh trong phim không phải thật — khán giả cân nhắc trước khi xem.",
  aspectRatio: "16:9",
  brandName1: "VEEK REVIEW",
  enableBrandName1: true,
  brandName1Opacity: 1,
  brandName1Size: 20,
  brandName2: "veekreview",
  enableBrandName2: true,
  brandName2Opacity: 0.15,
  brandName2Size: 13,
  brandName2Mode: "marquee",
};

export const DEFAULT_BRIEF: ReviewBrief = {
  filmTitle: "",
  year: "",
  genre: "Chính kịch",
  tone: "kịch tính, cuốn hút, giàu cảm xúc",
  spoilerLevel: "light",
  targetSeconds: 60,
  platform: "youtube",
};

export const DEFAULT_RENDER: RenderResult = {
  isRendering: false,
  progress: 0,
  statusMessage: "Chưa xuất video",
  exportedUrl: null,
  exportedBlob: null,
  exportedFilename: "",
  exportedDuration: 0,
  exportedSize: "0 MB",
  hasAudio: false,
  audioDetails: "",
};

export const STEPS: { id: StepId; number: string; label: string; hint: string }[] = [
  { id: "import", number: "01", label: "Nhập nguồn", hint: "Clip, trailer, file" },
  { id: "script", number: "02", label: "Kịch bản", hint: "Hồ sơ & phụ đề" },
  { id: "edit", number: "03", label: "Biên tập", hint: "Cắt, màu, watermark" },
  { id: "export", number: "04", label: "Xuất bản", hint: "Render có tiếng" },
];
