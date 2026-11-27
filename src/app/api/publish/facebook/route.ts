import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PublishChannelType = "reels" | "photo" | "text";
type PublishTargetType = "story" | "feed";
type PublishActionType = "publish" | "save_credentials" | "clear_credentials";

interface FacebookPublishRequest {
  action?: PublishActionType;
  projectId?: string | null;
  taskId?: string | null;
  pageId?: string;
  accessToken?: string;
  publishType?: PublishChannelType | "story_photo" | "story_video";
  publishTarget?: PublishTargetType;
  slotKind?: "story" | "photo" | "text" | "reels";
  caption?: string;
  videoUrl?: string;
  photoUrl?: string;
  saveCredentials?: boolean;
}

const GRAPH_API_VERSION = "v21.0";

function isValidHttpUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.includes("...")) return false;
  return /^https?:\/\/[^\s]+$/i.test(value);
}

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

async function publishVideoStoryToPage(params: {
  pageId: string;
  accessToken: string;
  videoUrl: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { pageId, accessToken, videoUrl } = params;
  const storyEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    pageId
  )}/video_stories`;

  const startParams = new URLSearchParams();
  startParams.set("access_token", accessToken);
  startParams.set("upload_phase", "start");

  const startRes = await fetch(storyEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: startParams.toString(),
  });

  const startData = (await startRes.json()) as {
    video_id?: string;
    upload_url?: string;
    error?: { message?: string };
  };

  if (!startRes.ok || startData.error || !startData.video_id || !startData.upload_url) {
    return {
      ok: false,
      error:
        startData.error?.message ||
        "Gagal memulai sesi unggah Video Story ke Facebook Page.",
    };
  }

  const videoFileRes = await fetch(videoUrl);
  if (!videoFileRes.ok) {
    return {
      ok: false,
      error: `Gagal mengunduh file video Story dari URL (HTTP ${videoFileRes.status}).`,
    };
  }

  const videoBuffer = await videoFileRes.arrayBuffer();
  const uploadRes = await fetch(startData.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(videoBuffer.byteLength),
      "Content-Type": "application/octet-stream",
    },
    body: videoBuffer,
  });

  const uploadData = (await uploadRes.json().catch(() => ({}))) as {
    error?: { message?: string };
  };

  if (!uploadRes.ok || uploadData.error) {
    return {
      ok: false,
      error:
        uploadData.error?.message ||
        "Gagal mengunggah binary video Story ke Facebook Page.",
    };
  }

  const finishParams = new URLSearchParams();
  finishParams.set("access_token", accessToken);
  finishParams.set("upload_phase", "finish");
  finishParams.set("video_id", startData.video_id);

  const finishRes = await fetch(storyEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: finishParams.toString(),
  });

  const finishData = (await finishRes.json()) as {
    id?: string;
    post_id?: string;
    success?: boolean;
    error?: { message?: string };
  };

  if (!finishRes.ok || finishData.error) {
    return {
      ok: false,
      error:
        finishData.error?.message ||
        "Gagal menyelesaikan publikasi Video Story ke Facebook Page.",
    };
  }

  return {
    ok: true,
    id: finishData.post_id || finishData.id || startData.video_id,
  };
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

    const rawPublishType = String(body.publishType ?? "").toLowerCase().trim();
    const rawSlotKind = String(body.slotKind ?? "").toLowerCase().trim();
    const rawTarget = String(body.publishTarget ?? "").toLowerCase().trim();

    const isStoryTarget =
      rawTarget === "story" ||
      rawSlotKind === "story" ||
      rawPublishType === "story_photo" ||
      rawPublishType === "story_video";

    const publishType: PublishChannelType =
      rawPublishType === "reels" || rawPublishType === "story_video"
        ? "reels"
        : rawPublishType === "photo" || rawPublishType === "story_photo"
        ? "photo"
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

    // Proteksi khusus target Story: dilarang keras jatuh ke /feed atau /photos publik
    if (isStoryTarget) {
      const storyMediaUrl = videoUrl || photoUrl;
      const isVideoStory =
        rawPublishType === "story_video" ||
        publishType === "reels" ||
        /\.mp4(\?|$)/i.test(storyMediaUrl);

      if (!isValidHttpUrl(storyMediaUrl)) {
        const msg =
          "Publikasi Story diblokir: URL media gambar/video yang valid wajib ada agar Story tidak salah terkirim ke feed publik.";
        if (body.taskId) {
          await updateTaskPublishCheckpoint({
            supabase,
            taskId: body.taskId,
            userId: user.id,
            patch: {
              publishStatus: "failed",
              publishError: msg,
              publishTarget: "story",
              slotKind: "story",
            },
          });
        }
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      if (isVideoStory) {
        const vidResult = await publishVideoStoryToPage({
          pageId,
          accessToken,
          videoUrl: storyMediaUrl,
        });

        if (!vidResult.ok) {
          const errMsg = vidResult.error || "Gagal mempublikasikan Video Story.";
          if (body.taskId) {
            await updateTaskPublishCheckpoint({
              supabase,
              taskId: body.taskId,
              userId: user.id,
              patch: {
                publishStatus: "failed",
                publishError: errMsg,
                publishTarget: "story",
                slotKind: "story",
              },
            });
          }
          return NextResponse.json({ error: errMsg }, { status: 400 });
        }

        const publishedAtIso = new Date().toISOString();
        const publishedPostId = vidResult.id || "story_video_published";

        if (body.taskId) {
          await updateTaskPublishCheckpoint({
            supabase,
            taskId: body.taskId,
            userId: user.id,
            patch: {
              publishedAt: publishedAtIso,
              facebookPublishedAt: publishedAtIso,
              facebookPostId: publishedPostId,
              facebookPublishType: "story_video",
              publishTarget: "story",
              slotKind: "story",
              publishStatus: "published",
              publishError: null,
            },
          });
        }

        return NextResponse.json({
          ok: true,
          postId: publishedPostId,
          publishTarget: "story",
          publishType: "story_video",
          publishedAt: publishedAtIso,
        });
      }

      const photoStoryEndpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        pageId
      )}/photo_stories`;
      const photoStoryParams = new URLSearchParams();
      photoStoryParams.set("access_token", accessToken);
      photoStoryParams.set("url", storyMediaUrl);

      const storyRes = await fetch(photoStoryEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: photoStoryParams.toString(),
      });

      const storyData = (await storyRes.json()) as {
        id?: string;
        post_id?: string;
        error?: { message?: string };
      };

      if (!storyRes.ok || storyData.error) {
        const errMsg =
          storyData.error?.message ||
          `Facebook Photo Story API gagal merespons (HTTP ${storyRes.status}).`;

        if (body.taskId) {
          await updateTaskPublishCheckpoint({
            supabase,
            taskId: body.taskId,
            userId: user.id,
            patch: {
              publishStatus: "failed",
              publishError: errMsg,
              publishTarget: "story",
              slotKind: "story",
            },
          });
        }

        return NextResponse.json({ error: errMsg }, { status: 400 });
      }

      const publishedPostId =
        storyData.post_id || storyData.id || "story_photo_published";
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
            facebookPublishType: "story_photo",
            publishTarget: "story",
            slotKind: "story",
            publishStatus: "published",
            publishError: null,
          },
        });
      }

      return NextResponse.json({
        ok: true,
        postId: publishedPostId,
        publishTarget: "story",
        publishType: "story_photo",
        publishedAt: publishedAtIso,
      });
    }

    // Jalur Feed / Reels publik (bukan Story)
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
            publishTarget: "feed",
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
          publishTarget: "feed",
          publishStatus: "published",
          publishError: null,
          ...(body.slotKind ? { slotKind: body.slotKind } : {}),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      postId: publishedPostId,
      publishTarget: "feed",
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
