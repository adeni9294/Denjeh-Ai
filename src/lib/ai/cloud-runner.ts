import { DbAiModel, DbAiProvider } from "@/types/studio";

export interface GeneratedPlanStep {
  stepNumber: number;
  agentCode: string;
  agentName: string;
  action: string;
  dependsOn: string;
  estimatedOutput: string;
}

export interface OrchestratorPlanResult {
  intentSummary: string;
  recommendedMode: "manual" | "autonomous";
  steps: GeneratedPlanStep[];
  providerUsed: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

function decodeStoredKey(encoded: string | null): string | null {
  if (!encoded) return null;
  if (encoded.startsWith("enc_v1:")) {
    try {
      return Buffer.from(encoded.slice(7), "base64").toString("utf-8").trim();
    } catch {
      return null;
    }
  }
  return encoded.trim();
}

function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Respons AI tidak memuat struktur JSON yang valid.");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiEndpoint(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/models/${params.model}:generateContent?key=${encodeURIComponent(
    params.apiKey
  )}`;

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: params.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }

    const errBody = await res.text();
    lastErr = new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 180)}`);

    if (res.status === 503 && attempt === 0) {
      await sleep(900);
      continue;
    }
    break;
  }

  throw lastErr ?? new Error("Gagal memanggil endpoint Gemini.");
}

async function callOpenAiCompatibleEndpoint(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Provider HTTP ${res.status}: ${errBody.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function generatePlanWithFallback(params: {
  providers: DbAiProvider[];
  models: DbAiModel[];
  systemPrompt: string;
  userPrompt: string;
}): Promise<OrchestratorPlanResult> {
  const enabledProviders = params.providers
    .filter((p) => p.is_enabled && p.encrypted_api_key)
    .sort((a, b) => a.priority_order - b.priority_order);

  if (enabledProviders.length === 0) {
    throw new Error(
      "Belum ada AI Provider aktif dengan API key valid. Silakan atur di menu AI Provider Manager (/providers)."
    );
  }

  const errors: string[] = [];

  for (const provider of enabledProviders) {
    const apiKey = decodeStoredKey(provider.encrypted_api_key);
    if (!apiKey) continue;

    const providerModels = params.models
      .filter((m) => m.provider_id === provider.id && m.is_active)
      .sort((a, b) => Number(b.is_default) - Number(a.is_default));

    const candidateModels =
      providerModels.length > 0
        ? Array.from(new Set(providerModels.map((m) => m.model_identifier)))
        : [
            provider.provider_key === "groq"
              ? "llama-3.3-70b-versatile"
              : "gemini-3.8-flash-lite",
          ];

    const isGemini =
      provider.provider_key === "gemini" ||
      (provider.base_url ?? "").includes("generativelanguage.googleapis.com");

    const baseUrl =
      provider.base_url ||
      (isGemini
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.groq.com/openai/v1");

    for (const chosenModel of candidateModels) {
      try {
        const rawResult = isGemini
          ? await callGeminiEndpoint({
              apiKey,
              baseUrl,
              model: chosenModel,
              systemPrompt: params.systemPrompt,
              userPrompt: params.userPrompt,
            })
          : await callOpenAiCompatibleEndpoint({
              apiKey,
              baseUrl,
              model: chosenModel,
              systemPrompt: params.systemPrompt,
              userPrompt: params.userPrompt,
            });

        const parsed = extractJsonObject(rawResult.text);
        const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

        if (rawSteps.length === 0) {
          throw new Error("AI mengembalikan rencana kosong (0 langkah).");
        }

        const normalizedSteps: GeneratedPlanStep[] = rawSteps.map((item, index) => {
          const row = item as Record<string, unknown>;
          return {
            stepNumber: Number(row.stepNumber ?? index + 1),
            agentCode: String(row.agentCode ?? "story"),
            agentName: String(row.agentName ?? "Story Agent"),
            action: String(row.action ?? "Menyusun bagian konten sesuai instruksi."),
            dependsOn: String(
              row.dependsOn ?? (index === 0 ? "Project Memory" : `Step ${index}`)
            ),
            estimatedOutput: String(row.estimatedOutput ?? "Artefak Terstruktur"),
          };
        });

        return {
          intentSummary: String(
            parsed.intentSummary ?? "Rencana eksekusi multi-agen berhasil disusun."
          ),
          recommendedMode:
            parsed.recommendedMode === "autonomous" ? "autonomous" : "manual",
          steps: normalizedSteps,
          providerUsed: provider.display_name,
          modelUsed: chosenModel,
          inputTokens: rawResult.inputTokens,
          outputTokens: rawResult.outputTokens,
        };
      } catch (err) {
        errors.push(
          `${provider.display_name} (${chosenModel}): ${
            err instanceof Error ? err.message : "Error tidak diketahui"
          }`
        );
      }
    }
  }

  throw new Error(`Semua provider AI gagal merespons. Detail: ${errors.join(" | ")}`);
}
