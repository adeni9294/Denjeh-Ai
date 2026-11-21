import React from "react";
import { MemorySettingsWorkspace } from "@/components/memory/MemorySettingsWorkspace";

export default function MemoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Memory & Settings</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Kelola konteks memori proyek, aturan kontinuitas, dan instruksi sistem
          untuk Master Orchestrator.
        </p>
      </div>
      <MemorySettingsWorkspace />
    </div>
  );
}
