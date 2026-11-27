import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PublishChannelType = "reels" | "photo" | "text";
type PublishActionType = "publish" | "save_credentials" | "clear_credentials";

interface FacebookPublishRequest {
  action?: PublishActionType;
  projectId?: string | null;
  taskId?: string | null;
  pageId?: string;
  accessToken?: string;
  publishType?: PublishChannelType;
  slotKind?: "story" | "photo" | "text" | "reels";
  caption?: string;
  videoUrl?: string;
  photoUrl?: string;
  saveCredentials?: boolean;
}

const GRAPH_API_VERSION = "v21.0";

async function updateTaskPublishCheckpoint(params: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  taskId: string;
  userId: string;
  patch: Record<string, unknown>;
}) {
  const { supabase, taskId, userId, patch } = params;
  const { data: existingTask } = await supabase
    .from("tasks")
    .select("checkpoint_state")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  const prevCheckpoint =
    existingTask?.checkpoint_state &&
    typeof existingTask.checkpoint_state === "object"
      ? (existingTask.checkpoint_state as Record<string, unknown>)
      : {};

  await supabase
    .from("tasks")
    .update({
      checkpoint_state: {
        ...prevCheckpoint,
        ...patch,
      },
    })
    .eq("id", taskId)
    .eq("user_id", userId);
}

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

    const body = (await req.json()) as FacebookPublishRequest;
    const action: PublishActionType = body.action ?? "publish";

    // Aksi khusus: hapus kredensial tersimpan
    if (action === "clear_credentials") {
      await supabase
        .from("memories")
        .delete()
        .eq("user_id", user.id)
        .eq("scope", "user")
        .eq("memory_key", "fb_page_credentials");

      return NextResponse.json({
        ok: true,
        message: "Kredensial Facebook Page dihapus.",
      });
    }

    // Aksi khusus: simpan kredensial saja
    if (action === "save_credentials") {
      const pageIdToSave = (body.pageId ?? "").trim();
      let tokenToSave = (body.accessToken ?? "").trim();

      if (!pageIdToSave) {
        return NextResponse.json(
          { error: "Facebook Page ID wajib diisi." },
          { status: 400 }
        );
      }

      if (!tokenToSave) {
        const { data: existingCred } = await supabase
          .from("memories")
          .select("content")
          .eq("user_id", user.id)
          .eq("scope", "user")
          .eq("memory_key", "fb_page_credentials")
          .maybeSingle();

        if (existingCred?.content) {
          try {
            const parsed = JSON.parse(String(existingCred.content)) as {
              accessToken?: string;
            };
            if (parsed.accessToken) tokenToSave = parsed.accessToken.trim();
          } catch {
            // Abaikan JSON tidak valid
          }
        }
      }

      if (!tokenToSave) {
        return NextResponse.json(
          { error: "Page Access Token wajib diisi." },
          { status: 400 }
        );
      }

      const payloadJson = JSON.stringify({
        pageId: pageIdToSave,
        accessToken: tokenToSave,
      });

      const { data: existingRow } = await supabase
        .from("memories")
        .select("id")
        .eq("user_id", user.id)
        .eq("scope", "user")
        .eq("memory_key", "fb_page_credentials")
        .maybeSingle();

      if (existingRow?.id) {
        await supabase
          .from("memories")
          .update({ content: payloadJson, importance: 9 })
          .eq("id", existingRow.id);
      } else {
        await supabase.from("memories").insert({
          user_id: user.id,
          project_id: null,
          scope: "user",
          memory_key: "fb_page_credentials",
          content: payloadJson,
          importance: 9,
        });
      }

      return NextResponse.json({
        ok: true,
        message: "Facebook Page ID & Access Token berhasil disimpan.",
      });
    }

    const publishType: PublishChannelType =
      body.publishType === "reels" || body.publishType === "photo"
        ? body.publishType
        : "text";
    const caption = (body.caption ?? "").trim();
    const videoUrl = (body.videoUrl ?? "").trim();
    const photoUrl = (body.photoUrl ?? "").trim();

    let pageId = (body.pageId ?? "").trim();
    let accessToken = (body.accessToken ?? "").trim();

    if (!pageId || !accessToken) {
      const { data: credRow } = await supabase
        .from("memories")
        .select("content")
        .eq("user_id", user.id)
        .eq("scope", "user")
        .eq("memory_key", "fb_page_credentials")
        .maybeSingle();

      if (credRow?.content) {
        try {
          const parsed = JSON.parse(String(credRow.content)) as {
            pageId?: string;
            accessToken?: string;
          };
          if (!pageId && parsed.pageId) pageId = parsed.pageId.trim();
          if (!accessToken && parsed.accessToken) {
            accessToken = parsed.accessToken.trim();
          }
        } catch {
          // Abaikan JSON tidak valid
        }
      }
    }

    if (!pageId || !accessToken) {
      return NextResponse.json(
        {
          error:
            "Facebook Page ID dan Page Access Token wajib diisi atau disimpan terlebih dahulu.",
        },
        { status: 400 }
      );
    }

    if (body.saveCredentials) {
      const payloadJson = JSON.stringify({ pageId, accessToken });
      const { data: existingCred } = await supabase
        .from("memories")
        .select("id")
        .eq("user_id", user.id)
        .eq("scope", "user")
        .eq("memory_key", "fb_page_credentials")
        .maybeSingle();

      if (existingCred?.id) {
        await supabase
          .from("memories")
          .update({ content: payloadJson, importance: 9 })
          .eq("id", existingCred.id);
      } else {
        await supabase.from("memories").insert({
          user_id: user.id,
          project_id: null,
          scope: "user",
          memory_key: "fb_page_credentials",
          content: payloadJson,
          importance: 9,
        });
      }
    }

    let graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
      pageId
    )}/feed`;
    const formBody = new URLSearchParams();
    formBody.set("access_token", accessToken);

    if (publishType === "reels") {
      if (!videoUrl) {
        return NextResponse.json(
          {
            error:
              "URL Video MP4 wajib diisi untuk mempublikasikan Video Reels ke Facebook Page.",
          },
          { status: 400 }
        );
      }
      graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        pageId
      )}/videos`;
      formBody.set("file_url", videoUrl);
      if (caption) {
        formBody.set("description", caption);
      }
    } else if (publishType === "photo") {
      if (!photoUrl) {
        return NextResponse.json(
          {
            error:
              "URL Foto wajib diisi untuk mempublikasikan Foto ke Facebook Page.",
          },
          { status: 400 }
        );
      }
      graphEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        pageId
      )}/photos`;
      formBody.set("url", photoUrl);
      if (caption) {
        formBody.set("caption", caption);
      }
    } else {
      if (!caption) {
        return NextResponse.json(
          { error: "Teks caption tidak boleh kosong." },
          { status: 400 }
        );
      }
      formBody.set("message", caption);
    }

    const fbRes = await fetch(graphEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });

    const fbData = (await fbRes.json()) as {
      id?: string;
      post_id?: string;
      error?: { message?: string; code?: number };
    };

    if (!fbRes.ok || fbData.error) {
      const fbErrorMessage =
        fbData.error?.message ||
        `Facebook Graph API gagal merespons (HTTP ${fbRes.status}).`;

      if (body.taskId) {
        await updateTaskPublishCheckpoint({
          supabase,
          taskId: body.taskId,
          userId: user.id,
          patch: {
            publishStatus: "failed",
            publishError: fbErrorMessage,
            facebookPublishType: publishType,
          },
        });
      }

      return NextResponse.json(
        {
          error: fbErrorMessage,
        },
        { status: 400 }
      );
    }

    const publishedPostId = fbData.post_id || fbData.id || "published";
    const publishedAtIso = new Date().toISOString();

    if (body.taskId) {
      await updateTaskPublishCheckpoint({
        supabase,
        taskId: body.taskId,
        userId: user.id,
        patch: {
          publishedAt: publishedAtIso,
          facebookPublishedAt: publishedAtIso,
          facebookPostId: publishedPostId,
          facebookPublishType: publishType,
          publishStatus: "published",
          publishError: null,
          ...(body.slotKind ? { slotKind: body.slotKind } : {}),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      postId: publishedPostId,
      publishType,
      publishedAt: publishedAtIso,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat mempublikasikan ke Facebook Page.",
      },
      { status: 500 }
    );
  }
}
