import { useRef } from "react";
import { Download, Loader2 } from "lucide-react";
import { VideoExporter } from "@/lib/cine/videoExporter";
import { isServerRenderAvailable, renderOnServer } from "@/lib/render/client";
import { formatDuration } from "@/lib/cine/format";
import { useStudio } from "@/lib/cine/store";
import { Button } from "@/components/ui/button";
import { StepBanner } from "./StepBanner";

export function StepExport() {
  const selected = useStudio((s) => s.selectedVideo);
  const sourceVideoPath = useStudio((s) => s.sourceVideoPath);
  const audio = useStudio((s) => s.audio);
  const edit = useStudio((s) => s.edit);
  const render = useStudio((s) => s.render);
  const setRender = useStudio((s) => s.setRender);
  const setStep = useStudio((s) => s.setStep);
  const hiddenVideo = useRef<HTMLVideoElement | null>(null);

  const clip = Math.max(1, (edit.trimEnd || 0) - (edit.trimStart || 0));

  const start = async () => {
    if (!selected) return;
    setRender({
      isRendering: true,
      progress: 2,
      statusMessage: "Đang chuẩn bị video…",
      error: null,
    });
    try {
      const onProgress = (progress: number, statusMessage: string) => {
        setRender({ isRendering: true, progress, statusMessage, error: null });
      };
      // Ưu tiên FFmpeg trên máy chủ (MP4 H.264/AAC — tương thích TikTok).
      // Nếu máy chủ không có FFmpeg thì dùng chế độ trên trình duyệt (WebM).
      const serverOk = await isServerRenderAvailable();
      const result = serverOk
        ? // Có sourceVideoPath (./uploads/…) → máy chủ dựng thẳng từ tệp đó. Chỉ báo lỗi
          // "Không đọc được video nguồn" khi tệp không tồn tại hoặc dung lượng = 0 byte.
          await renderOnServer(selected, audio, edit, onProgress, { sourceVideoPath })
        : await VideoExporter.renderVideoWithAudio(selected, audio, edit, onProgress, hiddenVideo.current);
      const ext = serverOk ? "mp4" : "webm";
      const safeTitle = selected.title.slice(0, 28).replace(/\s+/g, "_");
      setRender({
        isRendering: false,
        progress: 100,
        statusMessage: "Đã hoàn thành!",
        exportedUrl: result.url,
        exportedBlob: result.blob,
        exportedFilename: `VEEK_${safeTitle}.${ext}`,
        exportedDuration: result.duration,
        exportedSize: result.size,
        hasAudio: true,
        audioDetails: serverOk ? result.audioDetails : `WebM (trình duyệt) · ${result.audioDetails}`,
        error: null,
      });
    } catch (err) {
      setRender({
        isRendering: false,
        error: err instanceof Error ? err.message : "Không xuất được video",
      });
    }
  };

  const download = () => {
    if (!render.exportedUrl) return;
    const a = document.createElement("a");
    const isServerPath = render.exportedUrl.startsWith("/") || render.exportedUrl.startsWith("http");
    a.href = isServerPath
      ? (render.exportedUrl.includes("?") ? `${render.exportedUrl}&download=1` : `${render.exportedUrl}?download=1`)
      : render.exportedUrl;
    a.download = render.exportedFilename || "cineforge-veek.mp4";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-6">
      <StepBanner
        kicker="Bước 04 / Xuất bản"
        title="Render có tiếng, đúng thời lượng"
        description={`Thời gian xuất dự kiến ≈ ${formatDuration(clip)}. Vui lòng giữ tab này mở trong lúc xuất.`}
        onBack={() => setStep("edit")}
      />

      {selected ? (
        <video
          ref={hiddenVideo}
          src={selected.url}
          crossOrigin="anonymous"
          playsInline
          className="sr-only"
          preload="auto"
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="space-y-4 rounded-[24px] border border-border bg-surface p-5">
          <h2 className="font-display text-xl text-fg">Bảng xuất</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-[16px] bg-bg p-3">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-subtle">Nguồn</dt>
              <dd className="mt-1 line-clamp-2 text-fg">{selected?.title ?? "—"}</dd>
            </div>
            <div className="rounded-[16px] bg-bg p-3">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-subtle">Thời lượng</dt>
              <dd className="mt-1 font-mono tabular-nums text-fg">{formatDuration(clip)}</dd>
            </div>
            <div className="rounded-[16px] bg-bg p-3">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-subtle">Khung</dt>
              <dd className="mt-1 text-fg">{edit.aspectRatio}</dd>
            </div>
            <div className="rounded-[16px] bg-bg p-3">
              <dt className="text-[11px] uppercase tracking-[0.14em] text-subtle">Watermark</dt>
              <dd className="mt-1 text-fg">
                {edit.enableBrandName1 ? edit.brandName1 : "—"} / {edit.enableBrandName2 ? edit.brandName2 : "—"}
              </dd>
            </div>
          </dl>

          {sourceVideoPath ? (
            <p className="break-all font-mono text-[11px] text-subtle">Tệp nguồn: {sourceVideoPath}</p>
          ) : null}

          {render.isRendering ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>{render.statusMessage}</span>
                <span className="font-mono tabular-nums">{render.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${render.progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {render.error ? <p className="text-sm text-rec">{render.error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={start} disabled={!selected || render.isRendering}>
              {render.isRendering ? <Loader2 className="size-4 animate-spin" /> : null}
              {render.isRendering ? "Đang xử lý…" : "🎬 Render Video"}
            </Button>
            <Button
              variant="secondary"
              onClick={download}
              disabled={!render.exportedUrl}
            >
              <Download className="size-4" />
              Tải về
            </Button>
          </div>
        </section>

        <section className="space-y-4 rounded-[24px] border border-border bg-surface p-5">
          <h2 className="font-display text-xl text-fg">Kết quả</h2>
          {render.exportedUrl ? (
            <div className="space-y-3">
              <video
                src={render.exportedUrl}
                controls
                playsInline
                className="w-full rounded-[16px] bg-bg"
              />
              <p className="text-xs text-subtle">
                Xem thử ngay tại đây trước khi tải về.
              </p>
              {render.exportedFilename.endsWith(".webm") ? (
                <p className="text-xs text-rec">
                  File WebM chưa tương thích TikTok. Hãy chạy ứng dụng trên máy chủ có FFmpeg để xuất MP4.
                </p>
              ) : null}
              <p className="text-sm text-muted">
                {render.exportedSize} · {formatDuration(render.exportedDuration)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">Chưa có video. Bấm "Render Video" để bắt đầu.</p>
          )}

        </section>
      </div>
    </div>
  );
}
