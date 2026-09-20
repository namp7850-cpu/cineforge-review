import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_AUDIO,
  DEFAULT_BRIEF,
  DEFAULT_EDIT,
  DEFAULT_RENDER,
  type AudioSettings,
  type GeneratedScript,
  type RenderResult,
  type ReviewBrief,
  type StepId,
  type VideoEditSettings,
  type VideoItem,
} from "./types";
import { SAMPLE_VIDEOS } from "./sampleVideos";
import { stripYoutubeIdTag } from "./format";

interface StudioState {
  currentStep: StepId;
  selectedVideo: VideoItem | null;
  /**
   * Đường dẫn file THẬT của video nguồn trên máy chủ (ví dụ "./uploads/video_123.mp4"),
   * do POST /api/upload trả về. null = nguồn chưa nằm trên máy chủ (video mẫu / link trực tiếp).
   */
  sourceVideoPath: string | null;
  audio: AudioSettings;
  edit: VideoEditSettings;
  brief: ReviewBrief;
  script: GeneratedScript | null;
  render: RenderResult;
  aiOpen: boolean;
  setStep: (step: StepId) => void;
  /** Chọn video nguồn. `sourceVideoPath` luôn được đặt lại (null nếu không truyền) để không bao giờ giữ đường dẫn của video cũ. */
  selectVideo: (video: VideoItem, sourceVideoPath?: string | null) => void;
  setSourceVideoPath: (path: string | null) => void;
  setAudio: (patch: Partial<AudioSettings> | ((prev: AudioSettings) => AudioSettings)) => void;
  setEdit: (
    patch: Partial<VideoEditSettings> | ((prev: VideoEditSettings) => VideoEditSettings),
  ) => void;
  setBrief: (patch: Partial<ReviewBrief>) => void;
  setScript: (script: GeneratedScript | null) => void;
  applyScript: (script: GeneratedScript) => void;
  setRender: (patch: Partial<RenderResult> | ((prev: RenderResult) => RenderResult)) => void;
  setAiOpen: (open: boolean) => void;
  resetProject: () => void;
}

const first = SAMPLE_VIDEOS[0];

// Mặc định KHÔNG cắt bớt gì cả — giữ nguyên 100% thời lượng video gốc.
// Người dùng tự nhập điểm bắt đầu/kết thúc chính xác ở bước Biên tập nếu muốn cắt ngắn.
function defaultTrimEnd(duration: number) {
  return duration;
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      currentStep: "import",
      selectedVideo: first,
      sourceVideoPath: null,
      audio: DEFAULT_AUDIO,
      edit: { ...DEFAULT_EDIT, trimEnd: defaultTrimEnd(first.duration), aspectRatio: first.aspectRatio },
      brief: {
        ...DEFAULT_BRIEF,
        filmTitle: first.title,
        year: first.filmYear ?? "",
        genre: first.filmGenre ?? "Chính kịch",
        targetSeconds: Math.min(90, first.duration),
      },
      script: null,
      render: DEFAULT_RENDER,
      aiOpen: false,
      setStep: (currentStep) => set({ currentStep }),
      selectVideo: (video, sourceVideoPath = null) =>
        set((s) => ({
          selectedVideo: video,
          sourceVideoPath,
          edit: {
            ...s.edit,
            trimStart: 0,
            trimEnd: defaultTrimEnd(video.duration),
            aspectRatio: video.aspectRatio === "9:16" ? "9:16" : s.edit.aspectRatio,
          },
          brief: {
            ...s.brief,
            filmTitle: s.brief.filmTitle || video.title,
            year: s.brief.year || video.filmYear || "",
            genre: video.filmGenre || s.brief.genre,
            targetSeconds: Math.min(s.brief.targetSeconds || 60, video.duration),
          },
        })),
      setSourceVideoPath: (sourceVideoPath) => set({ sourceVideoPath }),
      setAudio: (patch) =>
        set((s) => ({
          audio: typeof patch === "function" ? patch(s.audio) : { ...s.audio, ...patch },
        })),
      setEdit: (patch) =>
        set((s) => ({
          edit: typeof patch === "function" ? patch(s.edit) : { ...s.edit, ...patch },
        })),
      setBrief: (patch) => set((s) => ({ brief: { ...s.brief, ...patch } })),
      setScript: (script) => set({ script }),
      applyScript: (script) =>
        set((s) => ({
          script,
          edit: {
            ...s.edit,
            overlayText: script.catchyTitle || s.edit.overlayText,
            subtitlesScript: script.subtitles || script.hook,
            enableSubtitles: true,
          },
        })),
      setRender: (patch) =>
        set((s) => ({
          render: typeof patch === "function" ? patch(s.render) : { ...s.render, ...patch },
        })),
      setAiOpen: (aiOpen) => set({ aiOpen }),
      resetProject: () =>
        set({
          currentStep: "import",
          selectedVideo: first,
          sourceVideoPath: null,
          audio: DEFAULT_AUDIO,
          edit: { ...DEFAULT_EDIT, trimEnd: defaultTrimEnd(first.duration) },
          brief: DEFAULT_BRIEF,
          script: null,
          render: DEFAULT_RENDER,
        }),
    }),
    {
      name: "cineforge-veek-v2",
      skipHydration: true,
      // Dữ liệu cũ có thể lưu bước "pipeline" (đã gỡ) — đưa về bước xuất.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<typeof current>;
        const step = (p.currentStep as string) === "pipeline" ? "export" : p.currentStep;
        // Dữ liệu cũ trong localStorage có thể còn tên kiểu "… [xV8Yhov6S3M]" — xóa hẳn thẻ ID đó.
        const video = p.selectedVideo ? { ...p.selectedVideo, title: stripYoutubeIdTag(p.selectedVideo.title) } : p.selectedVideo;
        const brief = p.brief ? { ...p.brief, filmTitle: stripYoutubeIdTag(p.brief.filmTitle ?? "") } : p.brief;
        return {
          ...current,
          ...p,
          ...(video ? { selectedVideo: video } : {}),
          ...(brief ? { brief } : {}),
          sourceVideoPath: null,
          currentStep: step ?? current.currentStep,
        };
      },
      partialize: (s) => ({
        currentStep: s.currentStep,
        audio: s.audio,
        edit: s.edit,
        brief: s.brief,
        script: s.script,
        selectedVideo:
          s.selectedVideo && s.selectedVideo.source !== "upload"
            ? s.selectedVideo
            : first,
      }),
    },
  ),
);
