"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbProject, DbTask, DbWorkflowRun } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Bot,
  GitBranch,
  CalendarDays,
  Send,
  BarChart3,
  SlidersHorizontal,
  Copy,
  Check,
  ArrowUpRight,
} from "lucide-react";
import {
  MULTI_AGENT_SPECIALISTS,
  AGENT_TOOL_REGISTRY,
} from "@/lib/ai/agent-tools";

export type StudioModuleKey =
  | "agents"
  | "workflows"
  | "planner"
  | "publishing"
  | "analytics";

interface UsageLogRow {
  id: string;
  provider_key?: string | null;
  model_identifier?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_usd?: number | null;
  created_at: string;
}

type TaskWithPayloads = DbTask & {
  workflow_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
};

type WorkflowRunWithPlan = DbWorkflowRun & {
  plan_json?: Record<string, unknown> | null;
};

const AGENT_ROSTER = [
  {
    code: "story",
    name: "Story Agent",
    role: "Menyusun sinopsis, struktur tiga babak, dan naskah dialog/klip 10–15 detik.",
    defaultPrompt:
      "Buat sinopsis, struktur tiga babak, dan naskah dialog singkat terbagi menjadi klip 10-15 detik untuk proyek aktif.",
  },
  {
    code: "character",
    name: "Character Agent",
    role: "Menjaga identitas tokoh, kostum, properti, dan konsistensi karakter lintas adegan.",
    defaultPrompt:
      "Susun profil karakter utama dan pendukung lengkap dengan kostum, properti kunci, dan aturan kontinuitas visual.",
  },
  {
    code: "visual",
    name: "Visual & Video Prompt Agent",
    role: "Menyusun storyboard, arahan pencahayaan sinematik, dan prompt video per klip 10–15 detik.",
    defaultPrompt:
      "Buat storyboard dan prompt video sinematik per klip berdurasi 10-15 detik lengkap dengan kamera dan pencahayaan.",
  },
  {
    code: "publishing",
    name: "Publishing & Social Agent",
    role: "Menyiapkan caption multi-platform, tagar, metadata, dan jadwal publikasi.",
    defaultPrompt:
      "Susun caption media sosial, tagar, judul, dan rekomendasi jadwal rilis untuk klip proyek aktif.",
  },
  {
    code: "quality",
    name: "Quality Agent",
    role: "Mengaudit konsistensi cerita, kostum, visual, durasi, dan kesiapan rilis akhir.",
    defaultPrompt:
      "Lakukan audit kualitas menyeluruh terhadap konsistensi cerita, kostum, visual, dan durasi sebelum rilis.",
  },
];

