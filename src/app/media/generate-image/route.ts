import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface GenerateImagePayload {
  prompt?: string;
  taskId?: string;
  filePrefix?: string;
  bucket?: string;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function getFileExtension(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function sanitizeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "dnaverse";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateImagePayload;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json(
        { ok: false, error: "Prompt gambar tidak boleh kosong." },
        { status: 400 }
      );
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!geminiApiKey) {
      return NextResponse.json(
        { ok: false, error: "GEMINI_API_KEY belum dikonfigurasi di environment." },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "NEXT_PUBLIC_SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.",
        },
        { status: 500 }
      );
    }

    const model = "gemini-2.5-flash-image";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      geminiApiKey
    )}`;

    const styledPrompt = `${prompt}. Gaya sinematik live-action berkualitas tinggi, komposisi tajam, pencahayaan dramatis, tanpa teks watermark.`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: styledPrompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      return NextResponse.json(
        { ok: false, error: `Error Gemini API (${geminiResponse.status}): ${errorBody}` },
        { status: 502 }
      );
    }

    const geminiJson = (await geminiResponse.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: {
              mimeType?: string;
              data?: string;
            };
          }>;
        };
      }>;
    };

    const imagePart = geminiJson.candidates?.[0]?.content?.parts?.find(
      (part) => Boolean(part.inlineData?.data)
    );

    if (!imagePart?.inlineData?.data) {
      return NextResponse.json(
        { ok: false, error: "Respons Gemini tidak memuat data gambar." },
        { status: 502 }
      );
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const ext = getFileExtension(mimeType);
    const fileBytes = decodeBase64ToBytes(imagePart.inlineData.data);

    const bucket = sanitizeSegment(body.bucket || process.env.SUPABASE_MEDIA_BUCKET || "dnaverse-media");
    const prefix = sanitizeSegment(body.filePrefix || body.taskId || "dnaverse-awakening");
    const objectPath = `keyframe/${prefix}-${Date.now()}.${ext}`;

    const cleanSupabaseUrl = supabaseUrl.replace(/\/+$/, "");
    const uploadEndpoint = `${cleanSupabaseUrl}/storage/v1/object/${bucket}/${objectPath}`;

    const uploadResponse = await fetch(uploadEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": mimeType,
        "x-upsert": "true",
      },
      body: fileBytes,
    });

    if (!uploadResponse.ok) {
      const uploadErrorText = await uploadResponse.text();
      return NextResponse.json(
        {
          ok: false,
          error: `Gagal mengunggah gambar ke Supabase Storage (${uploadResponse.status}): ${uploadErrorText}`,
        },
        { status: 502 }
      );
    }

    const publicUrl = `${cleanSupabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;

    return NextResponse.json({
      ok: true,
      imageUrl: publicUrl,
      mimeType,
      bucket,
      objectPath,
      taskId: body.taskId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses pembuatan gambar.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
