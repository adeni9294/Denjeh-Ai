import React from "react";
import Link from "next/link";
import { INITIAL_PROJECTS } from "@/data/mockPhase1Data";
import { Badge } from "@/components/ui/Badge";
import { ArrowUpRight, FolderKanban } from "lucide-react";

export function RecentProjects() {
  return (
    <div id="projects" className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Project Workspaces</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Memori & artefak terisolasi per proyek
          </p>
        </div>
        <Link
          href="/command-center"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-500 hover:underline"
        >
          <span>Buka Studio</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="space-y-3">
        {INITIAL_PROJECTS.map((project) => (
          <div
            key={project.id}
            className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <FolderKanban className="h-4 w-4 text-purple-400 shrink-0" />
                <h3 className="text-sm font-semibold">{project.name}</h3>
              </div>
              <Badge variant={project.status === "active" ? "emerald" : "slate"}>
                {project.status}
              </Badge>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {project.tagline}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {project.memoryKeys.map((mem) => (
                <span
                  key={mem}
                  className="rounded-md bg-slate-200/70 dark:bg-studio-card px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300"
                >
                  {mem}
                </span>
              ))}
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-studio-border flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>{project.artifactsCount} artefak tersimpan</span>
              <span>Update: {project.lastActivity}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}