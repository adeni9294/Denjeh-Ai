// src/lib/getEnv.ts - Biar Secret Cloudflare Ke Baca

export async function getServerEnv(): Promise<Record<string, string | undefined>> {
  // 1. Coba cara Cloudflare (Runtime) - Ini yang bener buat di Cloudflare
  try {
    // @ts-ignore - getCloudflareContext cuma ada pas jalan di Cloudflare
    const mod = await import("@opennextjs/cloudflare").catch(() => null);
    if (mod?.getCloudflareContext) {
      const { env } = await mod.getCloudflareContext();
      if (env && Object.keys(env).length > 0) {
        return env as Record<string, string | undefined>;
      }
    }
  } catch {
    // Abaikan, lanjut ke cara ke-2
  }

  // 2. Coba cara Next-on-Pages (kalo project lu pake ini)
  try {
    // @ts-ignore
    const mod2 = await import("@cloudflare/next-on-pages").catch(() => null);
    if (mod2?.getCloudflareContext) {
      const { env } = await mod2.getCloudflareContext();
      if (env && Object.keys(env).length > 0) {
        return env as Record<string, string | undefined>;
      }
    }
  } catch {}

  // 3. Terakhir, cara Local / Vercel
  return process.env as Record<string, string | undefined>;
}

export async function getGeminiKey(): Promise<string> {
  const env = await getServerEnv();
  return (
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    ""
  );
}
