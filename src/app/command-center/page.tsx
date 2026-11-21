import React, { Suspense } from "react";
import { CommandWorkspace } from "@/components/command/CommandWorkspace";

export default function CommandCenterPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          AI <span className="studio-gradient-text">Command Center</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          Berikan tujuan kreatif kompleks. Master Orchestrator akan menyusun rencana DAG, mengatur dependensi, dan memantau hasil agen.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="glass-panel rounded-2xl p-6 text-sm text-slate-400">
            Memuat Command Center...
          </div>
        }
      >
        <CommandWorkspace />
      </Suspense>
    </div>
  );
}