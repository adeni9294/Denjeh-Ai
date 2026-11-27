import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getWibHourMinute(date = new Date()): {
  hour: number;
  minute: number;
  dateCode: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = parts.find((p) => p.type === "year")?.value ?? "26";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return {
    hour,
    minute,
    dateCode: `${day}${month}${year}`,
  };
}

function getSupabaseAdminClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur."
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

function inferSlotKindFromWibHour(
  hour: number
): "story" | "photo" | "text" | "reels" {
  if (hour < 10) return "story";
  if (hour < 14) return "photo";
  if (hour < 18) return "text";
  return "reels";
}

async function postTextToFacebookPage(params: {
  pageId: string;
  accessToken: string;
  message: string;
}) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(params.pageId)}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: params.message,
        access_token: params.accessToken,
      }),
    }
  );

  const data = (await res.json()) as {
    id?: string;
    post_id?: string;
    error?: { message?: string };
  };

  if (!res.ok || (!data.id && !data.post_id)) {
    throw new Error(data.error?.message || `Facebook HTTP ${res.status}`);
  }

  return data.post_id || data.id || "posted";
}

async function runDailyPublishCron(req: NextRequest) {
  const authHeader = (req.headers.get("authorization") || "").trim();
  const expectedSecret = (process.env.CRON_SECRET || "").trim();

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET missing on server." },
      { status: 401 }
    );
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized cron trigger." },
      { status: 401 }
    );
  }

  try {
    const supabase = getSupabaseAdminClient();
    const wib = getWibHourMinute(new Date());
    const slotKind = inferSlotKindFromWibHour(wib.hour);

    const { data: credRows, error: credErr } = await supabase
      .from("memories")
      .select("user_id, content")
      .eq("scope", "user")
      .eq("memory_key", "fb_page_credentials");

    if (credErr) {
      throw new Error(credErr.message);
    }

    const results: {
      userId: string;
      status: "posted" | "skipped" | "failed";
      detail: string;
    }[] = [];

    for (const row of credRows ?? []) {
      const userId = String(row.user_id || "");
      if (!userId) continue;

      let pageId = "";
      let accessToken = "";
      try {
        const parsed = JSON.parse(String(row.content || "{}")) as {
          pageId?: string;
          accessToken?: string;
        };
        pageId = String(parsed.pageId || "").trim();
        accessToken = String(parsed.accessToken || "").trim();
      } catch {
        results.push({
          userId,
          status: "failed",
          detail: "Format kredensial fb_page_credentials tidak valid.",
        });
        continue;
      }

      if (!pageId || !accessToken) {
        results.push({
          userId,
          status: "skipped",
          detail: "Page ID atau Access Token belum lengkap.",
        });
        continue;
      }

      const { data: candidateTasks } = await supabase
        .from("tasks")
        .select("id, title, output_payload, checkpoint_state")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10);

      const targetTask = (candidateTasks ?? []).find((t) => {
        const cp =
          t.checkpoint_state && typeof t.checkpoint_state === "object"
            ? (t.checkpoint_state as Record<string, unknown>)
            : {};
        return !cp.facebookPostId;
      });

      if (!targetTask) {
        results.push({
          userId,
          status: "skipped",
          detail: `Tidak ada barang jadi baru untuk diposting (${wib.dateCode} ${String(wib.hour).padStart(2, "0")}:${String(wib.minute).padStart(2, "0")} WIB).`,
        });
        continue;
      }

      const cp =
        targetTask.checkpoint_state &&
        typeof targetTask.checkpoint_state === "object"
          ? (targetTask.checkpoint_state as Record<string, unknown>)
          : {};
      const out =
        targetTask.output_payload &&
        typeof targetTask.output_payload === "object"
          ? (targetTask.output_payload as Record<string, unknown>)
          : {};

      const message = String(
        cp.caption || out.contentMarkdown || out.summary || targetTask.title
      ).trim();

      try {
        const postId = await postTextToFacebookPage({
          pageId,
          accessToken,
          message,
        });

        await supabase
          .from("tasks")
          .update({
            checkpoint_state: {
              ...cp,
              facebookPostId: postId,
              publishStatus: "published",
              publishError: null,
              publishedAt: new Date().toISOString(),
              autoScheduledDateCode: wib.dateCode,
              slotKind: String(cp.slotKind || slotKind),
            },
          })
          .eq("id", targetTask.id);

        results.push({
          userId,
          status: "posted",
          detail: `Task ${targetTask.id.slice(0, 8)} terkirim ke FB (ID: ${postId}).`,
        });
      } catch (postErr) {
        const errMessage =
          postErr instanceof Error ? postErr.message : "Gagal posting ke FB.";

        await supabase
          .from("tasks")
          .update({
            checkpoint_state: {
              ...cp,
              publishStatus: "failed",
              publishError: errMessage,
              autoScheduledDateCode: wib.dateCode,
              slotKind: String(cp.slotKind || slotKind),
            },
          })
          .eq("id", targetTask.id);

        results.push({
          userId,
          status: "failed",
          detail: errMessage,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      wib,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron execution failed.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return runDailyPublishCron(req);
}

export async function GET(req: NextRequest) {
  return runDailyPublishCron(req);
}
