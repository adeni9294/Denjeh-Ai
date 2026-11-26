import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generatePlanWithFallback } from "@/lib/ai/cloud-runner";
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

const EASY_GOING_SYSTEM_PROMPT = `Kamu adalah asisten obrolan di aplikasi DENJEH AI untuk proyek kreatif seperti DNAverse — The Awakening.
Gaya bicaramu santai, luwes, hangat, dan mengalir seperti teman ngobrol tanya-jawab di Gemini atau ChatGPT.
Aturan utama:
- Jawab langsung ke inti dengan bahasa Indonesia yang natural dan tidak kaku.
- Jika pengguna sedang brainstorming, bertanya ringan, atau mendiskusikan ide/alur, balas secara dialogis dan tawarkan pertanyaan lanjutan atau sudut pandang baru yang relevan.
- Jangan memaksa membuat rencana DAG, JSON, atau format agen yang kaku kecuali pengguna secara eksplisit meminta rencana langkah atau eksekusi tugas.
- Tetap ringkas dan jelas, sesuaikan panjang jawaban dengan konteks obrolan.

Kembalikan jawaban dalam format JSON valid dengan skema:
{
  "reply": "Balasan santai dan natural untuk pengguna"
}`;

function extractReplyFromResult(rawResult: unknown): {
  reply: string;
  modelUsed: string;
  providerUsed: string;
} {
  const resObj = (rawResult ?? {}) as Record<string, unknown>;
  const modelUsed = String(resObj.modelUsed ?? "gemini");
  const providerUsed = String(resObj.providerUsed ?? "gemini");

  if (typeof resObj.reply === "string" && resObj.reply.trim()) {
    return { reply: resObj.reply.trim(), modelUsed, providerUsed };
  }
  if (typeof resObj.intentSummary === "string" && resObj.intentSummary.trim()) {
    return { reply: resObj.intentSummary.trim(), modelUsed, providerUsed };
  }
  if (typeof resObj.rawText === "string" && resObj.rawText.trim()) {
    return { reply: resObj.rawText.trim(), modelUsed, providerUsed };
  }

  return {
    reply: "Siap, ada yang ingin kita obrolkan atau eksplorasi lebih lanjut?",
    modelUsed,
    providerUsed,
  };
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

    const conversationText = turns
      .map((t) => `${t.role === "assistant" ? "Asisten" : "Pengguna"}: ${t.content.trim()}`)
      .join("\n");

    const memoryText =
      memories.length > 0
        ? memories
            .slice(0, 5)
            .map((m) => `- ${m.memory_key}: ${m.content}`)
            .join("\n")
        : "- Tidak ada catatan memori tambahan.";

    const userPrompt = `PROYEK AKTIF: ${projectContext?.name ?? "Tanpa Proyek Khusus"}
DESKRIPSI PROYEK: ${projectContext?.description ?? "-"}

MEMORI TERKAIT:
${memoryText}

RIWAYAT OBROLAN:
${conversationText}

Balas pesan terakhir pengguna dengan santai dan mengalir.`;

    const result = await generatePlanWithFallback({
      providers: (providers as DbAiProvider[]) ?? [],
      models: (models as DbAiModel[]) ?? [],
      systemPrompt: EASY_GOING_SYSTEM_PROMPT,
      userPrompt,
    });

    const extracted = extractReplyFromResult(result);

    return NextResponse.json({
      ok: true,
      reply: extracted.reply,
      modelUsed: extracted.modelUsed,
      providerUsed: extracted.providerUsed,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat memproses obrolan.",
      },
      { status: 500 }
    );
  }
}
