# Xuất video MP4 bằng FFmpeg (phía máy chủ)

Trình duyệt chỉ gửi video + thông số chỉnh sửa; **toàn bộ lệnh FFmpeg chạy trên máy chủ**
(`src/lib/render/`). Giao diện không hiển thị và không nhận lệnh/log FFmpeg.

## Cần gì
- `ffmpeg` và `ffprobe` (bản có `drawtext`/libfreetype) trong PATH — hoặc đặt `FFMPEG_PATH`, `FFPROBE_PATH`.
- Font có dấu tiếng Việt: đã kèm sẵn `server-assets/fonts/DejaVuSans-Bold.ttf`.

## Chạy
- Máy cá nhân: cài FFmpeg (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Ubuntu: `sudo apt install ffmpeg`) rồi `npm run dev`.
- Máy chủ/VPS: `docker build -t cineforge .` rồi `docker run -p 8080:8080 --env-file .env cineforge`.
- Nếu máy chủ **không có** FFmpeg (ví dụ Vercel), ứng dụng tự chuyển sang xuất trên trình duyệt (WebM, chưa tương thích TikTok).

## Luồng API (nội bộ)
1. `POST /api/upload` (`multipart/form-data`, trường `file`) → `201 { path: "./uploads/video_<...>.mp4", name, size }`. Trình duyệt giữ `path` làm `sourceVideoPath`.
2. `POST /api/render` với header `x-render-settings` + **`x-source-video-path: ./uploads/<tên>`** (không cần gửi lại video) → `GET /api/render/:id` (tiến độ) → `GET /api/render/:id/file` (MP4) → `DELETE /api/render/:id`.
   Nguồn chưa nằm trên máy chủ (video mẫu, link .mp4 trực tiếp) vẫn dùng cách cũ: gửi video thô làm body của `POST /api/render`.

Lỗi "Không đọc được video nguồn" từ đường dẫn `./uploads/…` **chỉ** xuất hiện khi tệp không tồn tại hoặc dung lượng = 0 byte (kiểm tra ở `src/lib/render/upload.server.ts`). Tệp trong `/uploads` không bị xoá sau khi render (có thể render lại); tự dọn sau 24 giờ.

Biến môi trường tuỳ chọn: `UPLOAD_DIR` (mặc định `./uploads`), `UPLOAD_MAX_MB` (mặc định 1024), `UPLOAD_TTL_HOURS` (mặc định 24).

## Đầu ra
MP4 · H.264 · `yuv420p` · AAC 48 kHz · `+faststart`. Đoạn cắt tối đa 20 phút (1200 giây).

## Bảo mật đã áp dụng
FFmpeg gọi bằng `spawn` (không shell) · văn bản người dùng chỉ đi qua tệp `textfile` · `ffprobe` kiểm tra định dạng, chặn playlist/concat · giới hạn dung lượng & số job đồng thời · tệp tạm tự xoá sau 30 phút.
**Lưu ý:** endpoint chưa gắn đăng nhập. Nếu mở ra internet, hãy đặt sau đăng nhập hoặc reverse proxy có giới hạn tốc độ.

## Tải video từ link YouTube/TikTok (Module D)
- Cần thêm `yt-dlp` trong PATH (`pip install -U yt-dlp` hoặc `winget install yt-dlp`); Dockerfile đã cài sẵn. Nên cập nhật yt-dlp thường xuyên vì nền tảng hay đổi.
- Dán link vào ô nhập nguồn: máy chủ tải video (tối đa 1080p, mặc định ≤ 1 GB), rồi nạp vào studio như file tải lên.
- Chỉ nhận host YouTube/TikTok (mở rộng bằng `DOWNLOAD_EXTRA_HOSTS`); URL khác bị từ chối.
- Nếu máy chủ không có yt-dlp, giao diện báo nên tải file về máy rồi chọn "Tải video từ máy".
- Chỉ dùng cho video của bạn hoặc bạn có quyền sử dụng; tải nội dung có thể vi phạm điều khoản nền tảng hoặc bản quyền.
