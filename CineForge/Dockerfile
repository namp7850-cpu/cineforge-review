# Chạy CineForge kèm FFmpeg để xuất MP4 (H.264/AAC) phía máy chủ.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN node scripts/with-app-env.mjs vite build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/server-assets ./server-assets
# Thư mục lưu video người dùng tải lên. Muốn giữ lại khi khởi động lại container: -v cineforge-uploads:/app/uploads
RUN mkdir -p /app/uploads
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
# Khoá API truyền lúc chạy: docker run --env-file .env ...
CMD ["node", ".output/server/index.mjs"]
