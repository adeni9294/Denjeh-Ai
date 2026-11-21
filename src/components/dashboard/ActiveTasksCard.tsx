"use client";

import React, { useState } from "react";
import { INITIAL_TASKS } from "@/data/mockPhase1Data";
import { StudioTask } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import { CheckCircle2, RotateCcw } from "lucide-react";

export function ActiveTasksCard() {
  const [tasks, setTasks] = useState<StudioTask[]>(INITIAL_TASKS);

  const handleApprove = (id: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? { ...task, status: "completed", updatedAt: "Disetujui barusan" }
          : task
      )
    );
  };

  return (
    <div className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Execution Monitor</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Antrean tugas agen (Data sampel Fase 1)
          </p>
        </div>
        <Badge variant="blue">Max 2 Paralel</Badge>
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-snug">{task.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {task.projectName} • <span className="text-blue-400">{task.agentName}</span>
                </p>
              </div>
              <Badge
                variant={
                  task.status === "completed"
                    ? "emerald"
                    : task.status === "awaiting_approval"
                    ? "amber"
                    : task.status === "running"
                    ? "blue"
                    : "slate"
                }
              >
                {task.status}
              </Badge>
            </div>

            {/* Progress bar */}
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-studio-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {task.progress}%
              </span>
            </div>

            {/* Actionable Approval Control */}
            {task.status === "awaiting_approval" && (
              <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-studio-border">
                <button
                  type="button"
                  onClick={() => handleApprove(task.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Setujui Output</span>
                </button>
              </div>
            )}

            {task.status === "failed" && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Coba Ulang</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}