import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGeminiKey } from "@/lib/getEnv";
import { DbAiProvider } from "@/types/studio";

export type ContentDivision = "text" | "photo" | "reels" | "story";
export type PublishMode = "immediate" | "scheduled" | "draft";
export type DivisionContentType =
  | "motivation"
  | "quote"
  | "tutorial"
  | "free_photo"
  | "action_reels"
  | "story_teaser";

export interface OrchestratorPlanItem {
  division: ContentDivision;
  divisionLabel: string;
  title: string;
  brief: string;
  contentType: DivisionContentType;
  publishMode: PublishMode;
  scheduledAt: string | null;
  scheduledLabelWib: string;
}

export interface OrchestratorPlan {
  commandSummary: string;
  defaultPublishMode: PublishMode;
  items: OrchestratorPlanItem[];
}

interface PlanRequestBody {
  command?: string;
  nowIso?: string;
}

const DIVISION_LABELS: Record<ContentDivision, string> = {
  text: "Divisi Konten Teks",
  photo: "Divisi Konten Foto",
  story: "Divisi Konten Story",
  reels: "Divisi Konten Reels",
};

// Jam rilis default WIB (UTC+7): Teks 09:30, Foto 13:00, Story 16:30, Reels 19:30
const DEFAULT_SLOTS_WIB: Record<
  ContentDivision,
  { hour: number; minute: number }
> = {
  text: { hour: 9, minute: 30 },
  photo: { hour: 13, minute: 0 },
  story: { hour: 16, minute: 30 },
  reels: { hour: 19, minute: 30 },
};

function decodeStoredKey(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  const trimmed = encoded.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("enc_v1:")) {
    try {
      return Buffer.from(trimmed.slice(7), "base64").toString("utf-8").trim();
    } catch {
      return null;
    }
  }
  return trimmed;
}

async function resolveGeminiKey(
  providers: DbAiProvider[]
): Promise<string> {
  const fromEnv = await getGeminiKey();
  if (fromEnv) return fromEnv;

  for (const p of providers) {
    const row = p as unknown as Record<string, unknown>;
    const pKey = String(
      row.provider_key ?? row.provider_name ?? row.name ?? ""
    ).toLowerCase();
    const isGemini =
      pKey.includes("gemini") ||
      pKey.includes("google") ||
      String(row.base_url ?? "").includes("generativelanguage.googleapis.com");
    if (!isGemini) continue;

    const decoded = decodeStoredKey(
      String(row.encrypted_api_key ?? row.api_key ?? "")
    );
    if (decoded) return decoded;
  }

  return "";
}

function detectPublishModeFromCommand(command: string): PublishMode {
  const lower = command.toLowerCase();
  if (
    /\b(draft|draf|konsep|jangan posting|tahan|review dulu|simpan dulu)\b/.test(
      lower
    )
  ) {
    return "draft";
  }
  if (
    /\b(sekarang|langsung posting|langsung publish|rilis sekarang|tayang sekarang|segera)\b/.test(
      lower
    )
  ) {
    return "immediate";
  }
  return "scheduled";
}

function detectTargetDivisions(command: string): ContentDivision[] {
  const lower = command.toLowerCase();
  const explicit: ContentDivision[] = [];

  if (/\b(teks|text|motivasi|quote|quotes|tutorial|caption)\b/.test(lower)) {
    explicit.push("text");
  }
  if (/\b(foto|photo|gambar|poster|visual)\b/.test(lower)) {
    explicit.push("photo");
  }
  if (/\b(story|stories|teaser)\b/.test(lower)) {
    explicit.push("story");
  }
  if (/\b(reels|reel|video|action|film)\b/.test(lower)) {
    explicit.push("reels");
  }

  if (explicit.length > 0) {
    return explicit;
  }

  return ["text", "photo", "story", "reels"];
}

function computeSlotDateWib(
  division: ContentDivision,
  baseNow: Date,
  customHour?: number | null,
  customMinute?: number | null,
  dayOffset = 0
): Date {
  // Geser ke zona waktu WIB (UTC+7)
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const wibNow = new Date(baseNow.getTime() + wibOffsetMs);

  const slot = DEFAULT_SLOTS_WIB[division];
  const targetHour =
    typeof customHour === "number" && customHour >= 0 && customHour <= 23
      ? customHour
      : slot.hour;
  const targetMinute =
    typeof customMinute === "number" && customMinute >= 0 && customMinute <= 59
      ? customMinute
      : slot.minute;

  const candidateWib = new Date(
    Date.UTC(
      wibNow.getUTCFullYear(),
      wibNow.getUTCMonth(),
      wibNow.getUTCDate() + dayOffset,
      targetHour,
      targetMinute,
      0,
      0
    )
  );

  // Jika slot hari ini sudah terlewat (> 2 menit lalu) dan tidak pakai dayOffset, dorong ke besok
  if (dayOffset === 0 && candidateWib.getTime() <= wibNow.getTime() + 120_000) {
    candidateWib.setUTCDate(candidateWib.getUTCDate() + 1);
  }

  return new Date(candidateWib.getTime() - wibOffsetMs);
}

