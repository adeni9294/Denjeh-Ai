import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generatePlanWithFallback } from "@/lib/ai/cloud-runner";
import {
  buildAgentToolInstructionBlock,
  getAgentSpec,
} from "@/lib/ai/agent-tools";
import { DbAiModel, DbAiProvider, DbMemory, DbProject } from "@/types/studio";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
  let resolvedTaskId = "";

  try {
    const { taskId } = await context.params;
    resolvedTaskId = taskId;

    if (!taskId) {
      return NextResponse.json(
        { error: "ID tugas tidak valid." },
        { status: 400 }
      );
    }

    let preferredModel: string | undefined;
    try {
      const body = (await req.json()) as { preferredModel?: string };
      if (body?.preferredModel) {
        preferredModel = String(body.preferredModel).trim();
      }
    } catch {
      // Body kosong diabaikan
    }

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

    // 1. Ambil task target milik user
    const { data: taskRow, error: taskErr } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", user.id)
      .single();

    if (taskErr || !taskRow) {
      return NextResponse.json(
        { error: "Tugas tidak ditemukan atau akses ditolak." },
        { status: 404 }
      );
    }

    await supabase
      .from("tasks")
      .update({
        status: "running",
        progress: 25,
        started_at: taskRow.started_at || new Date().toISOString(),
        error_message: null,
      })
      .eq("id", taskRow.id);

    // 2. Ambil konteks proyek & memori
    let projectContext: DbProject | null = null;
    let memories: DbMemory[] = [];

    if (taskRow.project_id) {
      const { data: proj } = await supabase
        .from("projects")
        .select("*")
        .eq("id", taskRow.project_id)
        .single();
      projectContext = (proj as DbProject) ?? null;

      const { data: memRows } = await supabase
        .from("memories")
        .select("*")
        .eq("user_id", user.id)
        .or(
          `project_id.eq.${taskRow.project_id},and(scope.eq.user,project_id.is.null)`
        )
        .order("importance", { ascending: false })
        .limit(20);
      memories = (memRows as DbMemory[]) ?? [];
    }

    // 3. Ambil output langkah sebelumnya & judul run dalam workflow_run yang sama
    let priorOutputsText = "- Tidak ada output langkah sebelumnya.";
    let rootCommandTitle = "";

    if (taskRow.workflow_run_id) {
      const [{ data: runRow }, { data: siblingTasks }] = await Promise.all([
        supabase
          .from("workflow_runs")
          .select("plan_json")
          .eq("id", taskRow.workflow_run_id)
          .maybeSingle(),
        supabase
          .from("tasks")
          .select("id, title, status, input_payload, output_payload")
          .eq("workflow_run_id", taskRow.workflow_run_id)
          .eq("user_id", user.id),
      ]);

      if (runRow?.plan_json && typeof runRow.plan_json === "object") {
        const meta = runRow.plan_json as Record<string, unknown>;
        rootCommandTitle = String(meta.title ?? "").trim();
      }

      const completedPrior = ((siblingTasks ?? []) as Record<string, unknown>[])
        .filter((t) => t.id !== taskRow.id && t.status === "completed")
        .sort((a, b) => {
          const aPayload = (a.input_payload ?? {}) as Record<string, unknown>;
          const bPayload = (b.input_payload ?? {}) as Record<string, unknown>;
          return (
            Number(aPayload.stepOrder ?? 0) - Number(bPayload.stepOrder ?? 0)
          );
        });

      if (completedPrior.length > 0) {
        priorOutputsText = completedPrior
          .map((t) => {
            const out = (t.output_payload ?? {}) as Record<string, unknown>;
            return `- ${String(t.title ?? "Langkah")}: ${String(
              out.contentMarkdown || out.summary || ""
            ).slice(0, 1200)}`;
          })
          .join("\n\n");
      }
    }

    // 4. Ambil provider & model aktif
    const [{ data: providers }, { data: models }] = await Promise.all([
      supabase
        .from("ai_providers")
        .select("*")
        .eq("is_enabled", true)
        .order("priority_order", { ascending: true }),
      supabase.from("ai_models").select("*").eq("is_active", true),
    ]);

    const payload = (taskRow.input_payload ?? {}) as Record<string, unknown>;
    const agentCode = String(
      payload.agentCode || taskRow.agent_code || "story"
    )
      .toLowerCase()
      .trim();
    const agentSpec = getAgentSpec(agentCode);
    const agentName = String(payload.agentName || agentSpec.name);
    const instruction = String(payload.instruction || taskRow.title || "");
    const estimatedOutput = String(
      payload.estimatedOutput || "Artefak Kreatif Terstruktur"
    );
    const toolInstructionBlock = buildAgentToolInstructionBlock(agentCode);

    const videoMasterPromptTemplate =
      agentCode === "video"
        ? `
KHUSUS VIDEO AGENT — ATURAN WAJIB MASTER PROMPT UTUH PER KLIP:
1. Patuhi durasi setiap klip persis sesuai perintah pengguna (misalnya jika diminta 10s per klip maka setiap klip wajib 10 SECONDS; jika diminta 8s maka 8 SECONDS; jika diminta 15s maka 15 SECONDS). DILARANG mencampur durasi berbeda kecuali diminta.
2. Buat SATU elemen di array "steps" untuk SETIAP KLIP (stepNumber = nomor klip: 1, 2, 3, dst.).
3. Pada field "action" di setiap klip, tulis SATU MASTER PROMPT UTUH yang menyatukan cerita/adegan, lokasi, karakter & kostum, rincian aksi per rentang detik, kamera, gaya visual, sound design, dialog, kontinuitas, dan negative prompt dengan struktur blok persis seperti template berikut (dalam bahasa Inggris sinematik agar siap tempel ke video generator):

TITLE: [JUDUL PROYEK / EPISODE]
SCENE [01/02/dst]: [NAMA ADEGAN]
DURATION: [DURASI KLIP SESUAI PERINTAH, misal 10 SECONDS]
GENRE: [GENRE]
STYLE: [GAYA VISUAL UTAMA]

CONTINUATION FROM PREVIOUS SCENE:
[Sambungan persis dari frame akhir klip sebelumnya, atau adegan pembuka untuk Scene 01]

CHARACTER LOCK:
[Identitas lengkap karakter utama, wajah, rambut, kostum, properti, serta kondisi fisik/luka yang harus dikunci]

ENEMY / SUBJECT LOCK:
[Identitas lawan/subjek/objek kunci lain dalam adegan atau "None" jika tidak ada]

ACTION TIMELINE:
0–2 SECONDS:
[Detail shot, ekspresi, gerakan karakter, pencahayaan]

2–4 SECONDS:
[Detail lanjutan aksi per detik]

4–6 SECONDS:
[Detail lanjutan aksi per detik]

6–8 SECONDS:
[Detail lanjutan aksi per detik]

8–10 SECONDS:
[Detail penutup klip dan posisi akhir frame; sesuaikan rentang detik dengan durasi klip yang diminta]

COMBAT / MOVEMENT STYLE:
[Gaya koreografi, fisika gerakan, ritme aksi]

SPECIAL VISUAL DETAILS:
[Detail efek visual/teknologi/atmosfer spesifik tanpa menyalahi aturan proyek]

CAMERA:
[Jenis shot, pergerakan kamera, framing dari awal hingga akhir klip]

VISUAL STYLE:
[Detail fotorealisme, pencahayaan, tekstur lokasi, film grain]

SOUND DESIGN:
[Efek suara detail, langkah kaki, benturan, atmosfer, musik/bass]

DIALOGUE:
[Karakter/suara dan dialog singkat yang diucapkan di klip ini, atau "None"]

STRICT CONTINUITY:
[Aturan konsistensi latar, posisi karakter, properti, pencahayaan, dan larangan lompatan waktu]

NEGATIVE PROMPT:
[Daftar larangan visual/animasi/distorsi wajah/perubahan kostum]`
        : "";

    const systemPrompt = `Anda adalah ${agentName} dalam sistem DENJEH AI.
Hasilkan keluaran nyata, detail, dan siap pakai sesuai tugas agen Anda dalam format JSON murni.

${toolInstructionBlock}
${videoMasterPromptTemplate}

WAJIB kembalikan JSON valid dengan skema persis seperti ini:
{
  "intentSummary": "Ringkasan hasil kerja agen secara jelas dalam bahasa Indonesia",
  "recommendedMode": "manual",
  "steps": [
    {
      "stepNumber": 1,
      "agentCode": "${agentCode}",
      "agentName": "${agentName}",
      "action": "Isi detail / master prompt utuh siap pakai dari hasil kerja agen ini",
      "dependsOn": "${String(payload.dependsOn || "Previous Steps")}",
      "estimatedOutput": "${estimatedOutput}"
    }
  ]
}`;

    const memoryText =
      memories.length > 0
        ? memories
            .map(
              (m) =>
                `- [${m.scope.toUpperCase()}] ${m.memory_key}: ${m.content}`
            )
            .join("\n")
        : "- Belum ada memori tersimpan.";

    const userPrompt = `PROYEK: ${projectContext?.name ?? "Tanpa Proyek Khusus"}
DESKRIPSI PROYEK: ${projectContext?.description ?? "-"}
INSTRUKSI SISTEM PROYEK: ${projectContext?.system_instructions ?? "-"}
PERINTAH AWAL PENGGUNA: ${rootCommandTitle || instruction}

MEMORI TERKAIT:
${memoryText}

HASIL LANGKAH SEBELUMNYA:
${priorOutputsText}

TUGAS ANDA (${agentName}):
${instruction}

TARGET OUTPUT:
${estimatedOutput}`;

    const result = await generatePlanWithFallback({
      providers: (providers as DbAiProvider[]) ?? [],
      models: (models as DbAiModel[]) ?? [],
      systemPrompt,
      userPrompt,
      preferredModel,
    });

    const formattedStepsText =
      agentCode === "video"
        ? result.steps
            .map(
              (s) =>
                `=== CLIP #${String(s.stepNumber).padStart(2, "0")} ===\n${
                  s.action
                }`
            )
            .join("\n\n----------------------------------------\n\n")
        : result.steps
            .map(
              (s) =>
                `${s.stepNumber}. [${s.agentName}] ${s.action} (Output: ${s.estimatedOutput})`
            )
            .join("\n\n");

    const outputPayload = {
      summary: result.intentSummary || "Tugas selesai diproses.",
      deliverableType: estimatedOutput,
      contentMarkdown: formattedStepsText || result.intentSummary,
      steps: result.steps,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      agentCode,
      allowedTools: agentSpec.allowedTools,
    };

    const nowIso = new Date().toISOString();

    await supabase.from("usage_logs").insert({
      user_id: user.id,
      project_id: projectContext?.id ?? null,
      provider_key: result.providerUsed,
      model_identifier: result.modelUsed,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost_usd: 0,
    });

    const { data: updatedTask, error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        progress: 100,
        completed_at: nowIso,
        output_payload: outputPayload,
        checkpoint_state: {
          completedAt: nowIso,
          providerUsed: result.providerUsed,
          modelUsed: result.modelUsed,
          agentCode,
          allowedTools: agentSpec.allowedTools,
        },
      })
      .eq("id", taskRow.id)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: updErr.message || "Gagal memperbarui status tugas." },
        { status: 500 }
      );
    }

    // 5. Jika semua task dalam workflow_run sudah completed, tandai run sebagai completed
    if (taskRow.workflow_run_id) {
      const { data: allRunTasks } = await supabase
        .from("tasks")
        .select("id, status")
        .eq("workflow_run_id", taskRow.workflow_run_id);

      const list = (allRunTasks ?? []) as { id: string; status: string }[];
      if (list.length > 0 && list.every((t) => t.status === "completed")) {
        await supabase
          .from("workflow_runs")
          .update({ status: "completed", completed_at: nowIso })
          .eq("id", taskRow.workflow_run_id);
      }
    }

    return NextResponse.json({
      ok: true,
      task: updatedTask,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal mengeksekusi tugas agen.";

    try {
      const supabase = await createSupabaseServerClient();
      if (supabase && resolvedTaskId) {
        await supabase
          .from("tasks")
          .update({ status: "failed", error_message: message })
          .eq("id", resolvedTaskId);
      }
    } catch {
      // Abaikan error saat mencatat status gagal
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
