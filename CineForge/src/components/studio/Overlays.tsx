import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { generateReviewScript, getAiStatus, type ProviderHealth } from "@/lib/cine/ai";
import { useStudio } from "@/lib/cine/store";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextArea, TextInput } from "@/components/ui/field";

export function StudioOverlays() {
  const aiOpen = useStudio((s) => s.aiOpen);
  const setAiOpen = useStudio((s) => s.setAiOpen);
  return (
    <>
      {aiOpen ? <AiSheet onClose={() => setAiOpen(false)} /> : null}
    </>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-bg/60">
      <button className="h-full flex-1" aria-label="Đóng" onClick={onClose} />
      <div className="flex h-full w-full max-w-lg flex-col border-l border-border bg-bg-elevated shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-xl text-fg">{title}</h2>
          <button onClick={onClose} className="flex size-10 items-center justify-center rounded-[12px] hover:bg-surface">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function AiSheet({ onClose }: { onClose: () => void }) {
  const brief = useStudio((s) => s.brief);
  const selected = useStudio((s) => s.selectedVideo);
  const applyScript = useStudio((s) => s.applyScript);
  const [extra, setExtra] = useState("");
  const [status, setStatus] = useState<{
    configured: boolean;
    provider: string | null;
    providers: ProviderHealth[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refreshStatus = () => {
    getAiStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, provider: null, providers: [] }));
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await generateReviewScript({
        data: {
          filmTitle: brief.filmTitle || selected?.title || "phim",
          year: brief.year,
          genre: brief.genre,
          tone: brief.tone,
          spoilerLevel: brief.spoilerLevel,
          targetSeconds: brief.targetSeconds,
          platform: brief.platform,
          extra,
        },
      });
      applyScript(result.data);
      setNote(result.ok ? `Đã áp dụng kịch bản (${result.data.provider}).` : result.error);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Lỗi AI");
    } finally {
      setBusy(false);
      refreshStatus(); // cập nhật lại bảng trạng thái từng provider sau khi thử
    }
  };

  return (
    <Sheet title="AI · kịch bản VEEK" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <FieldLabel>Trạng thái từng nhà cung cấp AI</FieldLabel>
            <button onClick={refreshStatus} className="text-xs text-accent underline-offset-2 hover:underline">
              Làm mới
            </button>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {(status?.providers ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2 text-fg">{p.label}</td>
                    <td className="px-3 py-2">
                      {p.hasKey ? (
                        <span className="text-ok">Có</span>
                      ) : (
                        <span className="text-subtle">Chưa có</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!p.hasKey ? (
                        <span className="text-subtle">—</span>
                      ) : p.lastError ? (
                        <span className="text-rec" title={p.lastError}>
                          Lỗi: {p.lastError.slice(0, 60)}
                        </span>
                      ) : p.lastSuccessAt ? (
                        <span className="text-ok">Đã chạy được</span>
                      ) : (
                        <span className="text-subtle">Chưa thử</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!status ? (
                  <tr>
                    <td className="px-3 py-3 text-subtle" colSpan={3}>
                      Đang tải…
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-subtle">
            Mỗi provider được thử riêng biệt — một provider lỗi (vd. sai key/model) sẽ KHÔNG chặn các
            provider khác; hệ thống tự chuyển sang provider tiếp theo có key khi viết kịch bản.
          </p>
        </div>
        {status && !status.configured ? (
          <p className="text-xs text-subtle">
            Chưa có nhà cung cấp AI nào được cấu hình trên máy chủ. Hãy liên hệ quản trị viên.
          </p>
        ) : null}
        <div>
          <FieldLabel>Yêu cầu thêm</FieldLabel>
          <TextArea
            rows={4}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Ví dụ: nhấn vào mối quan hệ cha con, không nhắc tên diễn viên…"
          />
        </div>
        <p className="text-xs text-subtle">
          Dùng hồ sơ phim ở bước kịch bản. Mỗi lần bấm là một lần gọi API — không chạy tự động.
        </p>
        {note ? <p className="text-sm text-muted whitespace-pre-line">{note}</p> : null}
        <Button onClick={run} disabled={busy} className="w-full">
          {busy ? "Đang viết…" : "Viết kịch bản review"}
        </Button>
        <TextInput readOnly value={brief.filmTitle || selected?.title || ""} />
      </div>
    </Sheet>
  );
}
