import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GeneratedPlanStep } from "@/lib/ai/cloud-runner";
import { TaskStatus } from "@/types/studio";

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
      projectId?: string | null;
      title?: string;
      mode?: "manual" | "autonomous";
      steps?: GeneratedPlanStep[];
      providerUsed?: string;
      modelUsed?: string;
    };

    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (steps.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada langkah rencana untuk disimpan." },
        { status: 400 }
      );
    }

    const mode = body.mode === "autonomous" ? "autonomous" : "manual";
    const runStatus = mode === "autonomous" ? "running" : "waiting_approval";

    const { data: runRow, error: runErr } = await supabase
      .from("workflow_runs")
      .insert({
        user_id: user.id,
        project_id: body.projectId || null,
        workflow_id: null,
        title: (body.title || "Rencana Orkestrasi Multi-Agen").slice(0, 140),
        trigger_mode: mode,
        status: runStatus,
        current_step: 1,
        total_steps: steps.length,
        context_snapshot: {
          providerUsed: body.providerUsed ?? "gemini",
          modelUsed: body.modelUsed ?? "default",
        },
      })
      .select()
      .single();

    if (runErr || !runRow) {
      return NextResponse.json(
        { error: runErr?.message || "Gagal membuat workflow run." },
        { status: 500 }
      );
    }

    const taskInserts = steps.map((step, idx) => {
      const initialStatus: TaskStatus =
        mode === "autonomous" && idx === 0 ? "running" : "awaiting_approval";

      return {
        workflow_run_id: runRow.id,
        user_id: user.id,
        project_id: body.projectId || null,
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
        },
        output_payload: {},
      };
    });

    const { data: createdTasks, error: taskErr } = await supabase
      .from("tasks")
      .insert(taskInserts)
      .select()
      .order("step_order", { ascending: true });

    if (taskErr) {
      return NextResponse.json(
        { error: taskErr.message || "Gagal menyimpan daftar tugas ke database." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      run: runRow,
      tasks: createdTasks ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat menyimpan rencana orkestrasi.",
      },
      { status: 500 }
    );
  }
}
