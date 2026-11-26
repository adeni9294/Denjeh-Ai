export async function getServerEnv(): Promise<Record<string, string | undefined>> {
  // 1. Coba cara Cloudflare (runtime)
  try {
    // @ts-ignore - ini cuma ada pas jalan di Cloudflare
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext();
    if (env) return env as any;
  } catch {}

  // 2. Kalo gagal, coba cara lama (local / Vercel)
  return process.env as any;
}

export async function getGeminiKey(): Promise<string> {
  const env = await getServerEnv();
  return (
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    ""
  );
}
