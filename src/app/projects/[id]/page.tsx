import React from "react";
import { ProjectDetailClient } from "@/components/projects/ProjectDetailClient";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Workspace & <span className="studio-gradient-text">Memory</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          Atur instruksi inti proyek dan memori jangka panjang untuk kontinuitas multi-agen.
        </p>
      </div>

      <ProjectDetailClient projectId={id} />
    </div>
  );
}
