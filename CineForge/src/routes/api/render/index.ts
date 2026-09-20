import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/render
 *   x-render-settings : JSON cấu hình (mã hóa base64, UTF-8)
 *   Nguồn video, MỘT trong hai cách:
 *     a) x-source-video-path: ./uploads/<tên>  (video đã tải lên qua POST /api/upload — không cần body)
 *     b) body = nội dung video thô (application/octet-stream)
 * -> { id }
 */
export const Route = createFileRoute("/api/render/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { createJob, createJobFromUpload, publicStatus, RenderError } = await import("@/lib/render/jobs.server");
        const { UploadError } = await import("@/lib/render/upload.server");
        try {
          const header = request.headers.get("x-render-settings") ?? "";
          let settings: unknown = {};
          try {
            settings = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
          } catch {
            return Response.json({ error: "Cấu hình xuất không hợp lệ." }, { status: 400 });
          }

          const sourcePath = request.headers.get("x-source-video-path");
          if (sourcePath) {
            const job = await createJobFromUpload(sourcePath, settings);
            return Response.json(publicStatus(job), { status: 202, headers: { "Cache-Control": "no-store" } });
          }

          if (!request.body) return Response.json({ error: "Thiếu dữ liệu video." }, { status: 400 });
          const len = Number(request.headers.get("content-length"));
          const job = await createJob(request.body, settings, Number.isFinite(len) && len > 0 ? len : null);
          return Response.json(publicStatus(job), { status: 202, headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          if (e instanceof RenderError || e instanceof UploadError) {
            return Response.json({ error: e.message }, { status: e.status });
          }
          console.error("[render] create failed", e);
          return Response.json({ error: "Không thể bắt đầu xuất video." }, { status: 500 });
        }
      },
    },
  },
});
