import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const scriptInput = z.object({
  filmTitle: z.string().min(1).max(160),
  year: z.string().max(12).optional(),
  genre: z.string().max(40).optional(),
  tone: z.string().max(80).optional(),
  spoilerLevel: z.enum(["none", "light", "full"]).optional(),
  targetSeconds: z.number().min(8).max(600),
  platform: z.enum(["youtube", "tiktok", "both"]).optional(),
  extra: z.string().max(400).optional(),
});

export type ScriptPayload = {
  catchyTitle: string;
  /** Phần 1 — HOOK: câu mở gây chú ý trong 1-2 giây đầu */
  hook: string;
  /** Phần 2 — NỘI DUNG CHÍNH: tóm tắt trải nghiệm/điểm nổi bật */
  content: string;
  /** Phần 3 — CALL TO ACTION: điều hướng thả tim / bình luận / xem tiếp */
  cta: string;
  subtitles: string;
  /** Phần 4 — HASHTAG: 3-5 hashtag liên quan trực tiếp tới phim */
  hashtags: string[];
  thumbnailText: string;
  provider: string;
};

export interface ProviderHealth {
  id: string;
  label: string;
  hasKey: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/**
 * ==========================================================================
 * KIẾN TRÚC: mỗi provider ĐỘC LẬP — 1 provider lỗi không kéo sập các provider
 * còn lại (fix lỗi "OpenAI lỗi thì tất cả AI đều lỗi" đã báo cáo trước đó).
 * ==========================================================================
 * - `generateReviewScript` thử LẦN LƯỢT từng provider có key trong .env theo
 *   thứ tự ưu tiên bên dưới; nếu provider đầu tiên lỗi (sai model, hết quota,
 *   sai key...), tự động thử provider tiếp theo — không dừng lại và trả fallback
 *   ngay như trước.
 * - Mỗi lần thử (thành công hay lỗi) đều được ghi lại vào `providerHealth`
 *   (bộ nhớ tạm phía server) để bảng trạng thái AI trên UI hiển thị ĐÚNG provider
 *   nào đang lỗi, lỗi gì — thay vì chỉ một dòng "chưa cấu hình" chung chung.
 *
 * BẢO MẬT: các key dưới đây CHỈ đọc bằng `process.env` bên trong server
 * function này — không có tiền tố VITE_, không bao giờ gửi ra client.
 */
interface ProviderConfig {
  id: string;
  label: string;
  envKeys: string[];
  call: (apiKey: string, prompt: string) => Promise<string>;
}

async function callOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "Bạn là chuyên gia tạo caption TikTok triệu view cho kênh VEEK REVIEW — viết theo đúng cấu trúc 4 phần: Hook, Nội dung chính, Call to action, Hashtag. Văn phong tự nhiên, đúng chất TikTok, không sáo rỗng. Chỉ trả JSON hợp lệ.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const bodyText = (await res.text()).slice(0, 300);
    const hint =
      res.status === 402
        ? " (hết tiền/credit trong tài khoản)"
        : res.status === 404
          ? " (sai tên model hoặc không có quyền dùng model này)"
          : res.status === 429
            ? " (hết hạn mức/rate limit — thử lại sau hoặc nâng gói)"
            : res.status === 401
              ? " (API key sai hoặc đã bị thu hồi)"
              : "";
    throw new Error(`HTTP ${res.status}${hint}: ${bodyText}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("Phản hồi rỗng từ API");
  return text;
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 900 },
    }),
  });
  if (!res.ok) {
    const bodyText = (await res.text()).slice(0, 300);
    const hint =
      res.status === 404
        ? " (sai tên model hoặc không có quyền dùng model này)"
        : res.status === 429
          ? " (hết hạn mức/rate limit — thử lại sau)"
          : "";
    throw new Error(`HTTP ${res.status}${hint}: ${bodyText}`);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Phản hồi rỗng từ API");
  return text;
}

// Thứ tự ưu tiên khi nhiều provider cùng có key — thử lần lượt cho tới khi
// một provider trả kết quả hợp lệ.
const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKeys: ["OPENAI_API_KEY"],
    call: (key, prompt) => callOpenAiCompatible("https://api.openai.com/v1/chat/completions", key, "gpt-4o-mini", prompt),
  },
  {
    id: "groq",
    label: "Groq",
    envKeys: ["GROQ_API_KEY"],
    call: (key, prompt) => callOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", key, "llama-3.3-70b-versatile", prompt),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKeys: ["DEEPSEEK_API_KEY"],
    call: (key, prompt) => callOpenAiCompatible("https://api.deepseek.com/chat/completions", key, "deepseek-chat", prompt),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    // OpenRouter BẮT BUỘC model id có tiền tố "provider/" (vd. "openai/gpt-4o-mini"),
    // khác với gọi trực tiếp OpenAI/Groq — thiếu tiền tố sẽ ra lỗi 404 model_not_found.
    envKeys: ["OPENROUTER_API_KEY"],
    call: (key, prompt) => callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", key, "openai/gpt-4o-mini", prompt),
  },
  {
    id: "gemini",
    label: "Gemini",
    // gemini-1.5-flash đã bị Google khai tử — dùng bản đang GA hiện tại.
    envKeys: ["GEMINI_API_KEY"],
    call: (key, prompt) => callGemini(key, "gemini-3.1-flash-lite", prompt),
  },
  {
    id: "grok",
    label: "xAI Grok",
    envKeys: ["XAI_API_KEY"],
    call: (key, prompt) => callOpenAiCompatible("https://api.x.ai/v1/chat/completions", key, "grok-4.5", prompt),
  },
];

// Trạng thái từng provider — lưu tạm trong bộ nhớ server (mất khi restart dev
// server, không cần bền vững hơn cho một công cụ nội bộ như thế này).
const providerHealth = new Map<string, ProviderHealth>(
  PROVIDERS.map((p) => [
    p.id,
    { id: p.id, label: p.label, hasKey: false, lastAttemptAt: null, lastSuccessAt: null, lastError: null },
  ]),
);

function getKeyFor(provider: ProviderConfig): string | null {
  for (const envKey of provider.envKeys) {
    const value = process.env[envKey]?.trim();
    if (value) return value;
  }
  return null;
}

function recordAttempt(id: string, hasKey: boolean, error: string | null) {
  const now = new Date().toISOString();
  const prev = providerHealth.get(id);
  providerHealth.set(id, {
    id,
    label: prev?.label ?? id,
    hasKey,
    lastAttemptAt: now,
    lastSuccessAt: error ? prev?.lastSuccessAt ?? null : now,
    lastError: error,
  });
}

function extractJson(text: string): Partial<ScriptPayload> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Partial<ScriptPayload>;
  } catch {
    return {};
  }
}

function fallbackScript(film: string, seconds: number): ScriptPayload {
  const hook = `${film} có đáng để bạn dành ${seconds} giây tối nay không?`;
  const content = `Gom hết điểm hay – dở của "${film}" trong một đoạn ngắn để bạn tham khảo trước khi bấm play. Diễn xuất, kịch bản, nhịp phim — mọi thứ đáng nói đều ở đây.`;
  const cta = "Thả tim nếu bạn cũng khoái phim này, và comment phim tiếp theo bạn muốn mình review nhé!";
  return {
    catchyTitle: `${film} — review nhanh`,
    hook,
    content,
    cta,
    subtitles: hook.slice(0, 90),
    hashtags: ["#reviewphim", "#phimhay", "#veekreview", `#${film.replace(/\s+/g, "").toLowerCase()}`],
    thumbnailText: film.toUpperCase(),
    provider: "fallback",
  };
}

