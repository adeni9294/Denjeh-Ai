import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGeminiKey } from "@/lib/getEnv";
import { DbAiProvider } from "@/types/studio";

interface GenerateImageBody {
  prompt?: string;
  taskId?: string;
  filePrefix?: string;
}

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

function buildCompactPollinationsPrompt(rawPrompt: string): string {
  // Ringkas prompt panjang agar URL Pollinations tidak kepanjangan dan tetap deskriptif
  const singleLine = rawPrompt
    .replace(/\s+/g, " ")
    .replace(/===.*?===/g, " ")
    .trim();
  return singleLine.slice(0, 650);
}

async function generateImageBufferWithPollinations(
  prompt: string
): Promise<{ buffer: Buffer; mimeType: string; modelUsed: string }> {
  const compactPrompt = buildCompactPollinationsPrompt(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    compactPrompt
  )}?width=1280&height=720&nologo=true&seed=${seed}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "image/*,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Pollinations HTTP ${res.status}: ${errText.slice(0, 180) || "Gagal mengambil gambar"}`
    );
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const arrBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrBuf);

  if (buffer.byteLength < 1024) {
    throw new Error("Pollinations mengembalikan data gambar terlalu kecil/kosong.");
  }

  return {
    buffer,
    mimeType: contentType.startsWith("image/") ? contentType : "image/jpeg",
    modelUsed: "pollinations-flux",
  };
}

async function generateImageWithFallback(
  apiKey: string,
  prompt: string
): Promise<{ buffer: Buffer; mimeType: string; modelUsed: string }> {
  const errors: string[] = [];

  if (apiKey) {
    const geminiImageModels = [
      "gemini-3.1-flash-lite-image",
      "gemini-3.1-flash-image",
      "gemini-3-pro-image",
    ];

    for (const model of geminiImageModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
            },
          }),
        });

        const rawText = await res.text();
        if (!res.ok) {
          errors.push(`${model} (${res.status}): ${rawText.slice(0, 180)}`);
          continue;
        }

        const parsed = JSON.parse(rawText) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: { mimeType?: string; data?: string };
              }>;
            };
          }>;
        };

        const inline = parsed.candidates?.[0]?.content?.parts?.find(
          (pt) => pt.inlineData?.data
        )?.inlineData;

        if (inline?.data) {
          return {
            buffer: Buffer.from(inline.data, "base64"),
            mimeType: inline.mimeType || "image/png",
            modelUsed: model,
          };
        }

        errors.push(`${model}: Tidak ada inlineData pada respons.`);
      } catch (err) {
        errors.push(
          err instanceof Error
            ? `${model}: ${err.message}`
            : `${model}: Gagal memanggil Gemini Image API.`
        );
      }
    }
  }

  try {
    return await generateImageBufferWithPollinations(prompt);
  } catch (polErr) {
    errors.push(
      polErr instanceof Error
        ? polErr.message
        : "Gagal mengambil gambar dari Pollinations.ai."
    );
  }

  throw new Error(
    `Gagal generate gambar: ${errors.join(" | ") || "Unknown error"}`
  );
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

    let body: GenerateImageBody = {};
    try {
      body = (await req.json()) as GenerateImageBody;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Format JSON permintaan tidak valid." },
        { status: 400 }
      );
    }

    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json(
        { ok: false, error: "Prompt gambar tidak boleh kosong." },
        { status: 400 }
      );
    }

    const { data: providers } = await supabase
      .from("ai_providers")
      .select("*")
      .eq("is_enabled", true)
      .order("priority_order", { ascending: true });

    const apiKey = await resolveGeminiKey((providers as DbAiProvider[]) ?? []);
    const { buffer, mimeType, modelUsed } = await generateImageWithFallback(
      apiKey,
      prompt
    );

    const ext =
      mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const safePrefix = (body.filePrefix || "dnaverse")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-");
    const filePath = `${user.id}/${safePrefix}-${Date.now()}.${ext}`;

    const bucketsToTry = ["media", "generated-images", "public-media"];
    let uploadedPublicUrl = "";
    let lastStorageError = "";

    for (const bucket of bucketsToTry) {
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!uploadErr) {
        const { data: pubData } = supabase.storage
          .from(bucket)
          .getPublicUrl(filePath);
        if (pubData?.publicUrl) {
          uploadedPublicUrl = pubData.publicUrl;
          break;
        }
      } else {
        lastStorageError = `${bucket}: ${uploadErr.message}`;
      }
    }

    if (!uploadedPublicUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: `Gambar berhasil dibuat tetapi gagal diunggah ke Supabase Storage (${
            lastStorageError ||
            "pastikan bucket 'media' sudah dibuat dan public"
          }).`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      imageUrl: uploadedPublicUrl,
      mimeType,
      modelUsed,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Terjadi kesalahan saat membuat gambar.",
      },
      { status: 500 }
    );
  }
}
