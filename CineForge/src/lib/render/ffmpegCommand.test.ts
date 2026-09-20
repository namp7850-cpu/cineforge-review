import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CLIP_SECONDS,
  buildFfmpegCommand,
  resolveClip,
  sanitizeSettings,
  toFfColor,
  wrapText,
} from "./ffmpegCommand.ts";

const base = (over: Record<string, unknown> = {}, hasAudio = true) =>
  buildFfmpegCommand({
    inputPath: "/tmp/j/input.bin",
    outputPath: "/tmp/j/output.mp4",
    workDir: "/tmp/j",
    fontFile: "/fonts/Bold.ttf",
    settings: sanitizeSettings({
      aspectRatio: "9:16",
      overlayText: "Tiêu đề",
      enableSubtitles: true,
      subtitlesScript: "Phụ đề",
      enableBrandName1: true,
      brandName1: "VEEK",
      enableBrandName2: true,
      brandName2: "veek",
      enableOriginalAudio: true,
      originalVideoVolume: 1,
      ...over,
    }),
    hasAudio,
    sourceDuration: 3000,
  });

describe("sanitizeSettings", () => {
  it("ép kiểu và kẹp giá trị", () => {
    const s = sanitizeSettings({ aspectRatio: "evil", originalVideoVolume: 99, brightness: -5, trimStart: "abc" });
    assert.equal(s.aspectRatio, "16:9");
    assert.equal(s.originalVideoVolume, 2);
    assert.equal(s.brightness, 0.4);
    assert.equal(s.trimStart, 0);
  });
  it("chấp nhận dữ liệu rác", () => {
    assert.doesNotThrow(() => sanitizeSettings(null));
    assert.doesNotThrow(() => sanitizeSettings("x"));
  });
});

describe("resolveClip", () => {
  it("giới hạn tối đa 20 phút", () => {
    const s = sanitizeSettings({ trimStart: 10, trimEnd: 5000 });
    assert.equal(resolveClip(s, 4000).duration, MAX_CLIP_SECONDS);
  });
  it("trimEnd chưa đặt -> dùng đến hết video", () => {
    const s = sanitizeSettings({ trimStart: 0, trimEnd: 0 });
    assert.equal(resolveClip(s, 60).duration, 60);
  });
});

describe("toFfColor", () => {
  it("đổi hex và rgba", () => {
    assert.equal(toFfColor("#f4f0e8"), "0xf4f0e8@1.00");
    assert.equal(toFfColor("rgba(12, 10, 9, 0.72)"), "0x0c0a09@0.72");
  });
  it("giá trị lạ -> mặc định, không lọt ký tự đặc biệt", () => {
    assert.equal(toFfColor("red';drawtext=x", 1, "0xffffff"), "0xffffff");
  });
});

describe("buildFfmpegCommand", () => {
  it("giữ âm thanh gốc: map 0:a:0, không có -an, không dùng nguồn câm", () => {
    const { args } = base();
    const joined = args.join(" ");
    assert.ok(joined.includes("-map 0:a:0"));
    assert.ok(!args.includes("-an"));
    assert.ok(!joined.includes("anullsrc"));
  });
  it("đổi âm lượng qua filter [aout]", () => {
    const joined = base({ originalVideoVolume: 1.5 }).args.join(" ");
    assert.ok(joined.includes("volume=1.50[aout]"));
    assert.ok(joined.includes("-map [aout]"));
  });
  it("chủ động tắt tiếng -> -an", () => {
    assert.ok(base({ enableOriginalAudio: false }).args.includes("-an"));
    assert.ok(base({}, false).args.includes("-an"));
  });
  it("xuất MP4 tương thích TikTok", () => {
    const joined = base().args.join(" ");
    assert.ok(joined.includes("-c:v libx264"));
    assert.ok(joined.includes("-preset veryfast"));
    assert.ok(joined.includes("-crf 20"));
    assert.ok(joined.includes("-pix_fmt yuv420p"));
    assert.ok(joined.includes("-c:a aac"));
    assert.ok(joined.includes("+faststart"));
  });
  it("hỗ trợ GPU NVENC (h264_nvenc, preset p4, -cq:v 22)", () => {
    const cmd = buildFfmpegCommand({
      inputPath: "/tmp/j/input.bin",
      outputPath: "/tmp/j/output.mp4",
      workDir: "/tmp/j",
      fontFile: "/fonts/Bold.ttf",
      settings: sanitizeSettings({}),
      hasAudio: true,
      sourceDuration: 60,
      videoCodec: "h264_nvenc",
    });
    const joined = cmd.args.join(" ");
    assert.ok(joined.includes("-c:v h264_nvenc"));
    assert.ok(joined.includes("-preset p4"));
    assert.ok(joined.includes("-cq:v 22"));
  });
  it("cho phép tùy chỉnh preset ultrafast và quality", () => {
    const cmd = buildFfmpegCommand({
      inputPath: "/tmp/j/input.bin",
      outputPath: "/tmp/j/output.mp4",
      workDir: "/tmp/j",
      fontFile: "/fonts/Bold.ttf",
      settings: sanitizeSettings({}),
      hasAudio: true,
      sourceDuration: 60,
      preset: "ultrafast",
      quality: 24,
    });
    const joined = cmd.args.join(" ");
    assert.ok(joined.includes("-preset ultrafast"));
    assert.ok(joined.includes("-crf 24"));
  });
  it("văn bản người dùng chỉ nằm trong tệp text, không lọt vào tham số", () => {
    const evil = "x';[0:v]movie=/etc/passwd[o];a='";
    const { args, textFiles } = base({ overlayText: evil });
    assert.ok(!args.join(" ").includes("passwd"));
    assert.ok(textFiles.some((t) => t.content.includes("passwd")));
  });
  it("cỡ chữ scale theo khung: 9:16 (1080/360 = 3x)", () => {
    const { args } = base({ textSize: 22 });
    assert.ok(args.join(" ").includes("fontsize=66"));
  });
  it("kích thước đầu ra đúng tỷ lệ", () => {
    const r = base();
    assert.deepEqual([r.width, r.height], [1080, 1920]);
  });
  it("sử dụng bộ lọc lanczos và unsharp để đảm bảo video sắc nét", () => {
    const { args } = base();
    const joined = args.join(" ");
    assert.ok(joined.includes("flags=lanczos"));
    assert.ok(joined.includes("unsharp="));
  });
});

describe("wrapText", () => {
  it("ngắt dòng khi quá dài", () => {
    assert.ok(wrapText("một hai ba bốn năm sáu bảy tám chín mười", 30, 300).includes("\n"));
  });
});
