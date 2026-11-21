import React from "react";
import { ProjectsManager } from "@/components/projects/ProjectsManager";

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Project <span className="studio-gradient-text">Workspaces</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          Kelola proyek kreatif dengan konteks, instruksi sistem, dan memori yang terisolasi satu sama lain.
        </p>
      </div>

      <ProjectsManager />
    </div>
  );
}
