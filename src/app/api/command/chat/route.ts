import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DbAiModel, DbAiProvider, DbMemory, DbProject } from "@/types/studio";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  projectId?: string;
  message?: string;
  messages?: ChatTurn[];
}

const CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

const EASY_GOING_SYSTEM_PROMPT = `Kamu adalah asisten obrolan di aplikasi DENJEH AI untuk proyek kreatif seperti DNAverse — The Awakening.
Gaya bicaramu santai, luwes, hangat, dan mengalir seperti teman ngobrol tanya-jawab di Gemini atau ChatGPT.
Aturan utama:
- Jawab langsung ke inti dengan bahasa Indonesia yang natural dan tidak kaku.
- Jika pengguna sedang brainstorming, bertanya ringan, atau mendiskusikan ide/alur, balas secara dialogis dan tawarkan pertanyaan lanjutan atau sudut pandang baru yang relevan.
- Jangan memaksa membuat rencana DAG, JSON, atau format agen yang kaku kecuali pengguna secara eksplisit meminta rencana langkah atau eksekusi tugas.
- Tetap ringkas dan jelas, sesuaikan panjang jawaban dengan konteks obrolan.`;

function extractGeminiKeyFromProviders(
  providers: DbAiProvider[],
  models: DbAiModel[]
): { apiKey: string; modelName: string } {
  const activeModel = models.find((m) => {
    const id = String(m.model_identifier ?? "").toLowerCase();
    const prov = String(
      (m as unknown as Record<string, unknown>).provider_key ?? ""
    ).toLowerCase();
    return id.includes("gemini") || prov.includes("gemini") || prov.includes("google");
  });

  const preferredModel = activeModel?.model_identifier || CHAT_MODELS[0];

  for (const p of providers) {
    const row = p as unknown as Record<string, unknown>;
    const pKey = String(
      row.provider_key ?? row.provider_name ?? row.name ?? ""
    ).toLowerCase();
    const candidateKey = String(
      row.api_key ??
        row.apiKey ??
        row.encrypted_api_key ??
        row.key_value ??
        row.secret_key ??
        ""
    ).trim();

    if (
      candidateKey &&
      (pKey.includes("gemini") ||
        pKey.includes("google") ||
        candidateKey.startsWith("AIza"))
    ) {
      return { apiKey: candidateKey, modelName: preferredModel };
    }
  }

  const envKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    "";

  return { apiKey: envKey, modelName: preferredModel };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Konfigurasi Supabase server belum lengkap." },
        { status: 500 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sesi tidak valid. Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    let body: ChatRequestBody = {};
    try {
      body = (await req.json()) as ChatRequestBody;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Format JSON permintaan tidak valid." },
        { status: 400 }
      );
    }

    const directMessage =
      typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.messages) ? body.messages : [];

    const turns: ChatTurn[] =
      history.length > 0
        ? history
            .filter(
              (item) =>
                item &&
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string" &&
                item.content.trim().length > 0
            )
            .slice(-14)
        : directMessage
        ? [{ role: "user", content: directMessage }]
        : [];

    if (turns.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Pesan obrolan tidak boleh kosong." },
        { status: 400 }
      );
    }

    let projectContext: DbProject | null = null;
    let memories: DbMemory[] = [];

    if (body.projectId) {
      const [{ data: proj }, { data: memRows }] = await Promise.all([
        supabase.from("projects").select("*").eq("id", body.projectId).single(),
        supabase
          .from("memories")
          .select("*")
          .eq("user_id", user.id)
          .or(
            `project_id.eq.${body.projectId},and(scope.eq.user,project_id.is.null)`
          )
          .order("importance", { ascending: false })
          .limit(10),
      ]);
      projectContext = (proj as DbProject) ?? null;
      memories = (memRows as DbMemory[]) ?? [];
    }

    const [{ data: providers }, { data: models }] = await Promise.all([
      supabase
        .from("ai_providers")
        .select("*")
        .eq("is_enabled", true)
        .order("priority_order", { ascending: true }),
      supabase.from("ai_models").select("*").eq("is_active", true),
    ]);

    const { apiKey, modelName } = extractGeminiKeyFromProviders(
      (providers as DbAiProvider[]) ?? [],
      (models as DbAiModel[]) ?? []
    );

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "API key Gemini tidak ditemukan pada konfigurasi ai_providers maupun environment server.",
        },
        { status: 500 }
      );
    }

    const contextNote = projectContext
      ? `\nKonteks proyek aktif: ${projectContext.name}${
          projectContext.description ? ` — ${projectContext.description}` : ""
        }.${
          memories.length > 0
            ? `\nCatatan memori relevan:\n${memories
                .slice(0, 5)
                .map((m) => `- ${m.memory_key}: ${m.content}`)
                .join("\n")}`
            : ""
        }`
      : "";

    const contents = turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content.trim() }],
    }));

    const modelQueue = Array.from(
      new Set([modelName, ...CHAT_MODELS].filter(Boolean))
    );

    let lastError = "";
    for (const model of modelQueue) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: `${EASY_GOING_SYSTEM_PROMPT}${contextNote}` }],
            },
            contents,
            generationConfig: {
              temperature: 0.8,
            },
          }),
        });

        const rawText = await response.text();
        if (!response.ok) {
          lastError = `${model} (${response.status}): ${rawText.slice(0, 240)}`;
          continue;
        }

        let data: {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        } = {};
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          lastError = `${model}: Respons Gemini bukan JSON valid.`;
          continue;
        }

        const replyText = data.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("")
          .trim();

        if (!replyText) {
          lastError = `${model}: Respons teks kosong.`;
          continue;
        }

        return NextResponse.json({
          ok: true,
          reply: replyText,
          modelUsed: model,
          providerUsed: "gemini",
        });
      } catch (fetchErr) {
        lastError =
          fetchErr instanceof Error
            ? `${model}: ${fetchErr.message}`
            : `${model}: Gagal memanggil Gemini API.`;
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: `Gagal mendapatkan balasan obrolan: ${lastError || "Unknown error"}`,
      },
      { status: 502 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Terjadi kesalahan internal saat memproses obrolan.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
