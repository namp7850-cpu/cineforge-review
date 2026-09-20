import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/render/health")({
  server: {
    handlers: {
      GET: async () => {
        const { isRenderAvailable } = await import("@/lib/render/jobs.server");
        const { isDownloadAvailable } = await import("@/lib/render/download.server");
        const [available, download] = await Promise.all([isRenderAvailable(), isDownloadAvailable()]);
        return Response.json({ available, download: available && download }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
