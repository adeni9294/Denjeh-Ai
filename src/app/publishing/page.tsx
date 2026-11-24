import React from "react";
import { StudioModulesWorkspace } from "@/components/studio/StudioModulesWorkspace";

export default function PublishingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Publishing Center</h1>
        <p className="text-xs text-slate-400">
          Kurasi dan salin draf rilis dari artefak agen yang sudah selesai.
        </p>
      </div>
      <StudioModulesWorkspace moduleKey="publishing" />
    </div>
  );
}
