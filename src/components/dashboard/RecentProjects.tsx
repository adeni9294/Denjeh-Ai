"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { INITIAL_PROJECTS } from "@/data/mockPhase1Data";
import { DbProject } from "@/types/studio";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { ArrowUpRight, FolderKanban } from "lucide-react";

export function RecentProjects() {
  const [dbProjects, setDbProjects] = useState<DbProject[] | null>(null);

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getUser().then(async ({ data }) => {
        if (!data.user) return;
        const { data: rows } = await supabase
          .from("projects")
          .select("*")
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(3);
        if (rows) {
          setDbProjects(rows as DbProject[]);
        }
      });
    } catch {
      // Tetap gunakan fallback jika belum ada sesi
    }
  }, []);

  return (
    <div id="projects" className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Project Workspaces</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dbProjects
              ? "Proyek tersimpan di PostgreSQL (RLS Aktif)"
              : "Memori & artefak terisolasi per proyek"}
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-500 hover:underline"
        >
          <span>Kelola Proyek</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {dbProjects ? (
        dbProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-studio-border p-6 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Belum ada proyek di database Anda.
            </p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-500 hover:underline"
            >
              + Buat Proyek Pertama
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {dbProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 transition hover:border-blue-500/40"
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
                  {project.description || "Klik untuk membuka workspace & memori proyek."}
                </p>
              </Link>
            ))}
          </div>
        )
      ) : (
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
