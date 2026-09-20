import { Clapperboard, Sparkles } from "lucide-react";
import { STEPS, type StepId } from "@/lib/cine/types";
import { useStudio } from "@/lib/cine/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Navbar() {
  const currentStep = useStudio((s) => s.currentStep);
  const setStep = useStudio((s) => s.setStep);
  const selectedVideo = useStudio((s) => s.selectedVideo);
  const render = useStudio((s) => s.render);
  const script = useStudio((s) => s.script);
  const filmTitle = useStudio((s) => s.brief.filmTitle);
  const setAiOpen = useStudio((s) => s.setAiOpen);

  const done: Record<StepId, boolean> = {
    import: Boolean(selectedVideo),
    script: Boolean(script) || Boolean(filmTitle),
    edit: true,
    export: Boolean(render.exportedUrl),
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-[14px] border border-border bg-surface">
            <Clapperboard className="size-4 text-accent" strokeWidth={1.6} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-lg font-semibold tracking-tight text-fg">
                CineForge
              </span>
              <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-subtle sm:inline">
                VEEK REVIEW
              </span>
            </div>
            <p className="hidden truncate text-xs text-muted sm:block">Studio biên tập & xuất review phim</p>
          </div>
        </div>

        <nav className="hidden items-center gap-0.5 rounded-[16px] border border-border bg-surface p-1 lg:flex">
          {STEPS.map((step) => {
            const active = currentStep === step.id;
            return (
              <button
                key={step.id}
                onClick={() => setStep(step.id)}
                className={cn(
                  "flex items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left transition-colors duration-150",
                  active ? "bg-bg text-fg" : "text-muted hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    active ? "text-accent" : done[step.id] ? "text-ok" : "text-subtle",
                  )}
                >
                  {step.number}
                </span>
                <span className="text-xs font-medium">{step.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles className="size-3.5" />
            Grok
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
        {STEPS.map((step) => (
          <button
            key={step.id}
            onClick={() => setStep(step.id)}
            className={cn(
              "min-w-16 flex-1 rounded-[10px] px-2 py-2 text-center text-[11px] font-medium",
              currentStep === step.id ? "bg-surface-2 text-fg" : "text-muted",
            )}
          >
            {step.number} {step.label}
          </button>
        ))}
      </div>
    </header>
  );
}
