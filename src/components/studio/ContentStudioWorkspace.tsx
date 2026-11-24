"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbProject, DbTask, DbWorkflowRun } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Sparkles,
  SlidersHorizontal,
  Copy,
  Check,
  Download,
  BookmarkPlus,
  AlertCircle,
  Layers,
  Film,
  FileText,
} from "lucide-react";

type TaskWithPayloads = DbTask & {
  workflow_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  progress?: number | null;
};

type WorkflowRunWithPlan = DbWorkflowRun & {
  plan_json?: Record<string, unknown> | null;
};

interface PromptCardItem {
  id: string;
  taskId: string;
  projectId: string | null;
  workflowRunId: string | null;
  stepOrder: number;
  clipNumber?: number;
  isClipMaster: boolean;
  badgeLabel: string;
  title: string;
  subtitle: string;
  promptText: string;
}

function getAgentCode(task: TaskWithPayloads): string {
  const payload = (task.input_payload ?? {}) as Record<string, unknown>;
  const out = (task.output_payload ?? {}) as Record<string, unknown>;
  return String(
    payload.agentCode || out.agentCode || task.agent_code || ""
  )
    .toLowerCase()
    .trim();
}

function extractClipTitle(promptText: string, fallbackIndex: number): string {
  const sceneMatch = promptText.match(/SCENE\s*\d+\s*:\s*(.+)/i);
  const durationMatch = promptText.match(/DURATION\s*:\s*(.+)/i);
  if (sceneMatch) {
    const sceneLabel = sceneMatch[1].trim();
    const durLabel = durationMatch ? ` (${durationMatch[1].trim()})` : "";
    return `Scene ${String(fallbackIndex).padStart(2, "0")}: ${sceneLabel}${durLabel}`;
  }
  return `Clip #${String(fallbackIndex).padStart(2, "0")} — Master Prompt`;
}

function expandTaskToPromptCards(task: TaskWithPayloads): PromptCardItem[] {
  const payload = (task.input_payload ?? {}) as Record<string, unknown>;
  const out = (task.output_payload ?? {}) as Record<string, unknown>;
  const stepOrder = Number(payload.stepOrder ?? task.step_order ?? 1);
  const code = getAgentCode(task);
  const agentName = String(payload.agentName || payload.agentCode || "Agent");
  const rawSteps = Array.isArray(out.steps)
    ? (out.steps as Record<string, unknown>[])
    : [];

  if (code === "video" && rawSteps.length > 0) {
    return rawSteps.map((s, idx) => {
      const clipNum = Number(s.stepNumber ?? idx + 1);
      const actionText = String(s.action ?? "").trim();
      return {
        id: `${task.id}-clip-${clipNum}-${idx}`,
        taskId: task.id,
        projectId: task.project_id ?? null,
        workflowRunId: task.workflow_run_id ?? null,
        stepOrder,
        clipNumber: clipNum,
        isClipMaster: true,
        badgeLabel: `Clip #${String(clipNum).padStart(2, "0")} • Master Prompt`,
        title: extractClipTitle(actionText, clipNum),
        subtitle: String(out.summary ?? task.title),
        promptText: actionText,
      };
    });
  }

  const summary = String(out.summary ?? "").trim();
  const contentMarkdown = String(out.contentMarkdown ?? "").trim();
  const body =
    contentMarkdown && summary && contentMarkdown !== summary
      ? `${summary}\n\n${contentMarkdown}`
      : contentMarkdown || summary || task.title;

  return [
    {
      id: task.id,
      taskId: task.id,
      projectId: task.project_id ?? null,
      workflowRunId: task.workflow_run_id ?? null,
      stepOrder,
      isClipMaster: code === "video",
      badgeLabel: code === "video" ? "Master Prompt Klip" : agentName,
      title: `#${stepOrder} • ${task.title}`,
      subtitle: String(payload.instruction ?? ""),
      promptText: body,
    },
  ];
}