export const generateReviewScript = createServerFn({ method: "POST" })
  .validator((input: unknown) => scriptInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: true; data: ScriptPayload } | { ok: false; error: string; data: ScriptPayload }> => {
    const film = data.filmTitle.trim();
    const seconds = Math.round(data.targetSeconds);
    const spoiler =
      data.spoilerLevel === "full"
        ? "được phép spoiler có đánh dấu"
        : data.spoilerLevel === "none"
          ? "CẤM spoiler hoàn toàn"
          : "spoiler rất nhẹ, không tiết lộ ending";
    const platform =
      data.platform === "tiktok"
        ? "TikTok / Shorts dọc, câu ngắn, nhịp nhanh"
        : "YouTube review ngang, kể chuyện chậm rãi";

    const fallback = fallbackScript(film, seconds);

    const prompt = `Bạn là một Chuyên gia Tạo Nội Dung Review TikTok triệu view.
Hãy viết một đoạn mô tả (caption) video theo đúng CẤU TRÚC 4 PHẦN CHUẨN TIKTOK dưới đây cho phim "${film}"${data.year ? ` (${data.year})` : ""}, thể loại ${data.genre || "chính kịch"}, tông "${data.tone || "kịch tính"}", thời lượng video ${seconds} giây, nền tảng ${platform}. Mức spoiler: ${spoiler}.
${data.extra ? `Yêu cầu thêm: ${data.extra}` : ""}

CẤU TRÚC BẮT BUỘC:
1. "hook" — HOOK (1-2 giây đầu / dòng đầu tiên): gây chú ý ngay lập tức bằng câu hỏi, sự thật bất ngờ, hoặc đánh vào nỗi tò mò của người xem về phim "${film}".
2. "content" — NỘI DUNG CHÍNH (1-2 câu): tóm tắt ngắn gọn điểm nổi bật nhất của phim (diễn xuất, kịch bản, cảm xúc...), không dịch máy, không emoji.
3. "cta" — CALL TO ACTION: điều hướng người xem thả tim, bình luận, hoặc xem tiếp — không rập khuôn.
4. "hashtags" — HASHTAG: 3-5 hashtag liên quan trực tiếp đến phim "${film}" và thể loại ${data.genre || "phim"} cùng xu hướng (không dùng hashtag chung chung không liên quan).

QUY TẮC BỔ SUNG:
- Giữ văn phong tự nhiên, hấp dẫn, đúng chất TikTok.
- Không viết các câu cảnh báo rập khuôn hoặc triết lý sáo rỗng không liên quan.
- "subtitles": 1 câu ngắn (dưới 90 ký tự) để hiện phụ đề trên video, lấy ý từ hook.
- Trả JSON thuần, không markdown, không giải thích thêm:

{
  "catchyTitle": "",
  "hook": "",
  "content": "",
  "cta": "",
  "subtitles": "",
  "hashtags": ["#..."],
  "thumbnailText": ""
}`;

    const attempted: string[] = [];
    for (const provider of PROVIDERS) {
      const apiKey = getKeyFor(provider);
      const hasKey = Boolean(apiKey);
      if (!hasKey) {
        recordAttempt(provider.id, false, providerHealth.get(provider.id)?.lastError ?? null);
        continue;
      }
      try {
        const text = await provider.call(apiKey as string, prompt);
        const parsed = extractJson(text);
        if (!parsed.hook && !parsed.content) {
          throw new Error("Không đọc được JSON hợp lệ từ phản hồi AI");
        }
        recordAttempt(provider.id, true, null);
        const merged: ScriptPayload = {
          catchyTitle: parsed.catchyTitle || fallback.catchyTitle,
          hook: parsed.hook || fallback.hook,
          content: parsed.content || fallback.content,
          cta: parsed.cta || fallback.cta,
          subtitles: parsed.subtitles || parsed.hook || fallback.subtitles,
          hashtags: parsed.hashtags?.length ? parsed.hashtags : fallback.hashtags,
          thumbnailText: parsed.thumbnailText || film.toUpperCase(),
          provider: provider.label,
        };
        return { ok: true, data: merged };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Lỗi không xác định";
        recordAttempt(provider.id, true, message);
        attempted.push(`${provider.label}: ${message}`);
        // KHÔNG return ở đây — tiếp tục thử provider tiếp theo thay vì sập cả chuỗi.
      }
    }

    if (attempted.length === 0) {
      return {
        ok: false,
        error:
          "Chưa tìm thấy API key hợp lệ trong .env (OPENAI_API_KEY / GROQ_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY / XAI_API_KEY). Kiểm tra file .env ở thư mục gốc dự án và khởi động lại server (npm run dev).",
        data: fallback,
      };
    }
    return {
      ok: false,
      error: `Tất cả provider đã cấu hình đều lỗi:\n${attempted.join("\n")}`,
      data: fallback,
    };
  });

export const getAiStatus = createServerFn({ method: "POST" }).handler(async () => {
  // Cập nhật hasKey mới nhất (không tốn call mạng) cho mọi provider, kể cả
  // provider chưa từng được gọi lần nào — để bảng trạng thái luôn đầy đủ.
  for (const provider of PROVIDERS) {
    const prev = providerHealth.get(provider.id);
    providerHealth.set(provider.id, {
      id: provider.id,
      label: provider.label,
      hasKey: Boolean(getKeyFor(provider)),
      lastAttemptAt: prev?.lastAttemptAt ?? null,
      lastSuccessAt: prev?.lastSuccessAt ?? null,
      lastError: prev?.lastError ?? null,
    });
  }
  const providers = PROVIDERS.map((p) => providerHealth.get(p.id)!);
  const active = providers.find((p) => p.hasKey && !p.lastError) ?? providers.find((p) => p.hasKey);
  return {
    configured: providers.some((p) => p.hasKey),
    provider: active?.label ?? null,
    providers,
    checkedAt: new Date().toISOString(),
  };
});
