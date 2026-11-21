import React from "react";
import { PHASE1_STATS } from "@/data/mockPhase1Data";

export function StatsGrid() {
  return (
    <section aria-label="Ringkasan Studio" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {PHASE1_STATS.map((stat) => (
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