"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles } from "lucide-react";

export function QuickCommandBox() {
  const [prompt, setPrompt] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = prompt.trim();
    if (!query) {
      router.push("/command-center");
      return;
    }
    router.push(`/command-center?q=${encodeURIComponent(query)}`);
  };

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-6 border-blue-500/25">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-500" />
          <h2 className="text-sm font-semibold">
            Quick Command — Master Orchestrator
          </h2>
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Kirim instruksi konten (Teks, Story, Foto, atau Reels) untuk diproses
          multi-agen
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Contoh: Buatkan konten foto dan teks postingan untuk Facebook Page hari ini..."
          className="flex-1 rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
        >
          <span>Buka Command Center</span>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
