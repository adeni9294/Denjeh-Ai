import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generatePlanWithFallback } from "@/lib/ai/cloud-runner";
import {
  DbAiModel,
  DbAiProvider,
  DbMemory,
  DbProject,
  TaskStatus,
} from "@/types/studio";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Konfigurasi Supabase server belum lengkap." },
        { status: 500 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Sesi tidak valid. Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      projectId?: string;
      instruction?: string;
      mode?: "manual" | "autonomous";
      attachments?: { name: string; type: string; note?: string }[];
      previousPlanSummary?: string;
    };

    const instruction = (body.instruction ?? "").trim();
    if (!instruction) {
      return NextResponse.json(
        { error: "Instruksi tidak boleh kosong." },
        { status: 400 }
      );
    }

    const mode = body.mode === "autonomous" ? "autonomous" : "manual";

    // 1. Ambil konteks proyek & memori terisolasi
    let projectContext: DbProject | null = null;
    let memories: DbMemory[] = [];

    if (body.projectId) {
      const { data: proj } = await supabase
        .from("projects")
        .select("*")
        .eq("id", body.projectId)
        .single();
      projectContext = (proj as DbProject) ?? null;

      const { data: memRows } = await supabase
        .from("memories")
        .select("*")
        .or(`project_id.eq.${body.projectId},and(scope.eq.user,project_id.is.null)`)
        .order("importance", { ascending: false })
        .limit(20);
      memories = (memRows as DbMemory[]) ?? [];
    }

    // 2. Ambil daftar AI provider & model aktif
    const [{ data: providers }, { data: models }] = await Promise.all([
      supabase
        .from("ai_providers")
        .select("*")
        .eq("is_enabled", true)
        .order("priority_order", { ascending: true }),
      supabase.from("ai_models").select("*").eq("is_active", true),
    ]);

    const systemPrompt = `Anda adalah Master Orchestrator dari DENJEH AI (Autonomous Multi-Agent Creative Studio).
Tugas Anda adalah memahami instruksi pengguna, membaca memori proyek, lalu menyusun rencana eksekusi multi-agen dalam format JSON murni.

Daftar agen resmi yang tersedia:
- idea (Idea Agent): konsep & ide kreatif
- research (Research Agent): riset & referensi
- story (Story Agent): naskah, narasi, struktur cerita
- character (Character Agent): profil karakter & kontinuitas
- visual (Visual Agent): arahan visual & image prompt
- video (Video Agent): storyboard, shot list, video prompt per klip
- marketing (Marketing Agent): caption, hashtag, jadwal distribusi
- publishing (Publishing Agent): kesiapan rilis platform sosial
- quality (Quality Agent): evaluasi kualitas & audit kontinuitas sebelum selesai

WAJIB kembalikan JSON valid dengan skema persis seperti ini (bahasa Indonesia untuk deskripsi langkah):
{
  "intentSummary": "Ringkasan tujuan kreatif dan strategi koordinasi agen",
  "recommendedMode": "manual",
  "steps": [
    {
      "stepNumber": 1,
      "agentCode": "story",
      "agentName": "Story Agent",
      "action": "Penjelasan tugas spesifik untuk agen ini",
      "dependsOn": "Project Memory",
      "estimatedOutput": "Jenis artefak yang dihasilkan"
    }
  ]
}`;

    const memoryText =
      memories.length > 0
        ? memories
            .map((m) => `- [${m.scope.toUpperCase()}] ${m.memory_key}: ${m.content}`)
            .join("\n")
        : "- Belum ada memori tersimpan untuk proyek ini.";

    const attachmentText =
      body.attachments && body.attachments.length > 0
        ? body.attachments
            .map((a) => `- ${a.name} (${a.type})${a.note ? `: ${a.note}` : ""}`)
            .join("\n")
        : "- Tidak ada lampiran.";

    const userPrompt = `PROYEK AKTIF: ${projectContext?.name ?? "Tanpa Proyek Khusus"}
DESKRIPSI PROYEK: ${projectContext?.description ?? "-"}
INSTRUKSI SISTEM PROYEK: ${projectContext?.system_instructions ?? "-"}
MODE OPERASI DIPILIH: ${mode}

MEMORI TERISOLASI PROYEK & USER:
${memoryText}

LAMPIRAN / REFERENSI:
${attachmentText}

${body.previousPlanSummary ? `KONTEKS RENCANA SEBELUMNYA (UNTUK REVISI LANJUTAN):\n${body.previousPlanSummary}\n` : ""}
INSTRUKSI PENGGUNA:
${instruction}`;

    // 3. Panggil AI Cloud
    const planResult = await generatePlanWithFallback({
      providers: (providers as DbAiProvider[]) ?? [],
      models: (models as DbAiModel[]) ?? [],
      systemPrompt,
      userPrompt,
    });

    // 4. Catat usage log
    await supabase.from("usage_logs").insert({
      user_id: user.id,
      project_id: projectContext?.id ?? null,
      provider_key: planResult.providerUsed,
      model_identifier: planResult.modelUsed,
      input_tokens: planResult.inputTokens,
      output_tokens: planResult.outputTokens,
      estimated_cost_usd: 0,
    });

    // 5. Simpan langsung sebagai riwayat di workflow_runs & tasks agar tidak pernah hilang
    const runStatus = mode === "autonomous" ? "running" : "waiting_approval";
    const { data: savedRun } = await supabase
      .from("workflow_runs")
      .insert({
        user_id: user.id,
        project_id: projectContext?.id ?? null,
        workflow_id: null,
        title: instruction.slice(0, 140),
        trigger_mode: mode,
        status: runStatus,
        current_step: 1,
        total_steps: planResult.steps.length,
      })
      .select()
      .single();

    if (savedRun) {
      const taskRows = planResult.steps.map((step, idx) => {
        const initialStatus: TaskStatus =
          mode === "autonomous" && idx === 0 ? "running" : "awaiting_approval";

        return {
          workflow_run_id: savedRun.id,
          user_id: user.id,
          project_id: projectContext?.id ?? null,
          agent_code: step.agentCode || "story",
          step_order: step.stepNumber || idx + 1,
          title: `${step.agentName}: ${step.action.slice(0, 80)}`,
          instruction: step.action,
          depends_on_task_ids: [],
          status: initialStatus,
          input_payload: {
            agentName: step.agentName,
            dependsOn: step.dependsOn,
            estimatedOutput: step.estimatedOutput,
            intentSummary: planResult.intentSummary,
          },
          output_payload: {},
        };
      });

      await supabase.from("tasks").insert(taskRows);
    }

    return NextResponse.json({
      ok: true,
      planResult,
      loadedMemoryCount: memories.length,
      savedRunId: savedRun?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat menyusun rencana di Master Orchestrator.",
      },
      { status: 500 }
    );
  }
}
