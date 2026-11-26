"use client";

import React, { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface StudioStatItem {
  label: string;
  value: string;
  subtext: string;
}

const DEFAULT_STATS: StudioStatItem[] = [
  {
    label: "Total Proyek",
    value: "0",
    subtext: "0 proyek aktif",
  },
  {
    label: "Workflow Aktif",
    value: "0",
    subtext: "Menunggu / berjalan",
  },
  {
    label: "Tugas Berjalan",
    value: "0 / 0",
    subtext: "Antrean tugas real-time",
  },
  {
    label: "Estimasi Biaya API",
    value: "$0.00",
    subtext: "Cloud API / Free-First Mode",
  },
];

export function StatsGrid() {
  const [stats, setStats] = useState<StudioStatItem[]>(DEFAULT_STATS);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active || !user) return;

        const [
          { data: projRows },
          { data: runRows },
          { data: taskRows },
          { data: usageRows },
        ] = await Promise.all([
          supabase
            .from("projects")
            .select("id, status")
            .eq("user_id", user.id)
            .neq("status", "archived"),
          supabase
            .from("workflow_runs")
            .select("id, status")
            .eq("user_id", user.id),
          supabase
            .from("tasks")
            .select("id, status")
            .eq("user_id", user.id),
          supabase
            .from("usage_logs")
            .select("estimated_cost_usd")
            .eq("user_id", user.id),
        ]);

        if (!active) return;

        const projectsList = (projRows ?? []) as {
          id: string;
          status: string;
        }[];
        const activeProjectsCount = projectsList.filter(
          (p) => p.status === "active"
        ).length;

        const runsList = (runRows ?? []) as { id: string; status: string }[];
        const activeRunsCount = runsList.filter(
          (r) => r.status === "running" || r.status === "pending"
        ).length;

        const tasksList = (taskRows ?? []) as { id: string; status: string }[];
        const runningTasksCount = tasksList.filter(
          (t) => t.status === "running"
        ).length;

        const totalCost = ((usageRows ?? []) as {
          estimated_cost_usd?: number | null;
        }[]).reduce((acc, row) => acc + Number(row.estimated_cost_usd ?? 0), 0);

        setStats([
          {
            label: "Total Proyek",
            value: String(projectsList.length),
            subtext: `${activeProjectsCount} proyek aktif`,
          },
          {
            label: "Workflow Aktif",
            value: String(activeRunsCount),
            subtext: `${runsList.length} total riwayat run`,
          },
          {
            label: "Tugas Berjalan",
            value: `${runningTasksCount} / ${tasksList.length}`,
            subtext: "Antrean tugas real-time",
          },
          {
            label: "Estimasi Biaya API",
            value: `$${totalCost.toFixed(2)}`,
            subtext: "Cloud API / Free-First Mode",
          },
        ]);
      } catch {
        // Pertahankan nilai default jika query gagal
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section
      aria-label="Ringkasan Studio"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="glass-panel rounded-2xl p-4 sm:p-5 transition hover:border-blue-500/40"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {stat.label}
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {stat.value}
          </p>
          <p className="mt-1.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
            {stat.subtext}
          </p>
        </div>
      ))}
    </section>
  );
}
