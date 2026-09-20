import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StepBanner({
  kicker,
  title,
  description,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
}: {
  kicker: string;
  title: string;
  description: string;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[24px] border border-border bg-surface p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
      <div className="max-w-2xl">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-subtle">
          {kicker}
        </p>
        <h1 className="text-2xl text-fg sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Quay lại
          </Button>
        ) : null}
        {onNext ? (
          <Button onClick={onNext} disabled={nextDisabled}>
            {nextLabel ?? "Tiếp tục"}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
