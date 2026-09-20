import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useStudio } from "@/lib/cine/store";
import { formatClock, formatDuration, parseClock } from "@/lib/cine/format";
import { COLOR_FILTERS, PREVIEW_REF_WIDTH, aspectBoxClass, buildFilterCss, refPx } from "@/lib/cine/filters";
import { Button } from "@/components/ui/button";
import { FieldLabel, RangeInput, TextInput } from "@/components/ui/field";
import { StepBanner } from "./StepBanner";
import { cn } from "@/lib/utils";

export function StepEdit() {
  const selected = useStudio((s) => s.selectedVideo);
  const audio = useStudio((s) => s.audio);
  const edit = useStudio((s) => s.edit);
  const setEdit = useStudio((s) => s.setEdit);
  const setStep = useStudio((s) => s.setStep);
  const filmTitle = useStudio((s) => s.brief.filmTitle);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(selected?.duration ?? 0);
  const autoUrl = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setDuration(video.duration);
        const url = selected?.url || video.src;
        if (autoUrl.current !== url && (edit.trimEnd === 0 || edit.trimEnd > video.duration + 0.5)) {
          autoUrl.current = url;
          setEdit({ trimEnd: video.duration });
        }
      }
    };
    const onTime = () => {
      setNow(video.currentTime);
      if (edit.trimEnd > 0 && video.currentTime >= edit.trimEnd) {
        video.pause();
        setPlaying(false);
      }
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("timeupdate", onTime);
    };
  }, [selected?.url, edit.trimEnd, setEdit]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
      return;
    }
    if (video.currentTime < edit.trimStart || video.currentTime >= edit.trimEnd) {
      video.currentTime = edit.trimStart;
    }
    video.volume = audio.enableOriginalAudio ? Math.min(1, audio.originalVideoVolume) : 0;
    video.play().then(() => setPlaying(true)).catch(() => {});
  };

  const clip = Math.max(0.5, edit.trimEnd - edit.trimStart);

  return (
    <div className="space-y-6">
      <StepBanner
        kicker="Bước 03 / Biên tập"
        title="Cắt, màu, chữ, watermark"
        description={`Đoạn xuất hiện tại ${formatDuration(clip)}. Watermark được vẽ thật lên canvas khi render — không chỉ xem trước.`}
        onBack={() => setStep("script")}
        onNext={() => setStep("export")}
        nextLabel="Sang xuất bản"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="rounded-[24px] border border-border bg-surface p-4 sm:p-5 lg:sticky lg:top-24 lg:self-start">
          <div
            className={cn(
              "relative mx-auto w-full overflow-hidden rounded-[16px] bg-bg",
              aspectBoxClass(edit.aspectRatio),
            )}
            style={{ maxWidth: PREVIEW_REF_WIDTH[edit.aspectRatio], containerType: "inline-size" }}
          >
            {selected ? (
              <video
                ref={videoRef}
                src={selected.url}
                poster={selected.thumbnail}
                crossOrigin="anonymous"
                playsInline
                preload="auto"
                className="h-full w-full object-cover"
                style={{ filter: buildFilterCss(edit) }}
                onClick={toggle}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Chưa có video
              </div>
            )}
            {edit.overlayText ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 flex justify-center px-4",
                  edit.textPosition === "top"
                    ? "top-[10%]"
                    : edit.textPosition === "bottom"
                      ? "bottom-[18%]"
                      : "top-1/2 -translate-y-1/2",
                )}
              >
                <span
                  className="max-w-[90%] text-center font-semibold"
                  style={{
                    color: edit.textColor,
                    background: edit.textBgColor,
                    fontSize: refPx(edit.textSize, edit.aspectRatio),
                    padding: `${refPx(edit.textSize * 0.35, edit.aspectRatio)} ${refPx(edit.textSize * 0.55, edit.aspectRatio)}`,
                    borderRadius: refPx(edit.textSize * 0.45, edit.aspectRatio),
                  }}
                >
                  {edit.overlayText}
                </span>
              </div>
            ) : null}
            {edit.enableSubtitles && edit.subtitlesScript ? (
              <div className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
                style={{ bottom: refPx(24, edit.aspectRatio) }}>
                <span
                  className="max-w-[92%] text-center text-fg"
                  style={{
                    background: "rgba(0,0,0,0.85)",
                    fontSize: refPx(12, edit.aspectRatio),
                    padding: `${refPx(6, edit.aspectRatio)} ${refPx(12, edit.aspectRatio)}`,
                    borderRadius: refPx(6, edit.aspectRatio),
                  }}
                >
                  {edit.subtitlesScript.slice(0, 80)}
                </span>
              </div>
            ) : null}
            {edit.enableBrandName1 && edit.brandName1 ? (
              <span
                className="pointer-events-none absolute font-semibold tracking-wide text-fg drop-shadow"
                style={{ opacity: edit.brandName1Opacity, fontSize: refPx(edit.brandName1Size, edit.aspectRatio), left: refPx(12, edit.aspectRatio), top: refPx(12, edit.aspectRatio) }}
              >
                {edit.brandName1}
              </span>
            ) : null}
            {edit.enableBrandName2 && edit.brandName2 ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-[46%]",
                  edit.brandName2Mode === "marquee" ? "overflow-hidden" : "flex justify-center",
                )}
                style={{ opacity: edit.brandName2Opacity }}
              >
                <span
                  className={cn(
                    "inline-block whitespace-nowrap font-semibold uppercase tracking-[0.3em]",
                    edit.brandName2Mode === "marquee" && "animate-[cf-brand-marquee_9s_linear_infinite]",
                  )}
                  style={{ fontSize: refPx(edit.brandName2Size, edit.aspectRatio) }}
                >
                  {edit.brandName2}
                </span>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="secondary" size="icon" onClick={toggle} aria-label={playing ? "Tạm dừng" : "Phát"}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <span className="font-mono text-xs tabular-nums text-muted">
              {formatClock(now)} / {formatClock(duration)}
            </span>
          </div>
        </div>

        <div className="space-y-5 rounded-[24px] border border-border bg-surface p-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
          <div>
            <FieldLabel>Tỉ lệ khung</FieldLabel>
            <div className="flex gap-1">
              {(["16:9", "9:16", "1:1", "4:5"] as const).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setEdit({ aspectRatio: ratio })}
                  className={cn(
                    "h-10 flex-1 rounded-[10px] border text-xs font-medium",
                    edit.aspectRatio === ratio
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-border text-muted",
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>
              Cắt {formatClock(edit.trimStart)} → {formatClock(edit.trimEnd)} ({formatDuration(clip)})
            </FieldLabel>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-subtle">
                  Bắt đầu (giây hoặc mm:ss)
                </span>
                <TextInput
                  key={`trim-start-${edit.trimStart}`}
                  defaultValue={formatClock(edit.trimStart)}
                  placeholder="0:00"
                  onBlur={(e) => {
                    const parsed = parseClock(e.target.value);
                    if (parsed === null) {
                      e.target.value = formatClock(edit.trimStart);
                      return;
                    }
                    const clamped = Math.min(Math.max(0, parsed), Math.max(0, edit.trimEnd - 0.5));
                    setEdit({ trimStart: clamped });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </div>
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-subtle">
                  Kết thúc (giây hoặc mm:ss)
                </span>
                <TextInput
                  key={`trim-end-${edit.trimEnd}`}
                  defaultValue={formatClock(edit.trimEnd)}
                  placeholder={formatClock(duration)}
                  onBlur={(e) => {
                    const parsed = parseClock(e.target.value);
                    if (parsed === null) {
                      e.target.value = formatClock(edit.trimEnd);
                      return;
                    }
                    const upperBound = duration > 0 ? duration : parsed;
                    const clamped = Math.min(Math.max(parsed, edit.trimStart + 0.5), upperBound, edit.trimStart + 1200);
                    setEdit({ trimEnd: clamped });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </div>
            </div>
            <RangeInput
              min={0}
              max={duration || 1}
              step={0.1}
              value={edit.trimStart}
              onChange={(e) =>
                setEdit({ trimStart: Math.min(Number(e.target.value), edit.trimEnd - 0.5) })
              }
            />
            <RangeInput
              className="mt-2"
              min={0}
              max={duration || 1}
              step={0.1}
              value={edit.trimEnd}
              onChange={(e) =>
                setEdit({
                  trimEnd: Math.min(
                    Math.max(Number(e.target.value), edit.trimStart + 0.5),
                    edit.trimStart + 1200,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() => setEdit({ trimStart: 0, trimEnd: duration || edit.trimEnd })}
              className="mt-2 text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Dùng trọn video ({formatClock(duration)})
            </button>
            <p className="mt-1 text-[11px] text-subtle">Đoạn cắt tối đa 20 phút (1200 giây).</p>
          </div>
          <div>
            <FieldLabel>Màu</FieldLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {COLOR_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setEdit({ colorFilter: f.id })}
                  className={cn(
                    "h-10 rounded-[10px] border text-[11px] font-medium",
                    edit.colorFilter === f.id
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-border text-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {[
            ["brightness", "Sáng", 0.6, 1.4],
            ["contrast", "Tương phản", 0.6, 1.5],
            ["saturation", "Bão hòa", 0, 1.8],
          ].map(([key, label, min, max]) => (
            <div key={key}>
              <FieldLabel>
                {label} {(edit[key as "brightness"] as number).toFixed(2)}
              </FieldLabel>
              <RangeInput
                min={Number(min)}
                max={Number(max)}
                step={0.02}
                value={edit[key as "brightness"]}
                onChange={(e) => setEdit({ [key]: Number(e.target.value) })}
              />
            </div>
          ))}
          <div>
            <FieldLabel>Tiêu đề trên khung</FieldLabel>
            <TextInput
              value={edit.overlayText}
              onChange={(e) => setEdit({ overlayText: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>Phụ đề</FieldLabel>
            <TextInput
              value={edit.subtitlesScript}
              onChange={(e) => setEdit({ subtitlesScript: e.target.value, enableSubtitles: true })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Thương hiệu 1 (góc trên)</FieldLabel>
              <TextInput
                value={edit.brandName1}
                onChange={(e) => setEdit({ brandName1: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel>Thương hiệu 2 (chạy ngang)</FieldLabel>
              <TextInput
                value={edit.brandName2}
                onChange={(e) => setEdit({ brandName2: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-[14px] border border-border bg-bg p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">
              Gợi ý tên thương hiệu / watermark chuẩn TikTok
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "VEEK REVIEW PHIM", value: "VEEK REVIEW PHIM" },
                {
                  label: "Review Phim [Tên Phim]",
                  value: `Review Phim ${filmTitle || "[Tên Phim]"}`,
                },
                { label: "@namreview_official", value: "@namreview_official" },
                { label: "Phim Hay Mỗi Ngày 🎬", value: "Phim Hay Mỗi Ngày 🎬" },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setEdit({ brandName1: preset.value, enableBrandName1: true })}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent hover:text-fg"
                  title={`Điền vào Thương hiệu 1: "${preset.value}"`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-subtle">
              Bấm để điền nhanh vào Thương hiệu 1. Để chữ ở dải đen biên dưới với độ mờ 10–15% giúp
              bảo vệ bản quyền mà không che mắt người xem.
            </p>
          </div>
          <div className="flex gap-4 text-sm text-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edit.enableBrandName1}
                onChange={(e) => setEdit({ enableBrandName1: e.target.checked })}
              />
              Logo cố định
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edit.enableBrandName2}
                onChange={(e) => setEdit({ enableBrandName2: e.target.checked })}
              />
              Watermark chạy
            </label>
          </div>

          {edit.enableBrandName1 ? (
            <div className="grid grid-cols-2 gap-3 rounded-[14px] border border-border bg-bg p-3">
              <div>
                <FieldLabel>Độ mờ Thương hiệu 1 {Math.round(edit.brandName1Opacity * 100)}%</FieldLabel>
                <RangeInput
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={edit.brandName1Opacity}
                  onChange={(e) => setEdit({ brandName1Opacity: Number(e.target.value) })}
                />
              </div>
              <div>
                <FieldLabel>Độ to Thương hiệu 1 {edit.brandName1Size}px</FieldLabel>
                <RangeInput
                  min={10}
                  max={48}
                  step={1}
                  value={edit.brandName1Size}
                  onChange={(e) => setEdit({ brandName1Size: Number(e.target.value) })}
                />
              </div>
            </div>
          ) : null}

          {edit.enableBrandName2 ? (
            <div className="space-y-3 rounded-[14px] border border-border bg-bg p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Độ mờ Thương hiệu 2 {Math.round(edit.brandName2Opacity * 100)}%</FieldLabel>
                  <RangeInput
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={edit.brandName2Opacity}
                    onChange={(e) => setEdit({ brandName2Opacity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <FieldLabel>Độ to Thương hiệu 2 {edit.brandName2Size}px</FieldLabel>
                  <RangeInput
                    min={8}
                    max={40}
                    step={1}
                    value={edit.brandName2Size}
                    onChange={(e) => setEdit({ brandName2Size: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Kiểu hiển thị</FieldLabel>
                <div className="flex h-10 overflow-hidden rounded-[10px] border border-border">
                  <button
                    type="button"
                    onClick={() => setEdit({ brandName2Mode: "marquee" })}
                    className={cn(
                      "flex-1 text-xs font-medium",
                      edit.brandName2Mode === "marquee" ? "bg-accent text-accent-fg" : "bg-bg text-muted",
                    )}
                  >
                    Chuyển động (chạy khắp video)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEdit({ brandName2Mode: "fixed" })}
                    className={cn(
                      "flex-1 text-xs font-medium",
                      edit.brandName2Mode === "fixed" ? "bg-accent text-accent-fg" : "bg-bg text-muted",
                    )}
                  >
                    Cố định (đứng yên)
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
