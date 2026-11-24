import React from "react";
import { StudioModulesWorkspace } from "@/components/studio/StudioModulesWorkspace";

export default function PlannerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Content Planner</h1>
        <p className="text-xs text-slate-400">
          Linimasa tugas dan tahapan produksi konten per proyek.
        </p>
      </div>
      <StudioModulesWorkspace moduleKey="planner" />
    </div>
  );
}
