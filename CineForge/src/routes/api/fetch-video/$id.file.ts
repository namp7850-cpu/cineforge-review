import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/fetch-video/$id/file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getDlJob } = await import("@/lib/render/download.server");
        const job = getDlJob(params.id);
        if (!job || job.status !== "done" || !job.filePath) {
          return Response.json({ error: "Video chưa sẵn sàng." }, { status: 404 });
        }
        const { createReadStream } = await import("node:fs");
        const { Readable } = await import("node:stream");
        return new Response(Readable.toWeb(createReadStream(job.filePath)) as ReadableStream, {
          headers: {
            "Content-Type": job.filePath.endsWith(".mp4") ? "video/mp4" : "video/webm",
            "Content-Length": String(job.size),
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
