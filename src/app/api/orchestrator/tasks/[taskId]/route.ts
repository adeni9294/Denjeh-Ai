import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TaskStatus } from "@/types/studio";

const ALLOWED_STATUSES: TaskStatus[] = [
  "pending",
  "awaiting_approval",
  "running",
  "completed",
  "failed",
  "skipped",
];

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> }
) {
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

    const { taskId } = await context.params;
    const body = (await req.json()) as {
      status?: TaskStatus;
      note?: string;
    };

    if (!body.status || !ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: "Status tugas tidak valid." },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      status: body.status,
    };

    if (body.status === "running") {
      updateData.started_at = nowIso;
    }
    if (body.status === "completed" || body.status === "failed") {
      updateData.completed_at = nowIso;
    }
    if (body.note) {
      updateData.output_payload = {
        approvalNote: body.note,
        updatedAt: nowIso,
      };
    }

    const { data: updatedTask, error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", taskId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !updatedTask) {
      return NextResponse.json(
        { error: error?.message || "Gagal memperbarui status tugas." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      task: updatedTask,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat memperbarui tugas.",
      },
      { status: 500 }
    );
  }
}