function formatWibLabel(isoString: string | null, mode: PublishMode): string {
  if (mode === "draft" || !isoString) {
    return "Ditahan sebagai Draf (Belum Dijadwalkan)";
  }
  if (mode === "immediate") {
    return "Langsung Tayang Sekarang";
  }

  const date = new Date(isoString);
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const min = String(wib.getUTCMinutes()).padStart(2, "0");
  return `Terjadwal ${dd}/${mm} pukul ${hh}:${min} WIB`;
}

function buildFallbackPlan(command: string, baseNow: Date): OrchestratorPlan {
  const mode = detectPublishModeFromCommand(command);
  const divisions = detectTargetDivisions(command);
  const isTomorrow = /\b(besok|tomorrow)\b/i.test(command);
  const dayOffset = isTomorrow ? 1 : 0;

  const defaultsByDivision: Record<
    ContentDivision,
    {
      title: string;
      brief: string;
      contentType: DivisionContentType;
    }
  > = {
    text: {
      title: "Konten Teks Harian (Motivasi / Quotes / Tutorial)",
      brief: `Susun konten teks Facebook Page yang tajam dan mudah dibaca (motivasi, kutipan, atau tutorial praktis) berdasarkan arahan Owner: "${command}".`,
      contentType: "motivation",
    },
    photo: {
      title: "Konten Foto Visual (Eksplorasi Bebas)",
      brief: `Buat konsep visual sinematik bebas gaya untuk di-generate dan disimpan ke bucket dnaverse-media sesuai arahan Owner: "${command}".`,
      contentType: "free_photo",
    },
    story: {
      title: "Konten Story Vertikal (Teaser / Snapshot)",
      brief: `Siapkan materi vertikal singkat dan menarik perhatian untuk Facebook Story sebagai penguat interaksi harian dari arahan: "${command}".`,
      contentType: "story_teaser",
    },
    reels: {
      title: "Konten Reels Video (Film Action)",
      brief: `Rancang skenario dan prompt adegan film action berdurasi pendek dengan tempo cepat, kamera dinamis, dan hook kuat dari arahan: "${command}".`,
      contentType: "action_reels",
    },
  };

  const items: OrchestratorPlanItem[] = divisions.map((division) => {
    const meta = defaultsByDivision[division];
    let scheduledAt: string | null = null;

    if (mode === "immediate") {
      scheduledAt = baseNow.toISOString();
    } else if (mode === "scheduled") {
      scheduledAt = computeSlotDateWib(
        division,
        baseNow,
        null,
        null,
        dayOffset
      ).toISOString();
    }

    return {
      division,
      divisionLabel: DIVISION_LABELS[division],
      title: meta.title,
      brief: meta.brief,
      contentType: meta.contentType,
      publishMode: mode,
      scheduledAt,
      scheduledLabelWib: formatWibLabel(scheduledAt, mode),
    };
  });

  return {
    commandSummary: `Perintah Owner diproses untuk ${divisions.length} divisi (${mode}).`,
    defaultPublishMode: mode,
    items,
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Konfigurasi Supabase server belum lengkap." },
        { status: 500 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Sesi tidak valid. Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    let body: PlanRequestBody = {};
    try {
      body = (await req.json()) as PlanRequestBody;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Format JSON permintaan tidak valid." },
        { status: 400 }
      );
    }

    const command = (body.command ?? "").trim();
    if (!command) {
      return NextResponse.json(
        { ok: false, error: "Perintah untuk Orchestrator tidak boleh kosong." },
        { status: 400 }
      );
    }

    const baseNow = body.nowIso ? new Date(body.nowIso) : new Date();
    const safeNow = Number.isNaN(baseNow.getTime()) ? new Date() : baseNow;

    const { data: providers } = await supabase
      .from("ai_providers")
      .select("*")
      .eq("is_enabled", true)
      .order("priority_order", { ascending: true });

    const apiKey = await resolveGeminiKey((providers as DbAiProvider[]) ?? []);
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        source: "rule-based",
        plan: buildFallbackPlan(command, safeNow),
      });
    }

    const textModels = [
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
    ];

    const systemPrompt = `Kamu adalah Manager (Orchestrator) di studio konten DENJEH AI.
Tugasmu menerima satu perintah dari Owner dan membaginya ke divisi yang relevan:
- "text": Divisi Konten Teks (FOKUS HANYA pada motivasi, quotes, atau tutorial singkat).
- "photo": Divisi Konten Foto (bebas eksplorasi visual/gaya gambar, disimpan ke bucket dnaverse-media).
- "story": Divisi Konten Story (teaser vertikal ringan/cepat untuk Facebook Story).
- "reels": Divisi Konten Reels (FOKUS pada video pendek genre film action dengan tempo cepat & kamera dinamis).

Tentukan juga niat waktu rilis dari perintah Owner:
- "immediate": jika Owner meminta langsung posting/rilis sekarang.
- "draft": jika Owner meminta konsep/draf saja tanpa rilis.
- "scheduled": default jika Owner meminta dibuatkan konten harian/terjadwal.

Balas HANYA JSON valid (tanpa markdown \`\`\`) dengan struktur persis:
{
  "commandSummary": "ringkasan singkat keputusan manager dalam bahasa Indonesia",
  "defaultPublishMode": "immediate" | "scheduled" | "draft",
  "items": [
    {
      "division": "text" | "photo" | "story" | "reels",
      "title": "judul singkat tugas divisi",
      "brief": "instruksi spesifik untuk agent divisi tersebut",
      "contentType": "motivation" | "quote" | "tutorial" | "free_photo" | "action_reels" | "story_teaser",
      "publishMode": "immediate" | "scheduled" | "draft",
      "hourWib": 9,
      "minuteWib": 30,
      "dayOffset": 0
    }
  ]
}`;

    for (const model of textModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Waktu saat ini (UTC): ${safeNow.toISOString()}\nPerintah Owner: ${command}`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.25,
              responseMimeType: "application/json",
            },
          }),
        });

        if (!res.ok) continue;

        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };

        const rawJson = data.candidates?.[0]?.content?.parts
          ?.map((pt) => pt.text ?? "")
          .join("")
          .trim();

        if (!rawJson) continue;

        const cleanedJson = rawJson
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();

        const parsed = JSON.parse(cleanedJson) as {
          commandSummary?: string;
          defaultPublishMode?: PublishMode;
          items?: Array<{
            division?: ContentDivision;
            title?: string;
            brief?: string;
            contentType?: DivisionContentType;
            publishMode?: PublishMode;
            hourWib?: number;
            minuteWib?: number;
            dayOffset?: number;
          }>;
        };

        const validDivisions: ContentDivision[] = [
          "text",
          "photo",
          "story",
          "reels",
        ];
        const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
        const normalizedItems: OrchestratorPlanItem[] = [];

        for (const item of rawItems) {
          if (!item.division || !validDivisions.includes(item.division)) {
            continue;
          }
          const mode: PublishMode =
            item.publishMode &&
            ["immediate", "scheduled", "draft"].includes(item.publishMode)
              ? item.publishMode
              : detectPublishModeFromCommand(command);

          let scheduledAt: string | null = null;
          if (mode === "immediate") {
            scheduledAt = safeNow.toISOString();
          } else if (mode === "scheduled") {
            scheduledAt = computeSlotDateWib(
              item.division,
              safeNow,
              item.hourWib ?? null,
              item.minuteWib ?? null,
              typeof item.dayOffset === "number" ? item.dayOffset : 0
            ).toISOString();
          }

          normalizedItems.push({
            division: item.division,
            divisionLabel: DIVISION_LABELS[item.division],
            title:
              (item.title ?? "").trim() ||
              `Tugas ${DIVISION_LABELS[item.division]}`,
            brief: (item.brief ?? "").trim() || command,
            contentType: item.contentType ?? "motivation",
            publishMode: mode,
            scheduledAt,
            scheduledLabelWib: formatWibLabel(scheduledAt, mode),
          });
        }

        if (normalizedItems.length > 0) {
          const defaultMode =
            parsed.defaultPublishMode &&
            ["immediate", "scheduled", "draft"].includes(
              parsed.defaultPublishMode
            )
              ? parsed.defaultPublishMode
              : detectPublishModeFromCommand(command);

          return NextResponse.json({
            ok: true,
            source: model,
            plan: {
              commandSummary:
                (parsed.commandSummary ?? "").trim() ||
                `Rencana produksi ${normalizedItems.length} divisi siap dijalankan.`,
              defaultPublishMode: defaultMode,
              items: normalizedItems,
            } satisfies OrchestratorPlan,
          });
        }
      } catch {
        // Lanjut ke model berikutnya atau fallback rule-based
      }
    }

    return NextResponse.json({
      ok: true,
      source: "rule-based-fallback",
      plan: buildFallbackPlan(command, safeNow),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat menyusun rencana Orchestrator.",
      },
      { status: 500 }
    );
  }
}