function downloadMdFile(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ContentStudioWorkspace() {
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [runs, setRuns] = useState<DbWorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("all");
  const [tasks, setTasks] = useState<TaskWithPayloads[]>([]);
  const [promptCategory, setPromptCategory] = useState<
    "all" | "clip_master" | "creative_prompt"
  >("clip_master");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingMemId, setSavingMemId] = useState<string | null>(null);
  const [savedMemIds, setSavedMemIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadStudioData = useCallback(async (projectId: string) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsLoggedIn(false);
        setLoading(false);
        return;
      }

      setIsLoggedIn(true);

      let runsQuery = supabase
        .from("workflow_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      let tasksQuery = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(80);

      if (projectId) {
        runsQuery = runsQuery.eq("project_id", projectId);
        tasksQuery = tasksQuery.eq("project_id", projectId);
      }

      const [
        { data: runsData, error: runsErr },
        { data: tasksData, error: tasksErr },
      ] = await Promise.all([runsQuery, tasksQuery]);

      if (runsErr) {
        setErrorMsg(runsErr.message);
      }
      if (tasksErr) {
        setErrorMsg(tasksErr.message);
      }

      const sortedTasks = ((tasksData as TaskWithPayloads[]) ?? []).sort(
        (a, b) => {
          const aOrder = Number(
            (a.input_payload ?? {}).stepOrder ?? a.step_order ?? 0
          );
          const bOrder = Number(
            (b.input_payload ?? {}).stepOrder ?? b.step_order ?? 0
          );
          return aOrder - bOrder;
        }
      );

      setRuns((runsData as DbWorkflowRun[]) ?? []);
      setTasks(sortedTasks);
      setSelectedRunId("all");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data Content Studio."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsLoggedIn(false);
        setLoading(false);
        return;
      }

      setIsLoggedIn(true);
      const { data } = await supabase
        .from("projects")
        .select("*")
        .neq("status", "archived")
        .order("updated_at", { ascending: false });

      const rows = (data as DbProject[]) ?? [];
      setProjects(rows);

      if (rows.length > 0) {
        setSelectedProject((prev) => prev || rows[0].id);
      } else {
        setLoading(false);
      }
    } catch {
      setIsLoggedIn(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (isLoggedIn) {
      loadStudioData(selectedProject);
    }
  }, [selectedProject, isLoggedIn, loadStudioData]);

  // Content Studio hanya menampilkan prompt (mengecualikan agen distribusi/audit)
  const promptOnlyTasks = tasks.filter((t) => {
    const code = getAgentCode(t);
    return !["marketing", "publishing", "quality"].includes(code);
  });

  const allCards = promptOnlyTasks.flatMap(expandTaskToPromptCards);

  const clipMasterCards = allCards.filter((c) => c.isClipMaster);
  const creativePromptCards = allCards.filter((c) => !c.isClipMaster);

  const filteredPrompts = allCards.filter((c) => {
    if (selectedRunId !== "all" && c.workflowRunId !== selectedRunId) {
      return false;
    }
    if (promptCategory === "clip_master" && !c.isClipMaster) {
      return false;
    }
    if (promptCategory === "creative_prompt" && c.isClipMaster) {
      return false;
    }
    return true;
  });

  const handleCopy = async (card: PromptCardItem) => {
    try {
      await navigator.clipboard.writeText(card.promptText);
      setCopiedId(card.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === card.id ? null : prev));
      }, 2000);
    } catch {
      setErrorMsg("Gagal menyalin master prompt ke clipboard.");
    }
  };

  const handleDownloadOne = (card: PromptCardItem) => {
    const slug = card.clipNumber
      ? `clip-${String(card.clipNumber).padStart(2, "0")}-master-prompt`
      : `step-${card.stepOrder}-prompt`;
    downloadMdFile(`${slug}.md`, `# ${card.title}\n\n${card.promptText}\n`);
  };

  const handleSaveToMemory = async (card: PromptCardItem) => {
    if (savingMemId) return;
    setSavingMemId(card.id);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const memKey = card.clipNumber
        ? `clip_${String(card.clipNumber).padStart(2, "0")}_master_${card.taskId.slice(0, 6)}`
        : `prompt_${card.stepOrder}_${card.taskId.slice(0, 6)}`;

      const { error } = await supabase.from("memories").insert({
        user_id: user.id,
        project_id: card.projectId || selectedProject || null,
        scope: "project",
        memory_key: memKey,
        content: card.promptText.slice(0, 3500),
        importance: 8,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setSavedMemIds((prev) => ({ ...prev, [card.id]: true }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyimpan ke memori."
      );
    } finally {
      setSavingMemId(null);
    }
  };

  const handleExportCompilation = () => {
    if (filteredPrompts.length === 0) return;
    const activeProj = projects.find((p) => p.id === selectedProject);
    const projTitle = activeProj?.name || "Proyek";
    const sections = filteredPrompts.map(
      (c) => `## ${c.title}\n\n${c.promptText}`
    );

    downloadMdFile(
      "content-studio-master-prompts.md",
      `# Master Prompt Katalog — ${projTitle}\n\n${sections.join(
        "\n\n---\n\n"
      )}\n`
    );
  };

  return (
    <div className="space-y-4">
      {isLoggedIn === false && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Anda belum login. Silakan masuk untuk melihat daftar Master Prompt
            per klip di Content Studio.
          </span>
          <Link
            href="/login"
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950"
          >
            Masuk
          </Link>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{errorMsg}</p>
        </div>
      )}

      {/* Filter Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-purple-400" />
            <span>Proyek:</span>
          </div>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="Pilih Proyek Content Studio"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium focus:border-blue-500 focus:outline-none"
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

          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            aria-label="Filter Riwayat Run"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium focus:border-blue-500 focus:outline-none"
          >
            <option value="all">Semua Sesi Run ({runs.length})</option>
            {runs.map((r) => {
              const meta = (r as WorkflowRunWithPlan).plan_json ?? {};
              const title = String(
                meta.title || r.title || `Run #${r.id.slice(0, 8)}`
              );
              return (
                <option key={r.id} value={r.id}>
                  {title.slice(0, 50)}
                </option>
              );
            })}
          </select>

          <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900/80 p-1 text-xs">
            <button
              type="button"
              onClick={() => setPromptCategory("clip_master")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                promptCategory === "clip_master"
                  ? "bg-purple-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Master Prompt Klip ({clipMasterCards.length})
            </button>
            <button
              type="button"
              onClick={() => setPromptCategory("creative_prompt")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                promptCategory === "creative_prompt"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Prompt Dasar ({creativePromptCards.length})
            </button>
            <button
              type="button"
              onClick={() => setPromptCategory("all")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                promptCategory === "all"
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Semua ({allCards.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filteredPrompts.length > 0 && (
            <button
              type="button"
              onClick={handleExportCompilation}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-95"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Unduh Semua (.md)</span>
            </button>
          )}
          <Link
            href="/command-center"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium text-blue-400 hover:border-blue-500/40"
          >
            Buka Command Center →
          </Link>
        </div>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Film className="h-4 w-4 text-purple-400" />
            <span>Master Prompt Per Klip</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold">{clipMasterCards.length}</p>
        </div>
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <FileText className="h-4 w-4 text-emerald-400" />
            <span>Prompt Cerita / Karakter / Visual</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold">
            {creativePromptCards.length}
          </p>
        </div>
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Layers className="h-4 w-4 text-blue-400" />
            <span>Total Kartu Ditampilkan</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold">{filteredPrompts.length}</p>
        </div>
      </div>

      {/* Katalog Master Prompt Utuh */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-base font-semibold">
              Katalog Master Prompt Utuh Per Klip ({filteredPrompts.length})
            </h2>
          </div>
          <Badge variant="purple">1 Master Prompt Utuh / Klip</Badge>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-6">Memuat daftar prompt...</p>
        ) : filteredPrompts.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-xs text-slate-400">
              Belum ada Master Prompt klip selesai untuk filter yang dipilih.
            </p>
            <Link
              href="/command-center"
              className="inline-block text-xs text-blue-400 hover:underline"
            >
              Jalankan Video Agent di AI Command Center terlebih dahulu →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPrompts.map((card) => {
              const isCopied = copiedId === card.id;
              const isSaving = savingMemId === card.id;
              const isSaved = Boolean(savedMemIds[card.id]);

              return (
                <div
                  key={card.id}
                  className="rounded-2xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 space-y-2.5 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        <span className="text-sm">{card.title}</span>
                        <Badge variant={card.isClipMaster ? "purple" : "blue"}>
                          {card.badgeLabel}
                        </Badge>
                      </div>
                      {card.subtitle && (
                        <p className="text-[11px] text-slate-400">
                          {card.subtitle}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(card)}
                        className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-600/20 px-2.5 py-1 text-[11px] font-medium text-purple-200 hover:bg-purple-600/30"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>Master Prompt Tersalin</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-purple-300" />
                            <span>Salin Master Prompt</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadOne(card)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                      >
                        <Download className="h-3 w-3 text-blue-400" />
                        <span>.md</span>
                      </button>
                      <button
                        type="button"
                        disabled={isSaving || isSaved}
                        onClick={() => handleSaveToMemory(card)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-60"
                      >
                        <BookmarkPlus className="h-3 w-3" />
                        <span>
                          {isSaved
                            ? "Di Memori"
                            : isSaving
                            ? "Menyimpan..."
                            : "Simpan ke Memori"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <pre className="rounded-xl border border-slate-700/50 bg-slate-950/75 p-3.5 whitespace-pre-wrap font-mono text-[11px] text-slate-200 leading-relaxed overflow-x-auto">
                    {card.promptText}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
