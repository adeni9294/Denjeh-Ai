import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PublishChannelType = "reels" | "photo" | "text";

interface RenderCallbackBody {
  secret?: string;
  taskId?: string;
  userId?: string;
  videoUrl?: string;
  photoUrl?: string;
  caption?: string;
  publishType?: PublishChannelType;
  autoPublish?: boolean;
}

const GRAPH_API_VERSION = "v21.0";

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceKey);
}

export async function POST(req: NextRequest) {
  try {
    const webhookSecret = (process.env.RENDER_WEBHOOK_SECRET ?? "").trim();
    const headerSecret = (req.headers.get("x-render-secret") ?? "").trim();

    const body = (await req.json()) as RenderCallbackBody;
    const providedSecret = (body.secret ?? headerSecret).trim();

    if (!webhookSecret || providedSecret !== webhookSecret) {
      return NextResponse.json(
        { error: "Unauthorized: secret webhook tidak valid atau belum diatur." },
        { status: 401 }
      );
    }

    const taskId = (body.taskId ?? "").trim();
    if (!taskId) {
      return NextResponse.json(
        { error: "taskId wajib disertakan pada payload callback." },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Konfigurasi Supabase di server belum lengkap." },
        { status: 500 }
      );
    }

    const { data: taskRow, error: taskErr } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (taskErr || !taskRow) {
      return NextResponse.json(
        { error: "Tugas tidak ditemukan." },
        { status: 404 }
      );
    }

    const prevCheckpoint =
      taskRow.checkpoint_state && typeof taskRow.checkpoint_state === "object"
        ? (taskRow.checkpoint_state as Record<string, unknown>)
        : {};

    const outPayload =
      taskRow.output_payload && typeof taskRow.output_payload === "object"
        ? (taskRow.output_payload as Record<string, unknown>)
        : {};

    const videoUrl =
      (body.videoUrl ?? "").trim() || String(prevCheckpoint.videoUrl ?? "").trim();
    const photoUrl =
      (body.photoUrl ?? "").trim() || String(prevCheckpoint.photoUrl ?? "").trim();
    const caption =
      (body.caption ?? "").trim() ||
      String(prevCheckpoint.caption ?? "").trim() ||
      String(outPayload.contentMarkdown || outPayload.summary || taskRow.title).trim();

    const publishType: PublishChannelType =
      body.publishType === "reels" ||
      body.publishType === "photo" ||
      body.publishType === "text"
        ? body.publishType
        : videoUrl
        ? "reels"
        : photoUrl
        ? "photo"
        : "text";

    const shouldAutoPublish =
      typeof body.autoPublish === "boolean"
        ? body.autoPublish
        : Boolean(prevCheckpoint.autoPublishFacebook);

    const nowIso = new Date().toISOString();

    const nextCheckpoint: Record<string, unknown> = {
      ...prevCheckpoint,
      renderStatus: "completed",
      renderedAt: nowIso,
      videoUrl,
      photoUrl,
      caption,
      publishType,
      autoPublishFacebook: shouldAutoPublish,
    };

    let facebookPostId: string | null = null;
    let facebookError: string | null = null;

    if (shouldAutoPublish) {
      const { data: credRow } = await supabase
        .from("memories")
        .select("content")
        .eq("user_id", taskRow.user_id)
        .eq("scope", "user")
        .eq("memory_key", "fb_page_credentials")
        .maybeSingle();

      let pageId = "";
      let accessToken = "";

      if (credRow?.content) {
        try {
          const parsed = JSON.parse(String(credRow.content)) as {
            pageId?: string;
            accessToken?: string;
          };
          pageId = (parsed.pageId ?? "").trim();
          accessToken = (parsed.accessToken ?? "").trim();
        } catch {
          facebookError = "Format kredensial Facebook Page di memories tidak valid.";
        }
      }

      if (!pageId || !accessToken) {
        facebookError =
          "Kredensial Facebook Page ID / Access Token belum tersimpan.";
      } else {
        let graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
          pageId
        )}/feed`;
        const formBody = new URLSearchParams();
        formBody.set("access_token", accessToken);

        if (publishType === "reels") {
          if (!videoUrl) {
            facebookError = "videoUrl kosong untuk publikasi Video Reels.";
          } else {
            graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
              pageId
            )}/videos`;
            formBody.set("file_url", videoUrl);
            if (caption) formBody.set("description", caption);
          }
        } else if (publishType === "photo") {
          if (!photoUrl) {
            facebookError = "photoUrl kosong untuk publikasi Foto.";
          } else {
            graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
              pageId
            )}/photos`;
            formBody.set("url", photoUrl);
            if (caption) formBody.set("caption", caption);
          }
        } else {
          if (!caption) {
            facebookError = "caption kosong untuk publikasi Teks.";
          } else {
            formBody.set("message", caption);
          }
        }

        if (!facebookError) {
          const fbRes = await fetch(graphEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody.toString(),
          });

          const fbData = (await fbRes.json()) as {
            id?: string;
            post_id?: string;
            error?: { message?: string };
          };

          if (!fbRes.ok || fbData.error) {
            facebookError =
              fbData.error?.message ||
              `Facebook Graph API gagal (HTTP ${fbRes.status}).`;
          } else {
            facebookPostId = fbData.post_id || fbData.id || "published";
            nextCheckpoint.facebookPostId = facebookPostId;
            nextCheckpoint.facebookPublishedAt = nowIso;
            nextCheckpoint.facebookPublishType = publishType;
            nextCheckpoint.facebookPublishError = null;
          }
        }
      }

      if (facebookError) {
        nextCheckpoint.facebookPublishError = facebookError;
      }
    }

    const { error: updErr } = await supabase
      .from("tasks")
      .update({ checkpoint_state: nextCheckpoint })
      .eq("id", taskRow.id);

    if (updErr) {
      return NextResponse.json(
        { error: updErr.message || "Gagal memperbarui checkpoint_state tugas." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      taskId: taskRow.id,
      renderStatus: "completed",
      autoPublished: Boolean(facebookPostId),
      facebookPostId,
      facebookError,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat memproses callback render.",
      },
      { status: 500 }
    );
  }
}
