import React from "react";
import { INITIAL_AGENTS } from "@/data/mockPhase1Data";
import { Badge } from "@/components/ui/Badge";
import { Bot } from "lucide-react";

export function AgentOverviewGrid() {
  return (
    <section id="agents" className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold">Multi-Agent Roster (10 Spesialis)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agen dapat berbagi model AI yang sama dengan instruksi & izin alat yang berbeda
          </p>
        </div>
        <Badge variant="purple">Cloud API Ready</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {INITIAL_AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3.5 transition hover:border-blue-500/40"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
                  <Bot className="h-4 w-4" />
                </div>
                <Badge
                  variant={
                    agent.status === "busy"
                      ? "amber"
                      : agent.status === "active"
                      ? "emerald"
                      : "slate"
                  }
                >
                  {agent.status}
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">{agent.name}</h3>
              <p className="text-[11px] font-medium text-blue-500 dark:text-blue-400">
                {agent.role}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {agent.description}
              </p>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-studio-border flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="truncate max-w-[130px]">{agent.assignedModel}</span>
              <span>{agent.completedTasks} tugas</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}