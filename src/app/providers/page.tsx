import React from "react";
import { ProviderManagerClient } from "@/components/providers/ProviderManagerClient";

export default function ProvidersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          AI Provider <span className="studio-gradient-text">Manager</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          Kelola penyedia cloud AI (Gemini, Groq, atau penyedia tambahan), model, batas RPM, dan urutan fallback.
        </p>
      </div>

      <ProviderManagerClient />
    </div>
  );
}
