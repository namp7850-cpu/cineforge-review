import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fetch-video/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getDlJob, publicDlStatus } = await import("@/lib/render/download.server");
        const job = getDlJob(params.id);
        if (!job) return Response.json({ error: "Không tìm thấy tác vụ." }, { status: 404 });
        return Response.json(publicDlStatus(job), { headers: { "Cache-Control": "no-store" } });
      },
      DELETE: async ({ params }) => {
        const { removeDlJob } = await import("@/lib/render/download.server");
        await removeDlJob(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});
