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

async function generateImageBase64WithGemini(
  apiKey: string,
  prompt: string
): Promise<{ base64: string; mimeType: string }> {
  const errors: string[] = [];

  // 1. Coba model Gemini native image generation via generateContent
  const geminiImageModels = ["gemini-3.1-flash-image"];
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
          base64: inline.data,
          mimeType: inline.mimeType || "image/png",
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

  // 2. Fallback ke Imagen REST endpoint (:predict)
  const imagenModels = ["imagen-3.0-generate-002", "imagen-4.0-generate-001"];
  for (const model of imagenModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(
        apiKey
      )}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: "16:9",
          },
        }),
      });

      const rawText = await res.text();
      if (!res.ok) {
        errors.push(`${model} (${res.status}): ${rawText.slice(0, 180)}`);
        continue;
      }

      const parsed = JSON.parse(rawText) as {
        predictions?: Array<{
          bytesBase64Encoded?: string;
          mimeType?: string;
        }>;
      };

      const pred = parsed.predictions?.[0];
      if (pred?.bytesBase64Encoded) {
        return {
          base64: pred.bytesBase64Encoded,
          mimeType: pred.mimeType || "image/png",
        };
      }

      errors.push(`${model}: Tidak ada bytesBase64Encoded pada respons.`);
    } catch (err) {
      errors.push(
        err instanceof Error
          ? `${model}: ${err.message}`
          : `${model}: Gagal memanggil Imagen API.`
      );
    }
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
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "API key Gemini tidak ditemukan untuk membuat gambar.",
        },
        { status: 500 }
      );
    }

    const { base64, mimeType } = await generateImageBase64WithGemini(
      apiKey,
      prompt
    );

    const bytes = Buffer.from(base64, "base64");
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
        .upload(filePath, bytes, {
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
