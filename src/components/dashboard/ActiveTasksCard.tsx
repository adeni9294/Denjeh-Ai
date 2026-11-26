"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/Badge";
import { CheckCircle2, RotateCcw, ArrowUpRight } from "lucide-react";

interface DashboardTaskRow {
  id: string;
  title: string;
  status: string;
  progress: number;
  project_id: string | null;
  agent_code: string | null;
  input_payload: Record<string, unknown> | null;
  created_at: string;
}

export function ActiveTasksCard() {
  const [tasks, setTasks] = useState<DashboardTaskRow[]>([]);
  const [projectMap, setProjectMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setTasks([]);
        setLoading(false);
        return;
      }

      const [{ data: taskRows }, { data: projRows }] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, title, status, progress, project_id, agent_code, input_payload, created_at"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase.from("projects").select("id, name").eq("user_id", user.id),
      ]);

      const map: Record<string, string> = {};
      for (const p of (projRows ?? []) as { id: string; name: string }[]) {
        map[p.id] = p.name;
      }

      setProjectMap(map);
      setTasks((taskRows as DashboardTaskRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleApprove = async (id: string) => {
    if (updatingId) return;
    setUpdatingId(id);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("tasks")
        .update({
          status: "completed",
          progress: 100,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (!error) {
        setTasks((prev) =>
          prev.map((task) =>
            task.id === id
              ? { ...task, status: "completed", progress: 100 }
              : task
          )
        );
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRetry = async (id: string) => {
    if (updatingId) return;
    setUpdatingId(id);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("tasks")
        .update({
          status: "awaiting_approval",
          progress: 0,
          error_message: null,
        })
        .eq("id", id);

      if (!error) {
        setTasks((prev) =>
          prev.map((task) =>
            task.id === id
              ? { ...task, status: "awaiting_approval", progress: 0 }
              : task
          )
        );
      }
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">Execution Monitor</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Antrean tugas agen real-time dari database
          </p>
        </div>
        <Link
          href="/command-center"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline"
        >
          <span>Command Center</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Memuat antrean tugas...</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 text-xs text-slate-400 space-y-2">
          <p>Belum ada tugas agen yang dijalankan.</p>
          <Link
            href="/command-center"
            className="inline-flex items-center gap-1 font-medium text-blue-400 hover:underline"
          >
            <span>Mulai buat perintah di AI Command Center →</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const payload = (task.input_payload ?? {}) as Record<
              string,
              unknown
            >;
            const agentLabel = String(
              payload.agentName || task.agent_code || "Studio Agent"
            );
            const projectLabel = task.project_id
              ? projectMap[task.project_id] || "Proyek Aktif"
              : "Bebas / Umum";
            const progressVal = Number(task.progress ?? 0);

            return (
              <div
                key={task.id}
                className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-snug">
                      {task.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {projectLabel} •{" "}
                      <span className="text-blue-400">{agentLabel}</span>
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

                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-studio-border">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
                      style={{ width: `${progressVal}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {progressVal}%
                  </span>
                </div>

                {task.status === "awaiting_approval" && (
                  <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-studio-border">
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => void handleApprove(task.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        {updatingId === task.id
                          ? "Menyimpan..."
                          : "Setujui Output"}
                      </span>
                    </button>
                  </div>
                )}

                {task.status === "failed" && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={updatingId === task.id}
                      onClick={() => void handleRetry(task.id)}
                      className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Coba Ulang</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
