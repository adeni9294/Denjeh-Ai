import React from "react";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { QuickCommandBox } from "@/components/dashboard/QuickCommandBox";
import { ActiveTasksCard } from "@/components/dashboard/ActiveTasksCard";
import { RecentProjects } from "@/components/dashboard/RecentProjects";
import { AgentOverviewGrid } from "@/components/dashboard/AgentOverviewGrid";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page Intro */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Studio Control Center
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Pantau agen otonom, antrean eksekusi cloud, dan memori proyek kreatif Anda.
          </p>
        </div>
        <span className="text-[11px] text-amber-500/90 font-medium">
          * Fase 1 menggunakan data sampel terisolasi untuk validasi UI/UX
        </span>
      </div>

      {/* KPI Metrics */}
      <StatsGrid />

      {/* Direct Command Input */}
      <QuickCommandBox />

      {/* Two-Column Execution & Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActiveTasksCard />
        <RecentProjects />
      </div>

      {/* 10 Agents Overview */}
      <AgentOverviewGrid />
    </div>
  );
}