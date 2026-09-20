import { createFileRoute } from "@tanstack/react-router";

/** GET /api/render/:id/file -> MP4 (H.264 + yuv420p + AAC) với hỗ trợ Range & CORS */
export const Route = createFileRoute("/api/render/$id/file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { getJob } = await import("@/lib/render/jobs.server");
        const job = getJob(params.id);
        if (!job || job.status !== "done") {
          return Response.json({ error: "Video chưa sẵn sàng." }, { status: 404 });
        }

        const { createReadStream, statSync, existsSync } = await import("node:fs");
        const { Readable } = await import("node:stream");

        if (!existsSync(job.outputPath)) {
          return Response.json({ error: "Không tìm thấy tệp video trên máy chủ." }, { status: 404 });
        }

        let totalSize = job.outputSize;
        try {
          const st = statSync(job.outputPath);
          totalSize = st.size;
        } catch {
          // fallback to job.outputSize
        }

        const range = request.headers.get("range");
        const url = new URL(request.url);
        const isDownload = url.searchParams.has("download");

        const headers: Record<string, string> = {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Cache-Control": "public, max-age=3600",
        };

        if (isDownload) {
          headers["Content-Disposition"] = 'attachment; filename="veek_review.mp4"';
        } else {
          headers["Content-Disposition"] = 'inline; filename="veek_review.mp4"';
        }

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

          if (isNaN(start) || start >= totalSize || end >= totalSize || start > end) {
            return new Response("Requested range not satisfiable", {
              status: 416,
              headers: {
                "Content-Range": `bytes */${totalSize}`,
                ...headers,
              },
            });
          }

          const chunkSize = end - start + 1;
          const nodeStream = createReadStream(job.outputPath, { start, end });
          const stream = Readable.toWeb(nodeStream) as ReadableStream;

          headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
          headers["Content-Length"] = String(chunkSize);

          return new Response(stream, {
            status: 206,
            headers,
          });
        }

        headers["Content-Length"] = String(totalSize);
        const nodeStream = createReadStream(job.outputPath);
        const stream = Readable.toWeb(nodeStream) as ReadableStream;

        return new Response(stream, {
          status: 200,
          headers,
        });
      },
    },
  },
});
