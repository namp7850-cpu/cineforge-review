import { useState } from "react";
import { Film, Link2, Upload } from "lucide-react";
import { SAMPLE_VIDEOS } from "@/lib/cine/sampleVideos";
import { useStudio } from "@/lib/cine/store";
import { formatClock, stripYoutubeIdTag } from "@/lib/cine/format";
import type { VideoItem } from "@/lib/cine/types";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextInput } from "@/components/ui/field";
import { StepBanner } from "./StepBanner";
import { fetchPlatformVideo, isPlatformDownloadAvailable, isPlatformPageUrl, uploadSourceVideo } from "@/lib/render/client";

const FALLBACK_THUMB = SAMPLE_VIDEOS[0].thumbnail;

/**
 * Chụp một khung hình thật từ video (thay vì dùng ảnh placeholder có sẵn) để
 * làm thumbnail — giúp thẻ video hiển thị đúng nội dung thật, rõ nét.
 */
function captureFrame(videoEl: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth || 640;
    canvas.height = videoEl.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    // Cross-origin video không cho phép đọc pixel — bỏ qua, dùng ảnh mặc định
    return null;
  }
}

export function StepImport() {
  const selected = useStudio((s) => s.selectedVideo);
  const selectVideo = useStudio((s) => s.selectVideo);
  const setStep = useStudio((s) => s.setStep);
  const sourceVideoPath = useStudio((s) => s.sourceVideoPath);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileMsg, setFileMsg] = useState<string | null>(null);

  const isCustomSource = selected?.source === "upload" || selected?.source === "url";

  /**
   * Phát hiện sớm các link TRANG XEM (YouTube/TikTok/Facebook/Instagram/Vimeo…)
   * thay vì link file MP4 thô. Trình duyệt không thể decode HTML của trang xem
   * như một video — cố tải sẽ luôn ra màn hình đen, kẹt ở 0:00 mà không có lỗi
   * rõ ràng nào. Chặn ngay từ đầu và báo lỗi dễ hiểu thay vì để người dùng đoán.
   */
  function detectPageUrlIssue(raw: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return "Link không hợp lệ — hãy dán một đường dẫn đầy đủ, bắt đầu bằng https://";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Chỉ hỗ trợ link http/https.";
    }
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    const hasDirectVideoExt = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(path);
    if (hasDirectVideoExt) return null;

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      return "Đây là link trang xem YouTube, không phải file MP4 gốc. Trình duyệt không tải được video từ trang xem — hãy dùng link tải trực tiếp (đuôi .mp4) hoặc tải video về máy rồi dùng \"Tải video từ máy\".";
    }
    if (host === "tiktok.com" && !hasDirectVideoExt) {
      return "Đây là link trang xem TikTok, không phải file MP4 gốc. Hãy tải video về máy rồi dùng \"Tải video từ máy\", hoặc dán link file .mp4 trực tiếp.";
    }
    if (["facebook.com", "instagram.com", "vimeo.com", "twitter.com", "x.com"].includes(host)) {
      return `Đây là link trang xem của ${host}, không phải file MP4 gốc. Hãy tải video về máy rồi dùng "Tải video từ máy".`;
    }
    // Không nhận diện được là trang xem hay file trực tiếp — vẫn thử tải, nhưng
    // nếu thất bại sẽ báo lỗi rõ ràng (xem el.onerror bên dưới) thay vì màn hình đen.
    return null;
  }

  const ingestFromUrl = (raw: string) => {
    const trimmedRaw = raw.trim();
    if (!trimmedRaw) return;
    setUrlError(null);

    // YouTube/TikTok: nhờ máy chủ (yt-dlp) tải hộ rồi nạp như file tải lên.
    if (isPlatformPageUrl(trimmedRaw)) {
      void (async () => {
        if (!(await isPlatformDownloadAvailable())) {
          setUrlError(detectPageUrlIssue(trimmedRaw) ?? "Máy chủ chưa hỗ trợ tải video từ link này.");
          return;
        }
        setBusy(true);
        try {
          const blob = await fetchPlatformVideo(trimmedRaw, (_p, m) => setFetchMsg(m));
          void ingestFile(new File([blob], "Video từ liên kết.mp4", { type: blob.type || "video/mp4" }), {
            onError: setUrlError,
            onMessage: setFetchMsg,
          });
        } catch (err) {
          setBusy(false);
          setUrlError(err instanceof Error ? err.message : "Không tải được video từ link.");
        } finally {
          setFetchMsg(null);
        }
      })();
      return;
    }

    const pageIssue = detectPageUrlIssue(trimmedRaw);
    if (pageIssue) {
      setUrlError(pageIssue);
      return;
    }

    setBusy(true);
    const isShort = /tiktok|shorts|reel/i.test(trimmedRaw);
    const actual = trimmedRaw;
    const el = document.createElement("video");
    el.preload = "metadata";
    el.crossOrigin = "anonymous";
    el.muted = true;
    el.src = actual;

    const timeoutId = window.setTimeout(() => {
      el.src = "";
      setBusy(false);
      setUrlError("Không tải được video trong thời gian cho phép — kiểm tra lại link hoặc thử tải file về máy.");
    }, 15000);

    const finish = (duration: number) => {
      window.clearTimeout(timeoutId);
      const seekTarget = Math.min(1, duration * 0.15);
      const buildItem = (thumbnail: string): VideoItem => ({
        id: `url-${Date.now()}`,
        title: `Nguồn liên kết · ${trimmedRaw.slice(0, 42)}`,
        url: actual,
        thumbnail,
        duration: Math.max(1, Math.round(duration)),
        source: "url",
        category: isShort ? "Shorts" : "Hành động",
        resolution: "1080p",
        aspectRatio: isShort ? "9:16" : "16:9",
        author: "Liên kết",
      });
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        selectVideo(buildItem(captureFrame(el) || FALLBACK_THUMB));
        setBusy(false);
      };
      if (Number.isFinite(seekTarget) && seekTarget > 0) {
        el.addEventListener("seeked", onSeeked);
        el.currentTime = seekTarget;
      } else {
        selectVideo(buildItem(captureFrame(el) || FALLBACK_THUMB));
        setBusy(false);
      }
    };
    el.onloadedmetadata = () => finish(el.duration || 30);
    el.onerror = () => {
      // KHÔNG chọn một video hỏng nữa (nguyên nhân gây màn hình đen, kẹt 0:00) —
      // báo lỗi rõ ràng để người dùng sửa link thay vì im lặng ghi nhận thất bại.
      window.clearTimeout(timeoutId);
      setBusy(false);
      setUrlError(
        "Không tải được video từ link này. Trình duyệt chỉ đọc được file MP4/WebM/MOV trực tiếp — kiểm tra lại link hoặc thử tải file về máy.",
      );
    };
  };

  /**
   * Bước 1: gửi file qua FormData tới POST /api/upload — máy chủ lưu vào ./uploads
   *         và trả về đường dẫn thật (ví dụ "./uploads/video_123.mp4").
   * Bước 2: đọc metadata + chụp thumbnail từ chính file trong trình duyệt (chỉ để xem trước).
   * Bước 3: chọn video và GHI ĐÈ `sourceVideoPath` bằng đường dẫn thật vừa nhận.
   */
  const ingestFile = async (
    file: File,
    report: { onError: (m: string | null) => void; onMessage: (m: string | null) => void } = {
      onError: setFileError,
      onMessage: setFileMsg,
    },
  ) => {
    report.onError(null);
    if (file.size === 0) {
      report.onError("Tệp video rỗng (0 byte). Hãy chọn lại tệp khác.");
      return;
    }
    setBusy(true);

    let serverPath: string;
    try {
      report.onMessage("Đang tải video lên máy chủ… 0%");
      const saved = await uploadSourceVideo(file, (f) => report.onMessage(`Đang tải video lên máy chủ… ${Math.round(f * 100)}%`));
      serverPath = saved.path;
    } catch (err) {
      setBusy(false);
      report.onMessage(null);
      report.onError(err instanceof Error ? err.message : "Không tải được video lên máy chủ.");
      return;
    }
    report.onMessage(null);

    const fileUrl = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    el.src = fileUrl;
    el.onloadedmetadata = () => {
      const vertical = el.videoHeight > el.videoWidth;
      const seekTarget = Math.min(1, (el.duration || 1) * 0.15);
      const buildItem = (thumbnail: string): VideoItem => ({
        id: `file-${Date.now()}`,
        title: stripYoutubeIdTag(file.name.replace(/\.[^.]+$/, "")) || "Video tải lên",
        url: fileUrl,
        thumbnail,
        duration: Math.max(1, Math.round(el.duration || 30)),
        source: "upload",
        category: "Tải lên",
        resolution: `${el.videoWidth}×${el.videoHeight}`,
        aspectRatio: vertical ? "9:16" : "16:9",
        author: "Máy tính của bạn",
      });
      const commit = () => {
        // Ghi đè sourceVideoPath bằng đường dẫn file MP4 thật trên máy chủ.
        selectVideo(buildItem(captureFrame(el) || FALLBACK_THUMB), serverPath);
        setBusy(false);
      };
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        commit();
      };
      if (Number.isFinite(seekTarget) && seekTarget > 0) {
        el.addEventListener("seeked", onSeeked);
        el.currentTime = seekTarget;
      } else {
        commit();
      }
    };
    el.onerror = () => {
      URL.revokeObjectURL(fileUrl);
      setBusy(false);
      report.onError("Trình duyệt không đọc được video này để xem trước. Hãy thử file MP4 (H.264) hoặc WebM.");
    };
  };

  return (
    <div className="space-y-6">
      <StepBanner
        kicker="Bước 01 / Nguồn"
        title="Chọn footage cho review"
        description="Tải file từ máy hoặc dán link MP4 trực tiếp. Thời lượng thật được đọc từ metadata."
        onNext={() => setStep("script")}
        nextLabel="Sang kịch bản"
        nextDisabled={!selected}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[20px] border border-border bg-surface p-4">
          <FieldLabel>Dán link MP4</FieldLabel>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ingestFromUrl(urlInput);
            }}
          >
            <TextInput
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="Link YouTube / TikTok / .mp4"
            />
            <Button type="submit" variant="secondary" disabled={busy || !urlInput.trim()}>
              <Link2 className="size-4" />
              {busy ? "Đang nạp" : "Lấy"}
            </Button>
          </form>
          {urlError ? (
            <p className="mt-2 text-xs font-medium text-rec">{urlError}</p>
          ) : fetchMsg ? (
            <p className="mt-2 text-xs text-muted">{fetchMsg}</p>
          ) : (
            <p className="mt-2 text-xs text-subtle">Dán link YouTube/TikTok hoặc link .mp4 trực tiếp. Chỉ dùng video bạn có quyền sử dụng.</p>
          )}
        </div>
        <label className="flex cursor-pointer flex-col justify-center rounded-[20px] border border-dashed border-border-strong bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[12px] bg-bg">
              <Upload className="size-4 text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-fg">Tải video từ máy</p>
              <p className="text-xs text-subtle">MP4, WebM, MOV — đọc đúng thời lượng</p>
            </div>
          </div>
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Gửi file qua FormData → POST /api/upload (xem ingestFile → uploadSourceVideo)
              if (file) void ingestFile(file);
              e.target.value = "";
            }}
          />
          {fileError ? (
            <p className="mt-3 text-xs font-medium text-rec">{fileError}</p>
          ) : fileMsg ? (
            <p className="mt-3 text-xs text-muted">{fileMsg}</p>
          ) : null}
        </label>
      </div>

      {isCustomSource && selected ? (
        <div className="overflow-hidden rounded-[20px] border border-accent bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Film className="size-4 text-accent" />
            <p className="text-sm font-medium text-fg">Video vừa thêm — sẵn sàng dùng ngay</p>
            {busy ? <span className="ml-auto text-xs text-subtle">Đang đọc video…</span> : null}
          </div>
          <div className="grid gap-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <video
              key={selected.url}
              src={selected.url}
              controls
              playsInline
              className="max-h-[360px] w-full bg-bg object-contain"
            />
            <div className="space-y-2 p-4">
              <p className="line-clamp-2 text-sm font-semibold text-fg">{selected.title}</p>
              <p className="text-xs text-muted">
                {selected.source === "upload" ? "Tải từ máy tính" : "Dán link MP4"} · {selected.resolution} · {formatClock(selected.duration)}
              </p>
              {sourceVideoPath ? (
                <p className="break-all font-mono text-[11px] text-subtle">Đã lưu trên máy chủ: {sourceVideoPath}</p>
              ) : null}
              <p className="text-xs text-subtle">
                Video này đã được chọn làm nguồn dựng phim — bấm "Sang kịch bản" khi bạn sẵn sàng.
              </p>
            </div>
          </div>
        </div>
      ) : !selected ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-border bg-surface px-4 py-10 text-center">
          <Film className="size-6 text-subtle" />
          <p className="text-sm text-muted">Chưa có video nào — dán link MP4 hoặc tải file từ máy ở trên để bắt đầu.</p>
        </div>
      ) : null}
    </div>
  );
}
