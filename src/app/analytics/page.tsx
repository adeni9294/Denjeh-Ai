import React from "react";
import { StudioModulesWorkspace } from "@/components/studio/StudioModulesWorkspace";

export default function AnalyticsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Analytics</h1>
        <p className="text-xs text-slate-400">
          Ringkasan penggunaan token, model AI, dan progres penyelesaian tugas.
        </p>
      </div>
      <StudioModulesWorkspace moduleKey="analytics" />
    </div>
  );
}
