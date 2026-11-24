import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generatePlanWithFallback } from "@/lib/ai/cloud-runner";
import {
  buildAgentToolInstructionBlock,
  getAgentSpec,
} from "@/lib/ai/agent-tools";
import { DbAiModel, DbAiProvider, DbMemory, DbProject } from "@/types/studio";

export async function POST(
  _req: NextRequest,
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
        .or(
          `project_id.eq.${taskRow.project_id},and(scope.eq.user,project_id.is.null)`
        )
        .order("importance", { ascending: false })
        .limit(20);
      memories = (memRows as DbMemory[]) ?? [];
    }

    // 3. Ambil output langkah sebelumnya dalam workflow_run yang sama
    let priorOutputsText = "- Tidak ada output langkah sebelumnya.";
    if (taskRow.workflow_run_id) {
      const { data: siblingTasks } = await supabase
        .from("tasks")
        .select("id, title, status, input_payload, output_payload")
        .eq("workflow_run_id", taskRow.workflow_run_id)
        .eq("user_id", user.id);

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
              out.summary || out.contentMarkdown || ""
            ).slice(0, 500)}`;
          })
          .join("\n");
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
    );
    const agentSpec = getAgentSpec(agentCode);
    const agentName = String(payload.agentName || agentSpec.name);
    const instruction = String(payload.instruction || taskRow.title || "");
    const estimatedOutput = String(
      payload.estimatedOutput || "Artefak Kreatif Terstruktur"
    );
    const toolInstructionBlock = buildAgentToolInstructionBlock(agentCode);

    const systemPrompt = `Anda adalah ${agentName} dalam sistem DENJEH AI.
Hasilkan keluaran nyata, detail, dan siap pakai sesuai tugas agen Anda dalam format JSON murni.

${toolInstructionBlock}

WAJIB kembalikan JSON valid dengan skema persis seperti ini (bahasa Indonesia):
{
  "intentSummary": "Ringkasan hasil kerja agen secara jelas dalam bahasa Indonesia",
  "recommendedMode": "manual",
  "steps": [
    {
      "stepNumber": 1,
      "agentCode": "${agentCode}",
      "agentName": "${agentName}",
      "action": "Isi detail / konten siap pakai dari hasil kerja agen ini",
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
    });

    const formattedStepsText = result.steps
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
