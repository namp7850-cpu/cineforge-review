import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/studio/Navbar";
import { StepImport } from "@/components/studio/StepImport";
import { StepScript } from "@/components/studio/StepScript";
import { StepEdit } from "@/components/studio/StepEdit";
import { StepExport } from "@/components/studio/StepExport";
import { StudioOverlays } from "@/components/studio/Overlays";
import { useStudio } from "@/lib/cine/store";

export const Route = createFileRoute("/")({ component: StudioHome });

function StudioHome() {
  const step = useStudio((s) => s.currentStep);

  useEffect(() => {
    void useStudio.persist.rehydrate();
  }, []);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {step === "import" ? <StepImport /> : null}
        {step === "script" ? <StepScript /> : null}
        {step === "edit" ? <StepEdit /> : null}
        {step === "export" ? <StepExport /> : null}
      </main>
      <StudioOverlays />
    </div>
  );
}
