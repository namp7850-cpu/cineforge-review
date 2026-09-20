import { AudioSettings, VideoEditSettings, VideoItem } from './types';
import { formatClock } from './format';
import { PREVIEW_REF_WIDTH } from './filters';

export interface ExportProgressCallback {
  (progress: number, message: string): void;
}

export class VideoExporter {
  /**
   * Giải mã audio gốc của video thành một AudioBuffer độc lập bằng
   * `fetch()` + `decodeAudioData()`.
   *
   * Đây là đường trích xuất CHÍNH — đáng tin cậy hơn nhiều so với
   * `HTMLMediaElement.captureStream()` / `createMediaElementSource()`, vốn phụ
   * thuộc vào đúng thời điểm phần tử `<video>` đã bắt đầu giải mã audio hay
   * chưa (rất dễ ra "0 audio track" và im lặng hoàn toàn khi ghi hình — đúng
   * triệu chứng "xuất video tịt tiếng"). Vì audio được giải mã sẵn thành buffer
   * độc lập, việc phát lại hoàn toàn tách rời khỏi trạng thái phát/tạm dừng của
   * thẻ <video>, nên không còn phụ thuộc race-condition nào.
   *
   * Giới hạn: cross-origin video không bật CORS ở server nguồn sẽ khiến
   * `fetch()` thất bại — đây là giới hạn bảo mật cố hữu của trình duyệt, không
   * có cách nào vượt qua từ phía client.
   */
  private static async decodeOriginalAudio(
    url: string,
    audioCtx: AudioContext,
  ): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} khi tải video để giải mã audio`);
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) throw new Error('File rỗng');
      // decodeAudioData "detach" buffer gốc trên một số trình duyệt cũ — dùng bản sao để an toàn.
      const buffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      return buffer;
    } catch (err) {
      console.warn('decodeAudioData thất bại, sẽ thử phương án dự phòng captureStream():', err);
      return null;
    }
  }

  /**
   * Phương án dự phòng khi decodeAudioData không dùng được (hiếm — ví dụ codec
   * lạ trình duyệt không hỗ trợ decode rời nhưng vẫn phát được bằng thẻ video).
   * Chờ (poll) tối đa ~1.5s cho audio track thật sự xuất hiện trên captureStream(),
   * thay vì kiểm tra ngay lập tức lúc track chưa kịp có.
   */
  private static async captureStreamFallback(
    videoEl: HTMLVideoElement,
    maxWaitMs: number,
  ): Promise<MediaStream | null> {
    const extendedVideo = videoEl as unknown as {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture = (): MediaStream | null => {
      if (typeof extendedVideo.captureStream === 'function') return extendedVideo.captureStream();
      if (typeof extendedVideo.mozCaptureStream === 'function') return extendedVideo.mozCaptureStream();
      return null;
    };
    const startedAt = performance.now();
    while (performance.now() - startedAt < maxWaitMs) {
      const stream = capture();
      if (stream && stream.getAudioTracks().length > 0) return stream;
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  }

  /**
   * Renders video directly inside browser using HTML5 Canvas & Web Audio API MediaStreamDestination.
   *
   * FIX A (mất tiếng khi xuất): âm thanh gốc giờ được giải mã độc lập thành
   * AudioBuffer (xem `decodeOriginalAudio`) và phát bằng AudioBufferSourceNode
   * đồng bộ chính xác với thời điểm bắt đầu ghi hình — không còn phụ thuộc vào
   * trạng thái phát/âm lượng của thẻ <video> hay việc audio track có kịp xuất
   * hiện trên captureStream() hay không.
   * FIX B (thời lượng cắt): trimStart/trimEnd lấy 100% từ giá trị người dùng
   * nhập ở bước Biên tập — không còn bất kỳ giá trị mặc định cứng nào ở đây.
   */
  public static async renderVideoWithAudio(
    videoItem: VideoItem,
    audioSettings: AudioSettings,
    editSettings: VideoEditSettings,
    onProgress: ExportProgressCallback,
    existingVideoEl?: HTMLVideoElement | null
  ): Promise<{
    url: string;
    blob: Blob;
    duration: number;
    size: string;
    audioDetails: string;
  }> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          onProgress(5, 'Đang chuẩn bị video...');

          // 1. Setup Video Element
          const videoEl = existingVideoEl || document.createElement('video');
          videoEl.crossOrigin = 'anonymous';
          videoEl.playsInline = true;
          if (!existingVideoEl) {
            videoEl.src = videoItem.url;
            videoEl.preload = 'auto';
          }

          // Wait for metadata if needed
          if (videoEl.readyState < 1) {
            await new Promise<void>((res, rej) => {
              const onLoaded = () => {
                videoEl.removeEventListener('loadedmetadata', onLoaded);
                res();
              };
              videoEl.addEventListener('loadedmetadata', onLoaded);
              videoEl.addEventListener('error', () => rej(new Error('Không thể tải metadata của video')));
            });
          }

          // =========================================================================
          // FIX B: THỜI LƯỢNG CẮT HOÀN TOÀN THEO NGƯỜI DÙNG NHẬP — KHÔNG HARDCODE
          // =========================================================================
          const rawVideoDuration = (videoEl.duration && !isNaN(videoEl.duration) && videoEl.duration > 0)
            ? videoEl.duration
            : (videoItem.duration || rawFallbackDuration(videoItem));

          const trimStart = Math.max(0, editSettings.trimStart || 0);
          // trimEnd: dùng đúng giá trị người dùng đã nhập/kéo ở bước Biên tập; chỉ khi
          // họ CHƯA từng đặt gì (0, hoặc vượt quá thời lượng thật) mới quay về đúng độ
          // dài gốc của video — không có mốc mặc định cố định nào khác được áp đặt.
          const trimEnd = (editSettings.trimEnd && editSettings.trimEnd > trimStart && editSettings.trimEnd <= rawVideoDuration + 1)
            ? editSettings.trimEnd
            : rawVideoDuration;

          const renderDuration = Math.max(0.5, trimEnd - trimStart);
          onProgress(10, 'Đang bóc tách video...');

          // 2. Setup Render Canvas
          const canvas = document.createElement('canvas');
          if (editSettings.aspectRatio === '9:16') {
            canvas.width = 1080;
            canvas.height = 1920;
          } else if (editSettings.aspectRatio === '1:1') {
            canvas.width = 1080;
            canvas.height = 1080;
          } else {
            canvas.width = 1920;
            canvas.height = 1080;
          }
          // Hệ số phóng: khung preview tham chiếu -> khung render thật.
          const uiScale = canvas.width / PREVIEW_REF_WIDTH[editSettings.aspectRatio];
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) {
            throw new Error('Trình duyệt không hỗ trợ Canvas 2D Context.');
          }

          // =========================================================================
          // FIX A: TRÍCH XUẤT ÂM THANH GỐC — GIẢI MÃ ĐỘC LẬP BẰNG decodeAudioData
          // =========================================================================
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const audioCtx = new AudioContextClass({ sampleRate: audioSettings.sampleRate || 48000 });
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          const audioDestination = audioCtx.createMediaStreamDestination();
          const masterMixer = audioCtx.createGain();
          masterMixer.gain.setValueAtTime(1.0, audioCtx.currentTime);
          masterMixer.connect(audioDestination);

          const originalGain = audioCtx.createGain();
          const targetVol = audioSettings.enableOriginalAudio
            ? Math.max(0, Math.min(2, audioSettings.originalVideoVolume))
            : 0;
          originalGain.gain.setValueAtTime(Math.max(0.0001, targetVol), audioCtx.currentTime);
          originalGain.connect(masterMixer);

          let hasOriginalAudioTrack = false;
          let decodedAudioBuffer: AudioBuffer | null = null;
          let fallbackAudioStream: MediaStream | null = null;

          // Video chỉ cần cung cấp KHUNG HÌNH cho canvas — âm thanh phát ra hoàn
          // toàn từ AudioBuffer độc lập bên dưới, nên tắt tiếng thẻ <video> để
          // tránh nghe đúp / tránh mọi phụ thuộc vào volume-mirroring của trình duyệt.
          videoEl.muted = true;
          videoEl.volume = 0;
          videoEl.currentTime = trimStart;

          if (audioSettings.enableOriginalAudio) {
            onProgress(11, 'Đang xử lý âm thanh...');
            decodedAudioBuffer = await this.decodeOriginalAudio(videoEl.src || videoItem.url, audioCtx);
            if (decodedAudioBuffer) {
              hasOriginalAudioTrack = true;
            } else {
              // Phương án dự phòng: bật tiếng thật cho thẻ <video> và dùng captureStream()
              try {
                videoEl.muted = false;
                videoEl.volume = 1;
                await videoEl.play().catch((e) => console.warn('Không thể tự phát video để dò audio track:', e));
                fallbackAudioStream = await this.captureStreamFallback(videoEl, 1500);
                if (fallbackAudioStream) {
                  const origSource = audioCtx.createMediaStreamSource(fallbackAudioStream);
                  origSource.connect(originalGain);
                  hasOriginalAudioTrack = true;
                }
                videoEl.pause();
                videoEl.currentTime = trimStart;
                videoEl.muted = true;
                videoEl.volume = 0;
              } catch (fallbackErr) {
                console.warn('Phương án dự phòng captureStream() cũng thất bại:', fallbackErr);
              }
            }
          }

          if (!hasOriginalAudioTrack && audioSettings.enableOriginalAudio) {
            onProgress(
              14,
              'Cảnh báo: không đọc được âm thanh gốc của video (thường do link ngoài không bật CORS). File xuất có thể không có tiếng.',
            );
          }

          // =========================================================================
          // FIX LỖI DROP AUDIO TRACK CỦA TRÌNH DUYỆT (SÓNG MANG NGẦM / CARRIER OSC)
          // =========================================================================
          const carrierOsc = audioCtx.createOscillator();
          const carrierGain = audioCtx.createGain();
          carrierOsc.type = 'sine';
          carrierOsc.frequency.setValueAtTime(45, audioCtx.currentTime);
          carrierGain.gain.setValueAtTime(0.0005, audioCtx.currentTime);
          carrierOsc.connect(carrierGain);
          carrierGain.connect(masterMixer);
          carrierOsc.start();

          // 3. Đóng gói Combined Stream (Canvas Video Track + Web Audio Destination Audio Track)
          const canvasStream = canvas.captureStream(30); // 30 FPS
          const videoTracks = canvasStream.getVideoTracks();
          const audioTracks = audioDestination.stream.getAudioTracks();

          const combinedStream = new MediaStream([
            ...videoTracks,
            ...audioTracks
          ]);

          // Setup MediaRecorder
          const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4'
          ];
          const supportedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

          const recorder = new MediaRecorder(combinedStream, {
            mimeType: supportedMime || undefined,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 192000
          });

          const recordedChunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunks.push(e.data);
            }
          };

          // 4. Render Frame Function (Vẽ Canvas với hiệu ứng, tỷ lệ khung hình & chữ)
          const drawFrame = () => {
            if (!ctx) return;
            ctx.fillStyle = '#05070e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.filter = `brightness(${editSettings.brightness}) contrast(${editSettings.contrast}) saturate(${editSettings.saturation})`;
            if (editSettings.colorFilter === 'cinematic') {
              ctx.filter += ' contrast(1.08) saturate(1.1)';
            } else if (editSettings.colorFilter === 'vibrant') {
              ctx.filter += ' saturate(1.35) contrast(1.08)';
            } else if (editSettings.colorFilter === 'vintage') {
              ctx.filter += ' sepia(0.2) contrast(1.02)';
            } else if (editSettings.colorFilter === 'bw') {
              ctx.filter += ' grayscale(1.0) contrast(1.2)';
            } else if (editSettings.colorFilter === 'noir') {
              ctx.filter += ' grayscale(1.0) contrast(1.35)';
            } else if (editSettings.colorFilter === 'warm') {
              ctx.filter += ' sepia(0.1) saturate(1.15)';
            }

            const vw = videoEl.videoWidth || 1920;
            const vh = videoEl.videoHeight || 1080;
            const scale = Math.max(canvas.width / vw, canvas.height / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;

            try {
              ctx.drawImage(videoEl, dx, dy, dw, dh);
            } catch {
              // ignore cross-origin error on single frame
            }

            ctx.filter = 'none';

            if (editSettings.overlayText) {
              ctx.save();
              const titleFont = editSettings.textSize * uiScale;
              ctx.font = `bold ${titleFont}px Figtree, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              const textY = editSettings.textPosition === 'top'
                ? canvas.height * 0.12
                : editSettings.textPosition === 'bottom'
                ? canvas.height * 0.85
                : canvas.height * 0.5;

              const textMetrics = ctx.measureText(editSettings.overlayText);
              const padX = 0.55 * titleFont;
              const padY = 0.35 * titleFont;
              ctx.fillStyle = editSettings.textBgColor || 'rgba(0,0,0,0.7)';
              ctx.beginPath();
              ctx.roundRect(
                canvas.width / 2 - textMetrics.width / 2 - padX,
                textY - padY - titleFont / 2,
                textMetrics.width + padX * 2,
                padY * 2 + titleFont,
                titleFont * 0.45
              );
              ctx.fill();

              ctx.fillStyle = editSettings.textColor || '#ffffff';
              ctx.fillText(editSettings.overlayText, canvas.width / 2, textY);
              ctx.restore();
            }

            if (editSettings.enableSubtitles && editSettings.subtitlesScript) {
              ctx.save();
              const subFont = 12 * uiScale;
              ctx.font = `600 ${subFont}px Figtree, sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
              const subText = editSettings.subtitlesScript.slice(0, 80);
              const subMetrics = ctx.measureText(subText);
              const subY = canvas.height - 36 * uiScale;

              ctx.beginPath();
              ctx.roundRect(
                canvas.width / 2 - subMetrics.width / 2 - 12 * uiScale,
                subY - subFont,
                subMetrics.width + 24 * uiScale,
                subFont * 2,
                6 * uiScale
              );
              ctx.fill();

              ctx.fillStyle = '#f4f0e8';
              ctx.fillText(subText, canvas.width / 2, subY);
              ctx.restore();
            }


            if (editSettings.enableBrandName1 && editSettings.brandName1) {
              ctx.save();
              const fontSize1 = editSettings.brandName1Size * uiScale;
              ctx.font = `bold ${fontSize1}px Figtree, sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              ctx.globalAlpha = Math.max(0, Math.min(1, editSettings.brandName1Opacity));
              ctx.shadowColor = 'rgba(0,0,0,0.85)';
              ctx.shadowBlur = 6;
              ctx.fillStyle = '#ffffff';
              ctx.fillText(editSettings.brandName1, 12 * uiScale, 12 * uiScale);
              ctx.restore();
            }

            if (editSettings.enableBrandName2 && editSettings.brandName2) {
              ctx.save();
              const fontSize2 = editSettings.brandName2Size * uiScale;
              ctx.font = `bold ${fontSize2}px Figtree, sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.globalAlpha = Math.max(0, Math.min(1, editSettings.brandName2Opacity));
              ctx.fillStyle = '#ffffff';

              const brandY = canvas.height * 0.46;
              if (editSettings.brandName2Mode === 'fixed') {
                // Cố định — vẽ đúng MỘT lần, canh giữa, không di chuyển.
                const textWFixed = ctx.measureText(editSettings.brandName2).width;
                ctx.fillText(editSettings.brandName2, (canvas.width - textWFixed) / 2, brandY);
              } else {
                // Chạy ngang — vẫn chỉ MỘT bản duy nhất quét qua khung hình mỗi vòng lặp,
                // không lặp lại chữ nhiều lần trong cùng một khung hình.
                const textW = ctx.measureText(editSettings.brandName2).width;
                const speedPxPerSec = 140 * uiScale;
                const elapsedForMarquee = Math.max(0, videoEl.currentTime - trimStart);
                const loopWidth = canvas.width + textW;
                const rawX = canvas.width - ((elapsedForMarquee * speedPxPerSec) % loopWidth);
                ctx.fillText(editSettings.brandName2, rawX, brandY);
              }
              ctx.restore();
            }
          };

          // 5. Start Rendering & Recording Process
          onProgress(15, 'Đang xử lý hiệu ứng & render...');

          let renderAnimationId: number;
          let isComplete = false;
          let bufferSourceNode: AudioBufferSourceNode | null = null;

          const cleanup = () => {
            isComplete = true;
            cancelAnimationFrame(renderAnimationId);
            try {
              carrierOsc.stop();
              carrierOsc.disconnect();
            } catch {
              // sóng mang có thể đã dừng sẵn — bỏ qua
            }
            try {
              bufferSourceNode?.stop();
            } catch {
              // buffer có thể đã phát xong/dừng sẵn — bỏ qua
            }
            try {
              videoEl.pause();
            } catch {
              // video có thể đã bị huỷ — bỏ qua
            }
            try {
              audioCtx.close();
            } catch {
              // context có thể đã đóng sẵn — bỏ qua
            }
          };

          recorder.onstop = () => {
            cleanup();
            const finalBlob = new Blob(recordedChunks, {
              type: supportedMime || 'video/mp4'
            });
            const exportedUrl = URL.createObjectURL(finalBlob);
            const sizeMb = (finalBlob.size / (1024 * 1024)).toFixed(2) + ' MB';

            const audioReport = [
              audioSettings.enableOriginalAudio
                ? hasOriginalAudioTrack
                  ? `Âm thanh gốc: ${Math.round(audioSettings.originalVideoVolume * 100)}%${decodedAudioBuffer ? '' : ' (dự phòng captureStream)'}`
                  : 'Âm thanh gốc: không đọc được (CORS?)'
                : 'Âm thanh gốc: Tắt',
              'Stereo 48000Hz (192kbps)'
            ].join(' • ');

            onProgress(100, 'Đã hoàn thành!');
            resolve({
              url: exportedUrl,
              blob: finalBlob,
              duration: renderDuration,
              size: sizeMb,
              audioDetails: audioReport
            });
          };

          recorder.onerror = (recErr) => {
            cleanup();
            reject(recErr);
          };

          // Start Recording
          recorder.start(100); // 100ms chunks

          // Phát âm thanh gốc (nếu giải mã thành công) đúng lúc bắt đầu ghi hình,
          // dùng offset/duration của AudioBufferSourceNode để cắt chính xác theo
          // trimStart/renderDuration người dùng đã nhập — không phụ thuộc <video>.
          if (decodedAudioBuffer) {
            bufferSourceNode = audioCtx.createBufferSource();
            bufferSourceNode.buffer = decodedAudioBuffer;
            bufferSourceNode.connect(originalGain);
            const availableFromStart = Math.max(0, decodedAudioBuffer.duration - trimStart);
            const playDuration = Math.max(0.05, Math.min(renderDuration, availableFromStart));
            if (trimStart < decodedAudioBuffer.duration) {
              bufferSourceNode.start(0, trimStart, playDuration);
            }
          }

          // Play video (điểm bắt đầu thật sự của bản ghi — chỉ cấp khung hình)
          await videoEl.play().catch((err) => {
            console.warn('Lưu ý phát video:', err);
          });

          // Animation Loop
          const tick = () => {
            if (isComplete) return;

            drawFrame();

            const currentElapsed = videoEl.currentTime - trimStart;
            const progressPercent = Math.min(
              98,
              Math.max(15, Math.floor(15 + (currentElapsed / renderDuration) * 82))
            );
            const remaining = Math.max(0, renderDuration - currentElapsed);
            onProgress(
              progressPercent,
              `Đang kết xuất (thời gian thực): ${formatClock(currentElapsed)} / ${formatClock(renderDuration)} — còn khoảng ${formatClock(remaining)} (${progressPercent}%)`
            );

            if (videoEl.currentTime >= trimEnd || videoEl.currentTime >= rawVideoDuration || videoEl.ended) {
              onProgress(99, 'Đang hoàn tất...');
              recorder.stop();
              return;
            }

            renderAnimationId = requestAnimationFrame(tick);
          };

          renderAnimationId = requestAnimationFrame(tick);
        } catch (err) {
          console.error('Lỗi khi render video:', err);
          reject(err);
        }
      };
      run();
    });
  }
}

function rawFallbackDuration(videoItem: VideoItem): number {
  // Chỉ dùng khi trình duyệt hoàn toàn không đọc được metadata thời lượng —
  // không phải một giới hạn cắt video, chỉ là giá trị dự phòng cuối cùng.
  return videoItem.duration && videoItem.duration > 0 ? videoItem.duration : 30;
}
