import React from "react";
import { StudioModulesWorkspace } from "@/components/studio/StudioModulesWorkspace";

export default function AgentsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Agent Studio</h1>
        <p className="text-xs text-slate-400">
          Daftar peran agen spesialis dan prompt tugas siap kirim ke Command Center.
        </p>
      </div>
      <StudioModulesWorkspace moduleKey="agents" />
    </div>
  );
}
