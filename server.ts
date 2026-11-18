import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/transcribe", async (req, res) => {
    try {
      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          error: "خدمة التفريغ الدقيق غير مهيأة حالياً. يمكنك استخدام التحويل المباشر من المتصفح.",
        });
        return;
      }

      const { audioBase64, mimeType, languageHint } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        languageHint?: string;
      };

      if (!audioBase64 || !mimeType) {
        res.status(400).json({ error: "بيانات الصوت غير مكتملة." });
        return;
      }

      const cleanMime = mimeType.split(";")[0].trim() || "audio/webm";
      const hintText =
        languageHint && languageHint.startsWith("en")
          ? "Transcribe the spoken words accurately in English. Output only the spoken transcript with proper punctuation, no timestamps or commentary."
          : "فرّغ الكلام المنطوق في هذا التسجيل بدقة تامة كما قيل باللغة العربية (بما في ذلك اللهجة المصرية أو الفصحى أو الإنجليزية إذا وردت). أعد النص المنطوق فقط دون أي مقدمات أو شروحات أو طوابع زمنية.";

      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: audioBase64,
              },
            },
            {
              text: hintText,
            },
          ],
        },
      });

      const text = (response.text ?? "").trim();
      res.json({ text });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "تعذر تحويل الصوت إلى نص";
      console.error("Transcribe error:", message);
      res.status(500).json({
        error: "تعذر معالجة التسجيل الصوتي، يرجى المحاولة مرة أخرى.",
      });
    }
  });

  app.post("/api/tts", async (req, res) => {
    try {
      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          error: "خدمة النطق الصوتي السحابي غير مهيأة حالياً.",
        });
        return;
      }

      const { text, voiceName } = req.body as {
        text?: string;
        voiceName?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: "يرجى إدخال نص لقراءته صوتياً." });
        return;
      }

      const selectedVoice = voiceName || "Kore";
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: text.trim().slice(0, 1000),
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.status(500).json({ error: "لم يتم توليد الملف الصوتي." });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "تعذر نطق النص";
      console.error("TTS error:", message);
      res.status(500).json({
        error: "حدث خطأ أثناء نطق النص صوتياً.",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Wesal server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
