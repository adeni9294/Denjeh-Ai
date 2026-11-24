import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PublishChannelType = "reels" | "photo" | "text";

interface FacebookPublishRequest {
  projectId?: string | null;
  taskId?: string | null;
  pageId?: string;
  accessToken?: string;
  publishType?: PublishChannelType;
  caption?: string;
  videoUrl?: string;
  photoUrl?: string;
  saveCredentials?: boolean;
}

const GRAPH_API_VERSION = "v21.0";

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
    const publishType: PublishChannelType =
      body.publishType === "reels" || body.publishType === "photo"
        ? body.publishType
        : "text";
    const caption = (body.caption ?? "").trim();
    const videoUrl = (body.videoUrl ?? "").trim();
    const photoUrl = (body.photoUrl ?? "").trim();

    let pageId = (body.pageId ?? "").trim();
    let accessToken = (body.accessToken ?? "").trim();

    // Ambil kredensial tersimpan dari memories jika input kosong
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

    // Simpan kredensial jika diminta
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
      return NextResponse.json(
        {
          error:
            fbData.error?.message ||
            `Facebook Graph API gagal merespons (HTTP ${fbRes.status}).`,
        },
        { status: 400 }
      );
    }

    const publishedPostId = fbData.post_id || fbData.id || "published";

    // Catat riwayat rilis di checkpoint_state task bila taskId disertakan
    if (body.taskId) {
      const { data: existingTask } = await supabase
        .from("tasks")
        .select("checkpoint_state")
        .eq("id", body.taskId)
        .eq("user_id", user.id)
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
            facebookPublishedAt: new Date().toISOString(),
            facebookPostId: publishedPostId,
            facebookPublishType: publishType,
          },
        })
        .eq("id", body.taskId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      ok: true,
      postId: publishedPostId,
      publishType,
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