export function StudioModulesWorkspace({
  moduleKey,
}: {
  moduleKey: StudioModuleKey;
}) {
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [runs, setRuns] = useState<DbWorkflowRun[]>([]);
  const [tasks, setTasks] = useState<TaskWithPayloads[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogRow[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [publishNotes, setPublishNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (projectId: string) => {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      let runsQ = supabase
        .from("workflow_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      let tasksQ = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(60);

      let usageQ = supabase
        .from("usage_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (projectId) {
        runsQ = runsQ.eq("project_id", projectId);
        tasksQ = tasksQ.eq("project_id", projectId);
        usageQ = usageQ.eq("project_id", projectId);
      }

      const [{ data: rData }, { data: tData }, { data: uData }] =
        await Promise.all([runsQ, tasksQ, usageQ]);

      setRuns((rData as DbWorkflowRun[]) ?? []);
      setTasks((tData as TaskWithPayloads[]) ?? []);
      setUsageLogs((uData as UsageLogRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: pData } = await supabase
        .from("projects")
        .select("*")
        .neq("status", "archived")
        .order("updated_at", { ascending: false });

      const rows = (pData as DbProject[]) ?? [];
      setProjects(rows);
      if (rows.length > 0) {
        setSelectedProject((prev) => prev || rows[0].id);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadData(selectedProject);
    }
  }, [selectedProject, loadData]);

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // Abaikan error clipboard
    }
  };

  const completedTasks = tasks.filter((t) => t.status === "completed");
  const totalInputTokens = usageLogs.reduce(
    (acc, u) => acc + Number(u.input_tokens ?? 0),
    0
  );
  const totalOutputTokens = usageLogs.reduce(
    (acc, u) => acc + Number(u.output_tokens ?? 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-blue-400" />
          <span className="text-xs text-slate-400">Proyek Aktif:</span>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="Pilih Proyek Modul"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium"
          >
            {projects.length === 0 ? (
              <option value="">Belum ada proyek</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
        </div>

        <Link
          href="/command-center"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline"
        >
          <span>Buka AI Command Center</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="glass-panel rounded-2xl p-6 text-xs text-slate-400">
          Memuat data modul...
        </div>
      ) : moduleKey === "agents" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {AGENT_ROSTER.map((ag) => (
            <div
              key={ag.code}
              className="glass-panel rounded-2xl p-4 space-y-2.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Bot className="h-4 w-4 text-purple-400" />
                  <span>{ag.name}</span>
                </div>
                <Badge variant="purple">{ag.code}</Badge>
              </div>
              <p className="text-slate-300 leading-relaxed">{ag.role}</p>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleCopyText(ag.code, ag.defaultPrompt)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200"
                >
                  {copiedKey === ag.code ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Prompt Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-blue-400" />
                      <span>Salin Prompt Tugas</span>
                    </>
                  )}
                </button>
                <Link
                  href={`/command-center?q=${encodeURIComponent(
                    ag.defaultPrompt
                  )}`}
                  className="text-[11px] font-medium text-blue-400 hover:underline"
                >
                  Kirim ke Command Center →
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : moduleKey === "workflows" ? (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-semibold">
                Alur Workflow & DAG Tersimpan ({runs.length})
              </h2>
            </div>
            <Badge variant="blue">PostgreSQL</Badge>
          </div>

          {runs.length === 0 ? (
            <p className="text-xs text-slate-400">
              Belum ada workflow run untuk proyek ini.
            </p>
          ) : (
            <div className="space-y-2.5">
              {runs.map((r) => {
                const meta = (r as WorkflowRunWithPlan).plan_json ?? {};
                const steps = Array.isArray(meta.steps)
                  ? (meta.steps as Record<string, unknown>[])
                  : [];
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {String(meta.title || r.title || `Run #${r.id.slice(0, 8)}`)}
                      </span>
                      <Badge
                        variant={r.status === "completed" ? "emerald" : "amber"}
                      >
                        {r.status}
                      </Badge>
                    </div>
                    {steps.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {steps.map((s, idx) => (
                          <span
                            key={idx}
                            className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            #{String(s.stepNumber ?? idx + 1)}{" "}
                            {String(s.agentName ?? s.agentCode ?? "Step")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : moduleKey === "planner" ? (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-400" />
              <h2 className="text-base font-semibold">
                Content Planner & Jadwal Produksi ({tasks.length} Item)
              </h2>
            </div>
            <Badge variant="emerald">Terhubung ke Tasks</Badge>
          </div>

          <div className="space-y-2">
            {tasks.map((t) => {
              const payload = (t.input_payload ?? {}) as Record<string, unknown>;
              const stepOrder = Number(payload.stepOrder ?? t.step_order ?? 1);
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-semibold">
                      #{stepOrder} • {t.title}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Target: {String(payload.estimatedOutput || "Artefak")} •
                      Dibuat:{" "}
                      {new Date(t.created_at).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <Badge
                    variant={t.status === "completed" ? "emerald" : "amber"}
                  >
                    {t.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ) : moduleKey === "publishing" ? (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-purple-400" />
              <h2 className="text-base font-semibold">
                Publishing Center — Checklist & Draf Rilis ({completedTasks.length})
              </h2>
            </div>
            <Badge variant="purple">Siap Kurasi Rilis</Badge>
          </div>

          <p className="text-xs text-slate-400">
            Salin atau siapkan catatan rilis per artefak yang sudah selesai
            sebelum dipublikasikan ke kanal tujuan.
          </p>

          <div className="space-y-3">
            {completedTasks.map((t) => {
              const out = (t.output_payload ?? {}) as Record<string, unknown>;
              const defaultText = String(
                out.contentMarkdown || out.summary || t.title
              );
              const noteVal = publishNotes[t.id] ?? defaultText;

              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{t.title}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(t.id, noteVal)}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-600/20 px-2.5 py-1 text-[11px] text-blue-300"
                    >
                      {copiedKey === t.id ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Salin Draf Rilis</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={noteVal}
                    onChange={(e) =>
                      setPublishNotes((prev) => ({
                        ...prev,
                        [t.id]: e.target.value,
                      }))
                    }
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-2.5 text-xs text-slate-200"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Analytics */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <BarChart3 className="h-4 w-4 text-blue-400" />
                <span>Total Input Tokens</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold">
                {totalInputTokens.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <BarChart3 className="h-4 w-4 text-purple-400" />
                <span>Total Output Tokens</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold">
                {totalOutputTokens.toLocaleString("id-ID")}
              </p>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <BarChart3 className="h-4 w-4 text-emerald-400" />
                <span>Tugas Completed</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold">
                {completedTasks.length} / {tasks.length}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-2.5">
            <h2 className="text-sm font-semibold">
              Log Penggunaan Model Terbaru ({usageLogs.length})
            </h2>
            {usageLogs.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada log penggunaan token untuk proyek ini.
              </p>
            ) : (
              <div className="space-y-2">
                {usageLogs.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-blue-300">
                      {String(u.provider_key || "provider")} •{" "}
                      {String(u.model_identifier || "model")}
                    </span>
                    <span className="text-slate-300">
                      In: {Number(u.input_tokens ?? 0)} | Out:{" "}
                      {Number(u.output_tokens ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
