import { createFileRoute } from "@tanstack/react-router";

/** GET /api/render/:id -> trạng thái · DELETE /api/render/:id -> dọn tệp tạm */
export const Route = createFileRoute("/api/render/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getJob, publicStatus } = await import("@/lib/render/jobs.server");
        const job = getJob(params.id);
        if (!job) return Response.json({ error: "Không tìm thấy tác vụ." }, { status: 404 });
        return Response.json(publicStatus(job), { headers: { "Cache-Control": "no-store" } });
      },
      DELETE: async ({ params }) => {
        const { getJob, removeJob } = await import("@/lib/render/jobs.server");
        if (!getJob(params.id)) return Response.json({ ok: true });
        await removeJob(params.id);
        return Response.json({ ok: true });
      },
    },
  },
});
