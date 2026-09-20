import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { GENRES, TONES } from "@/lib/cine/sampleVideos";
import { generateReviewScript } from "@/lib/cine/ai";
import { useStudio } from "@/lib/cine/store";
import { Button } from "@/components/ui/button";
import { FieldLabel, RangeInput, TextInput } from "@/components/ui/field";
import { StepBanner } from "./StepBanner";
import { cn } from "@/lib/utils";

export function StepScript() {
  const audio = useStudio((s) => s.audio);
  const setAudio = useStudio((s) => s.setAudio);
  const brief = useStudio((s) => s.brief);
  const setBrief = useStudio((s) => s.setBrief);
  const selected = useStudio((s) => s.selectedVideo);
  const script = useStudio((s) => s.script);
  const applyScript = useStudio((s) => s.applyScript);
  const setStep = useStudio((s) => s.setStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const film = brief.filmTitle || selected?.title || "bộ phim này";
      const result = await generateReviewScript({
        data: {
          filmTitle: film,
          year: brief.year,
          genre: brief.genre,
          tone: brief.tone,
          spoilerLevel: brief.spoilerLevel,
          targetSeconds: brief.targetSeconds,
          platform: brief.platform,
        },
      });
      if (!result.ok) setError(result.error);
      applyScript(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được kịch bản");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepBanner
        kicker="Bước 02 / Kịch bản & âm thanh"
        title="Viết hồ sơ review, giữ nguyên âm thanh gốc"
        description="AI soạn hook – thân bài – phụ đề đúng thời lượng. Âm thanh xuất ra chỉ gồm âm thanh gốc của video bạn đã nhập — không còn giọng đọc AI hay nhạc nền tổng hợp."
        onBack={() => setStep("import")}
        onNext={() => setStep("edit")}
        nextLabel="Sang biên tập"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="space-y-4 rounded-[24px] border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-fg">Hồ sơ review</h2>
            <Button onClick={runGenerate} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {busy ? "Đang viết…" : "AI viết kịch bản"}
            </Button>
          </div>
          {error ? <p className="text-sm text-rec">{error}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel>Tên phim</FieldLabel>
              <TextInput
                value={brief.filmTitle}
                onChange={(e) => setBrief({ filmTitle: e.target.value })}
                placeholder="Tên phim cần review"
              />
            </div>
            <div>
              <FieldLabel>Năm</FieldLabel>
              <TextInput value={brief.year} onChange={(e) => setBrief({ year: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Thời lượng mục tiêu (giây)</FieldLabel>
              <TextInput
                type="number"
                min={8}
                max={600}
                value={brief.targetSeconds}
                onChange={(e) => setBrief({ targetSeconds: Number(e.target.value) || 60 })}
              />
            </div>
            <div>
              <FieldLabel>Thể loại</FieldLabel>
              <select
                className="h-11 w-full rounded-[12px] border border-border bg-bg px-3 text-sm text-fg"
                value={brief.genre}
                onChange={(e) => setBrief({ genre: e.target.value })}
              >
                {GENRES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Tông giọng</FieldLabel>
              <select
                className="h-11 w-full rounded-[12px] border border-border bg-bg px-3 text-sm text-fg"
                value={brief.tone}
                onChange={(e) => setBrief({ tone: e.target.value })}
              >
                {TONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Spoiler</FieldLabel>
              <div className="flex h-11 overflow-hidden rounded-[12px] border border-border">
                {(["none", "light", "full"] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setBrief({ spoilerLevel: level })}
                    className={cn(
                      "flex-1 text-xs font-medium",
                      brief.spoilerLevel === level ? "bg-accent text-accent-fg" : "bg-bg text-muted",
                    )}
                  >
                    {level === "none" ? "Không" : level === "light" ? "Nhẹ" : "Đầy đủ"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Nền tảng</FieldLabel>
              <div className="flex h-11 overflow-hidden rounded-[12px] border border-border">
                {(["youtube", "tiktok", "both"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setBrief({ platform: p })}
                    className={cn(
                      "flex-1 text-xs font-medium capitalize",
                      brief.platform === p ? "bg-accent text-accent-fg" : "bg-bg text-muted",
                    )}
                  >
                    {p === "both" ? "Cả hai" : p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {script ? (
            <div className="space-y-3 rounded-[16px] border border-border bg-bg p-4 text-sm">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">1. Hook</p>
                <p className="mt-1 text-fg">{script.hook}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">2. Nội dung chính</p>
                <p className="mt-1 text-fg">{script.content}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">3. Call to action</p>
                <p className="mt-1 text-fg">{script.cta}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-subtle">4. Hashtag</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {script.hashtags.map((tag) => (
                    <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-subtle">Tạo bởi: {script.provider}</p>
            </div>
          ) : null}
        </section>

        <section className="space-y-4 rounded-[24px] border border-border bg-surface p-5">
          <h2 className="font-display text-xl text-fg">Hòa âm</h2>
          <p className="text-xs text-subtle">
            Chỉ dùng âm thanh gốc của video đã nhập — không thêm giọng đọc AI hay nhạc nền.
          </p>
          <label className="flex items-center justify-between text-sm text-muted">
            Giữ tiếng gốc video
            <input
              type="checkbox"
              checked={audio.enableOriginalAudio}
              onChange={(e) => setAudio({ enableOriginalAudio: e.target.checked })}
            />
          </label>
          <div>
            <FieldLabel>Âm lượng gốc {audio.originalVideoVolume.toFixed(2)}x</FieldLabel>
            <RangeInput
              min={0.5}
              max={2}
              step={0.05}
              value={Math.max(0.5, audio.originalVideoVolume)}
              onChange={(e) => setAudio({ originalVideoVolume: Number(e.target.value) })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
