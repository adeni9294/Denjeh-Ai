import React from "react";
import { ContentStudioWorkspace } from "@/components/studio/ContentStudioWorkspace";

export default function ContentStudioPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Content Studio</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Kurasi, saring, salin, dan kompilasi seluruh artefak hasil eksekusi
          agen per proyek.
        </p>
      </div>
      <ContentStudioWorkspace />
    </div>
  );
}
