import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/upload   (multipart/form-data, trường "file")
 * -> 201 { path: "./uploads/video_<...>.mp4", name, size }
 *
 * Trình duyệt giữ `path` làm `sourceVideoPath`; khi render chỉ cần gửi lại chuỗi này.
 */
export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { saveUpload, assertDeclaredLength, UploadError } = await import("@/lib/render/upload.server");
        const noStore = { "Cache-Control": "no-store" };
        try {
          const len = Number(request.headers.get("content-length"));
          assertDeclaredLength(Number.isFinite(len) && len > 0 ? len : null);

          let form: FormData;
          try {
            form = await request.formData();
          } catch {
            return Response.json(
              { error: "Dữ liệu tải lên không hợp lệ (cần multipart/form-data)." },
              { status: 400, headers: noStore },
            );
          }
          const file = form.get("file");
          if (!file || typeof file === "string" || typeof file.stream !== "function") {
            return Response.json({ error: "Thiếu tệp video (trường \"file\")." }, { status: 400, headers: noStore });
          }
          const saved = await saveUpload(file);
          return Response.json(saved, { status: 201, headers: noStore });
        } catch (e) {
          if (e instanceof UploadError) return Response.json({ error: e.message }, { status: e.status, headers: noStore });
          console.error("[upload] failed", e);
          return Response.json({ error: "Không thể tải video lên máy chủ." }, { status: 500, headers: noStore });
        }
      },
    },
  },
});
