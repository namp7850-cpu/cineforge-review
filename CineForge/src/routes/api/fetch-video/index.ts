import { createFileRoute } from "@tanstack/react-router";

/** POST /api/fetch-video  { url } -> bắt đầu tải video từ link YouTube/TikTok phía máy chủ */
export const Route = createFileRoute("/api/fetch-video/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { startDownload, publicDlStatus, DownloadError } = await import("@/lib/render/download.server");
        try {
          const body = (await request.json().catch(() => ({}))) as { url?: unknown };
          const job = await startDownload(body.url);
          return Response.json(publicDlStatus(job), { status: 202, headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          if (e instanceof DownloadError) return Response.json({ error: e.message }, { status: e.status });
          console.error("[download] start failed", e);
          return Response.json({ error: "Không thể bắt đầu tải video." }, { status: 500 });
        }
      },
    },
  },
});
