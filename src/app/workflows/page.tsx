import React from "react";
import { StudioModulesWorkspace } from "@/components/studio/StudioModulesWorkspace";

export default function WorkflowsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Workflow Builder</h1>
        <p className="text-xs text-slate-400">
          Pantau struktur langkah DAG dan status workflow run per proyek.
        </p>
      </div>
      <StudioModulesWorkspace moduleKey="workflows" />
    </div>
  );
}
