"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CommandMessage,
  DbProject,
  DbTask,
  DbWorkflowRun,
  TaskStatus,
} from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Bot,
  CheckCircle2,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  User,
  AlertCircle,
  X,
  ListChecks,
  History,
  FolderOpen,
  Copy,
  Check,
  Download,
  BookmarkPlus,
  Trash2,
  Terminal,
  MessageSquare,
  Plus,
} from "lucide-react";

interface AttachmentRef {
  name: string;
  type: string;
  note?: string;
}

type WorkflowRunWithPlan = DbWorkflowRun & {
  plan_json?: Record<string, unknown> | null;
};

type TaskWithPayloads = DbTask & {
  workflow_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  progress?: number | null;
};

type WorkspaceMode = "chat" | "orchestrator";

function getPreferredModelForTask(task?: TaskWithPayloads): string | undefined {
  try {
    const rawPrefs = window.localStorage.getItem("denjeh_agent_model_prefs");
    if (!rawPrefs) return undefined;
    const parsed = JSON.parse(rawPrefs) as {
      mode?: string;
      perAgent?: Record<string, string>;
    };
    const agCode = String((task?.input_payload ?? {}).agentCode ?? "");
    if (parsed.mode === "manual" && agCode && parsed.perAgent?.[agCode]) {
      return parsed.perAgent[agCode];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function getPlanMeta(run: DbWorkflowRun): Record<string, unknown> {
  const raw = (run as WorkflowRunWithPlan).plan_json;
  return raw && typeof raw === "object" ? raw : {};
}

function formatTaskOutputText(
  t: TaskWithPayloads,
  out: Record<string, unknown>
): string {
  const summary = String(out.summary ?? "").trim();
  const contentMarkdown = String(out.contentMarkdown ?? "").trim();
  if (summary && contentMarkdown) {
    return `${summary}\n\n${contentMarkdown}`;
  }
  return summary || contentMarkdown || t.title;
}

function triggerMarkdownDownload(filename: string, markdown: string) {
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

export function CommandWorkspace() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"command" | "history">("command");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("chat");
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [mode, setMode] = useState<"manual" | "autonomous">("manual");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [messages, setMessages] = useState<CommandMessage[]>([]);
  const [historyRuns, setHistoryRuns] = useState<DbWorkflowRun[]>([]);
  const [dbTasks, setDbTasks] = useState<DbTask[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approvingRun, setApprovingRun] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [runningChain, setRunningChain] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [savingMemoryTaskId, setSavingMemoryTaskId] = useState<string | null>(
    null
  );
  const [savedMemoryTaskIds, setSavedMemoryTaskIds] = useState<
    Record<string, boolean>
  >({});
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  const loadHistoryAndTasks = useCallback(async (projectId: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

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
        .order("created_at", { ascending: false })
        .limit(50);

      if (projectId) {
        runsQuery = runsQuery.eq("project_id", projectId);
        tasksQuery = tasksQuery.eq("project_id", projectId);
      }

      const [{ data: runsData }, { data: tasksData }] = await Promise.all([
        runsQuery,
        tasksQuery,
      ]);

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

      setHistoryRuns((runsData as DbWorkflowRun[]) ?? []);
      setDbTasks(sortedTasks);
    } catch {
      // Abaikan jika gagal memuat riwayat awal
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
      }
    } catch {
      setIsLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (isLoggedIn) {
      loadHistoryAndTasks(selectedProject);
    }
  }, [selectedProject, isLoggedIn, loadHistoryAndTasks]);

  useEffect(() => {
    const initialQuery = searchParams.get("q");
    if (initialQuery) {
      setInput(initialQuery);
      setWorkspaceMode("orchestrator");
    }
  }, [searchParams]);

  const handleOpenHistoryRun = async (run: DbWorkflowRun) => {
    setActiveRunId(run.id);
    setActiveTab("command");
    setWorkspaceMode("orchestrator");
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("workflow_run_id", run.id);

    const runTasks = ((data as TaskWithPayloads[]) ?? []).sort((a, b) => {
      const aOrder = Number(
        (a.input_payload ?? {}).stepOrder ?? a.step_order ?? 0
      );
      const bOrder = Number(
        (b.input_payload ?? {}).stepOrder ?? b.step_order ?? 0
      );
      return aOrder - bOrder;
    });

    const planMeta = getPlanMeta(run);
    const firstPayload = (runTasks[0]?.input_payload ?? {}) as Record<
      string,
      unknown
    >;
    const runTitle = String(
      planMeta.title ||
        firstPayload.instruction ||
        runTasks[0]?.title ||
        `Workflow Run #${run.id.slice(0, 8)}`
    );

    const timeLabel = new Date(run.created_at).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isApproved =
      run.status === "running" ||
      run.status === "completed" ||
      runTasks.some((t) => t.status === "running" || t.status === "completed");

    const restoredMessages: CommandMessage[] = [
      {
        id: `hist-user-${run.id}`,
        sender: "user",
        timestamp: `${timeLabel} WIB`,
        mode: run.trigger_mode === "autonomous" ? "autonomous" : "manual",
        content: runTitle,
      },
      {
        id: `hist-orch-${run.id}`,
        sender: "orchestrator",
        timestamp: `${timeLabel} WIB`,
        mode: run.trigger_mode === "autonomous" ? "autonomous" : "manual",
        requiresApproval: run.trigger_mode === "manual",
        approved: isApproved,
        content: String(
          planMeta.intentSummary ||
            firstPayload.intentSummary ||
            `Riwayat rencana eksekusi (${runTasks.length} langkah) dipulihkan dari database.`
        ),
        plan: runTasks.map((t, idx) => {
          const payload = (t.input_payload ?? {}) as Record<string, unknown>;
          return {
            stepNumber: Number(payload.stepOrder ?? t.step_order ?? idx + 1),
            agentName: String(payload.agentName || payload.agentCode || t.title),
            action: String(payload.instruction || t.title),
            dependsOn: String(payload.dependsOn || "-"),
            estimatedOutput: String(
              payload.estimatedOutput || "Artefak Terstruktur"
            ),
          };
        }),
      },
    ];

    setMessages(restoredMessages);
  };

  const handleDeleteRun = async (runId: string) => {
    if (deletingRunId) return;
    setDeletingRunId(runId);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("tasks")
        .delete()
        .eq("workflow_run_id", runId)
        .eq("user_id", user.id);

      const { error } = await supabase
        .from("workflow_runs")
        .delete()
        .eq("id", runId)
        .eq("user_id", user.id);

      if (error) {
        setErrorMsg(error.message || "Gagal menghapus riwayat perintah.");
        return;
      }

      if (activeRunId === runId) {
        setActiveRunId(null);
        setMessages([]);
      }

      await loadHistoryAndTasks(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus riwayat."
      );
    } finally {
      setDeletingRunId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (deletingTaskId) return;
    setDeletingTaskId(taskId);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .eq("user_id", user.id);

      if (error) {
        setErrorMsg(error.message || "Gagal menghapus tugas.");
        return;
      }

      await loadHistoryAndTasks(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus tugas."
      );
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleApproveRun = async (msg: CommandMessage) => {
    if (!msg.plan || msg.plan.length === 0 || approvingRun) return;
    setApprovingRun(true);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();

      if (activeRunId) {
        await supabase
          .from("workflow_runs")
          .update({ status: "running" })
          .eq("id", activeRunId);

        const { data: runTasks } = await supabase
          .from("tasks")
          .select("id, status, input_payload")
          .eq("workflow_run_id", activeRunId);

        const sorted = ((runTasks as TaskWithPayloads[]) ?? []).sort((a, b) => {
          const aOrder = Number(
            (a.input_payload ?? {}).stepOrder ?? a.step_order ?? 0
          );
          const bOrder = Number(
            (b.input_payload ?? {}).stepOrder ?? b.step_order ?? 0
          );
          return aOrder - bOrder;
        });

        if (sorted.length > 0) {
          await supabase
            .from("tasks")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", sorted[0].id);

          if (sorted.length > 1) {
            await supabase
              .from("tasks")
              .update({ status: "pending" })
              .in(
                "id",
                sorted.slice(1).map((t) => t.id)
              );
          }
        }
      } else {
        const res = await fetch("/api/orchestrator/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProject || null,
            title: msg.content.slice(0, 120),
            mode: "autonomous",
            steps: msg.plan,
          }),
        });

        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          run?: { id: string };
        };

        if (!res.ok) {
          setErrorMsg(data.error ?? "Gagal menyetujui dan menyimpan rencana.");
          return;
        }

        if (data.run?.id) {
          setActiveRunId(data.run.id);
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, approved: true } : m))
      );
      await loadHistoryAndTasks(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyetujui rencana."
      );
    } finally {
      setApprovingRun(false);
    }
  };

  const handleRunTask = async (taskId: string) => {
    if (runningTaskId || runningChain) return;
    setRunningTaskId(taskId);
    setErrorMsg(null);

    try {
      const taskObj = (dbTasks as TaskWithPayloads[]).find(
        (item) => item.id === taskId
      );
      const preferredModel = getPreferredModelForTask(taskObj);

      const res = await fetch(`/api/orchestrator/tasks/${taskId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredModel }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Gagal mengeksekusi agen.");
        return;
      }
      await loadHistoryAndTasks(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Koneksi gagal saat menjalankan agen."
      );
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleRunChain = async () => {
    if (runningChain || runningTaskId) return;
    setRunningChain(true);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .neq("status", "completed");

      if (activeRunId) {
        query = query.eq("workflow_run_id", activeRunId);
      } else if (selectedProject) {
        query = query.eq("project_id", selectedProject);
      }

      const { data } = await query;
      const pendingTasks = ((data as TaskWithPayloads[]) ?? []).sort(
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

      for (const task of pendingTasks) {
        setRunningTaskId(task.id);
        const preferredModel = getPreferredModelForTask(task);
        const res = await fetch(`/api/orchestrator/tasks/${task.id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferredModel }),
        });
        const resultData = (await res.json()) as {
          ok?: boolean;
          error?: string;
        };

        await loadHistoryAndTasks(selectedProject);

        if (!res.ok) {
          setErrorMsg(
            resultData.error ??
              `Gagal menjalankan langkah #${Number(
                (task.input_payload ?? {}).stepOrder ?? 1
              )}: ${task.title}`
          );
          break;
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Terjadi kesalahan saat menjalankan antrean berantai."
      );
    } finally {
      setRunningTaskId(null);
      setRunningChain(false);
    }
  };

  const handleCopyTaskOutput = async (
    taskId: string,
    t: TaskWithPayloads,
    out: Record<string, unknown>
  ) => {
    const text = formatTaskOutputText(t, out);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTaskId(taskId);
      setTimeout(() => {
        setCopiedTaskId((prev) => (prev === taskId ? null : prev));
      }, 2000);
    } catch {
      setErrorMsg("Gagal menyalin teks ke clipboard.");
    }
  };

  const handleDownloadTaskOutput = (
    t: TaskWithPayloads,
    out: Record<string, unknown>
  ) => {
    const payload = (t.input_payload ?? {}) as Record<string, unknown>;
    const stepOrder = Number(payload.stepOrder ?? t.step_order ?? 1);
    const agentCode = String(payload.agentCode ?? "agent")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-");
    const markdown = `# Langkah #${stepOrder} — ${t.title}\n\n${formatTaskOutputText(
      t,
      out
    )}\n`;
    triggerMarkdownDownload(`step-${stepOrder}-${agentCode}.md`, markdown);
  };

  const handleSaveTaskToMemory = async (
    t: TaskWithPayloads,
    out: Record<string, unknown>
  ) => {
    if (savingMemoryTaskId) return;
    setSavingMemoryTaskId(t.id);
    setErrorMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErrorMsg("Sesi tidak valid. Silakan login ulang.");
        return;
      }

      const payload = (t.input_payload ?? {}) as Record<string, unknown>;
      const stepOrder = Number(payload.stepOrder ?? t.step_order ?? 1);
      const agentCode = String(payload.agentCode ?? "agent")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "_");
      const content = formatTaskOutputText(t, out).slice(0, 3500);

      const { error } = await supabase.from("memories").insert({
        user_id: user.id,
        project_id: t.project_id || selectedProject || null,
        scope: "project",
        memory_key: `step_${stepOrder}_${agentCode}_${t.id.slice(0, 6)}`,
        content,
        importance: 7,
      });

      if (error) {
        setErrorMsg(error.message || "Gagal menyimpan hasil agen ke memori.");
        return;
      }

      setSavedMemoryTaskIds((prev) => ({ ...prev, [t.id]: true }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan hasil agen ke memori proyek."
      );
    } finally {
      setSavingMemoryTaskId(null);
    }
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const added: AttachmentRef[] = Array.from(files).map((f) => ({
      name: f.name,
      type: f.type || "file",
      note: `Ukuran ${(f.size / 1024).toFixed(1)} KB`,
    }));
    setAttachments((prev) => [...prev, ...added]);
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSendCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    setErrorMsg(null);
    setSubmitting(true);
    setActiveTab("command");

    const nowLabel = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const userMsg: CommandMessage = {
      id: `msg-${Date.now()}`,
      sender: "user",
      timestamp: `${nowLabel} WIB`,
      mode,
      content:
        attachments.length > 0
          ? `${trimmed}\n[Lampiran: ${attachments.map((a) => a.name).join(", ")}]`
          : trimmed,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");

    try {
      if (workspaceMode === "chat") {
        const chatHistory = nextMessages.slice(-12).map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.content,
        }));

        const res = await fetch("/api/command/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedProject || undefined,
            message: trimmed,
            messages: chatHistory,
            attachments,
          }),
        });

        const data = (await res.json()) as {
          ok?: boolean;
          reply?: string;
          content?: string;
          modelUsed?: string;
          providerUsed?: string;
          error?: string;
        };

        if (!res.ok) {
          setErrorMsg(
            data.error ??
              "Endpoint /api/command/chat belum tersedia atau gagal merespons."
          );
          setSubmitting(false);
          return;
        }

        const replyText =
          data.reply ||
          data.content ||
          "Siap, ada yang ingin kita bahas atau eksplorasi lebih lanjut?";

        const assistantMsg: CommandMessage = {
          id: `msg-${Date.now() + 1}`,
          sender: "orchestrator",
          timestamp: `${nowLabel} WIB`,
          mode,
          requiresApproval: false,
          approved: true,
          content:
            data.modelUsed || data.providerUsed
              ? `${replyText}\n\n— ${data.modelUsed ?? "AI"} ${
                  data.providerUsed ? `(${data.providerUsed})` : ""
                }`
              : replyText,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setAttachments([]);
        return;
      }

      const lastOrchestratorMsg = [...messages]
        .reverse()
        .find((m) => m.sender === "orchestrator" && m.plan);

      const previousPlanSummary = lastOrchestratorMsg
        ? `${lastOrchestratorMsg.content}\nLangkah sebelumnya: ${lastOrchestratorMsg.plan
            ?.map((s) => `${s.stepNumber}. ${s.agentName}: ${s.action}`)
            .join("; ")}`
        : undefined;

      const res = await fetch("/api/command/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject || undefined,
          instruction: trimmed,
          mode,
          attachments,
          previousPlanSummary,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        loadedMemoryCount?: number;
        savedRunId?: string | null;
        planResult?: {
          intentSummary: string;
          steps: {
            stepNumber: number;
            agentCode: string;
            agentName: string;
            action: string;
            dependsOn: string;
            estimatedOutput: string;
          }[];
          providerUsed: string;
          modelUsed: string;
        };
      };

      if (!res.ok || !data.planResult) {
        setErrorMsg(
          data.error ?? "Gagal memproses instruksi di Master Orchestrator."
        );
        setSubmitting(false);
        return;
      }

      if (data.savedRunId) {
        setActiveRunId(data.savedRunId);
      }

      const orchestratorMsg: CommandMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: "orchestrator",
        timestamp: `${nowLabel} WIB`,
        mode,
        requiresApproval: mode === "manual",
        approved: mode === "autonomous",
        content: `${data.planResult.intentSummary} (Model: ${data.planResult.modelUsed} via ${data.planResult.providerUsed} • ${data.loadedMemoryCount ?? 0} memori proyek dimuat)`,
        plan: data.planResult.steps,
      };

      setMessages((prev) => [...prev, orchestratorMsg]);
      setAttachments([]);
      await loadHistoryAndTasks(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Koneksi ke server gagal."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateTaskStatus = async (
    taskId: string,
    nextStatus: TaskStatus
  ) => {
    try {
      const res = await fetch(`/api/orchestrator/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        await loadHistoryAndTasks(selectedProject);
      }
    } catch {
      // Abaikan error sesaat
    }
  };

  const handleRequestRevision = (stepTitle: string) => {
    setWorkspaceMode("orchestrator");
    setInput(`Revisi bagian "${stepTitle}": `);
  };

  const typedDbTasks = dbTasks as TaskWithPayloads[];
  const visibleTasks = activeRunId
    ? typedDbTasks.filter((t) => t.workflow_run_id === activeRunId)
    : typedDbTasks;

  const activeProjectObj = projects.find((p) => p.id === selectedProject);

  const handleExportAllPackage = () => {
    const completedItems = visibleTasks.filter((t) => t.status === "completed");
    if (completedItems.length === 0) return;

    const projectName = activeProjectObj?.name || "Proyek DNAverse";
    const lines = completedItems.map((t) => {
      const payload = (t.input_payload ?? {}) as Record<string, unknown>;
      const out = (t.output_payload ?? {}) as Record<string, unknown>;
      const stepOrder = Number(payload.stepOrder ?? t.step_order ?? 1);
      return `## Langkah #${stepOrder} — ${t.title}\n\n${formatTaskOutputText(
        t,
        out
      )}`;
    });

    const slug = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-|-$/g, "");
    triggerMarkdownDownload(
      `${slug || "dnaverse"}-paket-agen.md`,
      `# Paket Artefak Multi-Agen: ${projectName}\n\n${lines.join(
        "\n\n---\n\n"
      )}\n`
    );
  };

  return (
    <div className="space-y-4">
      {isLoggedIn === false && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Anda belum login. Silakan masuk terlebih dahulu agar Command Center
            dapat mengakses proyek, memori, dan API key Anda.
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
          <div className="space-y-1">
            <p className="font-semibold">Gagal Memproses Permintaan</p>
            <p>{errorMsg}</p>
            <Link
              href="/providers"
              className="inline-block underline text-blue-400"
            >
              Periksa pengaturan AI Provider Manager →
            </Link>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-studio-border bg-slate-100 dark:bg-studio-navy p-1">
            <button
              type="button"
              onClick={() => setActiveTab("command")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "command"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Workspace</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "history"
                  ? "bg-purple-600 text-white"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>History ({historyRuns.length})</span>
            </button>
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 dark:border-studio-border bg-slate-100 dark:bg-studio-navy p-1">
            <button
              type="button"
              onClick={() => setWorkspaceMode("chat")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                workspaceMode === "chat"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Obrolan Santai</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode("orchestrator")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                workspaceMode === "orchestrator"
                  ? "bg-purple-600 text-white"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>Orchestrator (DAG)</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" />
            <span>Proyek:</span>
          </div>
          <select
            value={selectedProject}
            onChange={(e) => {
              setSelectedProject(e.target.value);
              setMessages([]);
              setActiveRunId(null);
            }}
            aria-label="Pilih Proyek"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium focus:border-blue-500 focus:outline-none"
          >
            {projects.length === 0 ? (
              <option value="">Belum ada proyek (Buat di /projects)</option>
            ) : (
              projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setActiveRunId(null);
                setErrorMsg(null);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-studio-border bg-slate-100 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500/40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Obrolan Baru</span>
            </button>
          )}

          {workspaceMode === "orchestrator" && (
            <>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Eksekusi:
              </span>
              <div className="inline-flex rounded-xl border border-slate-200 dark:border-studio-border bg-slate-100 dark:bg-studio-navy p-1">
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    mode === "manual"
                      ? "bg-blue-600 text-white"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setMode("autonomous")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    mode === "autonomous"
                      ? "bg-purple-600 text-white"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Autonomous
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {activeTab === "history" ? (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-purple-400" />
              <h2 className="text-base font-semibold">
                Riwayat Perintah Proyek ({historyRuns.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("command")}
              className="text-xs font-medium text-blue-400 hover:underline"
            >
              Kembali ke Workspace →
            </button>
          </div>

          {historyRuns.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Belum ada riwayat perintah tersimpan untuk proyek ini.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {historyRuns.map((run) => {
                const planMeta = getPlanMeta(run);
                const stepsArr = Array.isArray(planMeta.steps)
                  ? planMeta.steps
                  : [];
                const stepCount =
                  stepsArr.length > 0
                    ? stepsArr.length
                    : Number(planMeta.totalSteps || run.total_steps || 0);
                const labelTitle = String(
                  planMeta.title ||
                    run.title ||
                    `Workflow Run #${run.id.slice(0, 8)}`
                );

                return (
                  <div
                    key={run.id}
                    className={`rounded-xl border p-3 transition flex items-start justify-between gap-2 ${
                      activeRunId === run.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/70 hover:border-blue-500/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenHistoryRun(run)}
                      className="text-left min-w-0 flex-1"
                    >
                      <p className="text-xs font-medium truncate">{labelTitle}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {stepCount} langkah •{" "}
                        {new Date(run.created_at).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant={
                          run.status === "completed"
                            ? "emerald"
                            : run.status === "running"
                            ? "blue"
                            : "amber"
                        }
                      >
                        {run.status === "waiting_approval"
                          ? "Draf"
                          : run.status}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => handleOpenHistoryRun(run)}
                        aria-label="Buka riwayat"
                        className="rounded-lg border border-slate-600/40 bg-slate-800/70 p-1 text-slate-300 hover:bg-slate-700/70"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={deletingRunId === run.id}
                        onClick={() => handleDeleteRun(run.id)}
                        aria-label="Hapus riwayat perintah"
                        className="rounded-lg border border-rose-500/30 bg-rose-600/20 p-1 text-rose-300 hover:bg-rose-600/30 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-5 min-h-[260px] max-h-[54vh] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="py-8 text-center space-y-3 max-w-xl mx-auto">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  {workspaceMode === "chat" ? (
                    <MessageSquare className="h-6 w-6" />
                  ) : (
                    <Bot className="h-6 w-6" />
                  )}
                </div>
                <h3 className="text-base font-semibold">
                  {workspaceMode === "chat"
                    ? "Ngobrol Santai & Tanya-Jawab"
                    : "Master Orchestrator Siap"}
                </h3>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {workspaceMode === "chat"
                    ? "Tanya apa saja, lempar ide adegan atau fitur, atau diskusi santai dua arah seperti di Gemini/ChatGPT. Kalau siap eksekusi berantai, tinggal pindah ke mode Orchestrator (DAG)."
                    : "Riwayat perintah tersimpan rapi di tab History. Susun rencana DAG multi-agen untuk mengeksekusi tugas secara terstruktur."}
                </p>

                {workspaceMode === "chat" ? (
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setInput(
                          "Halo, lagi mikirin hook pembuka buat konten DNAverse — The Awakening. Menurutmu enaknya mulai dari mana?"
                        )
                      }
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Brainstorming Hook Konten
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setInput(
                          "Coba jelaskan perbedaan alur posting teks vs foto di Facebook Page dengan bahasa santai."
                        )
                      }
                      className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20"
                    >
                      Tanya-Jawab Alur Posting
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setInput(
                        "Buat film pendek live-action fantasy action 60 detik untuk DNAverse. Kembangkan cerita, profil karakter, storyboard, arahan visual, prompt video yang dibagi menjadi klip 10-15 detik, caption media sosial, serta saran jadwal publikasi."
                      )
                    }
                    className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3.5 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/20"
                  >
                    Gunakan Contoh Perintah DNAverse 60 Detik
                  </button>
                )}
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.sender === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      msg.sender === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-purple-600/20 text-purple-400 border border-purple-500/30"
                    }`}
                  >
                    {msg.sender === "user" ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>

                  <div
                    className={`flex-1 max-w-3xl rounded-2xl p-4 ${
                      msg.sender === "user"
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] opacity-80">
                      <span className="font-semibold">
                        {msg.sender === "user"
                          ? "Anda"
                          : workspaceMode === "chat"
                          ? "Asisten DENJEH"
                          : "Master Orchestrator"}
                      </span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-line">
                      {msg.content}
                    </p>

                    {msg.plan && (
                      <div className="mt-4 space-y-2 border-t border-slate-200 dark:border-studio-border pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-blue-500 dark:text-blue-400">
                            Rencana Eksekusi Multi-Agen (JSON DAG)
                          </span>
                          <Badge variant={msg.approved ? "emerald" : "amber"}>
                            {msg.approved
                              ? "Disetujui & Berjalan"
                              : "Draf Tersimpan"}
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          {msg.plan.map((step) => (
                            <div
                              key={step.stepNumber}
                              className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-white dark:bg-studio-card p-3 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1 font-semibold">
                                <span>
                                  #{step.stepNumber} • {step.agentName}
                                </span>
                                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                  Dependensi: {step.dependsOn}
                                </span>
                              </div>
                              <p className="mt-1 text-slate-600 dark:text-slate-300">
                                {step.action}
                              </p>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-purple-500 dark:text-purple-400">
                                  Output: {step.estimatedOutput}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRequestRevision(step.agentName)
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-blue-400"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Revisi Langkah</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {msg.requiresApproval && !msg.approved && (
                          <div className="pt-2 flex justify-end">
                            <button
                              type="button"
                              disabled={approvingRun}
                              onClick={() => handleApproveRun(msg)}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>
                                {approvingRun
                                  ? "Menyetujui..."
                                  : "Setujui & Jalankan Antrean Tugas"}
                              </span>
                            </button>
                          </div>
                        )}

                        {msg.approved && (
                          <div className="pt-1 flex items-center gap-1.5 text-xs text-emerald-500">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>
                              Rencana disetujui dan siap dijalankan oleh
                              Multi-Agent System.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <span
                  key={`${att.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-400"
                >
                  <span>{att.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    aria-label="Hapus lampiran"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSendCommand}
            className="glass-panel rounded-2xl p-3 sm:p-4 space-y-2.5"
          >
            <textarea
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendCommand();
                }
              }}
              placeholder={
                workspaceMode === "chat"
                  ? "Ngobrol santai atau tanya apa saja... (Enter untuk kirim, Shift+Enter baris baru)"
                  : "Tulis instruksi kreatif atau permintaan revisi lanjutan ke Master Orchestrator..."
              }
              className="w-full resize-none rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-blue-500/40">
                <Paperclip className="h-3.5 w-3.5 text-blue-500" />
                <span>Lampirkan File / Referensi Gambar</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.md,.json"
                  onChange={handleFileAttach}
                  className="hidden"
                />
              </label>

              <button
                type="submit"
                disabled={submitting || !input.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                <span>
                  {submitting
                    ? workspaceMode === "chat"
                      ? "Membalas..."
                      : "Menyusun Rencana..."
                    : workspaceMode === "chat"
                    ? "Kirim Pesan"
                    : "Kirim Instruksi"}
                </span>
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>

          {workspaceMode === "orchestrator" &&
            isLoggedIn &&
            visibleTasks.length > 0 && (
              <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-5 w-5 text-emerald-400" />
                    <h2 className="text-base font-semibold">
                      Antrean Tugas Orkestrasi ({visibleTasks.length})
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {visibleTasks.some((t) => t.status === "completed") && (
                      <button
                        type="button"
                        onClick={handleExportAllPackage}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/15 px-3 py-1 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/25"
                      >
                        <Download className="h-3 w-3" />
                        <span>Ekspor Paket .md</span>
                      </button>
                    )}
                    {visibleTasks.some((t) => t.status !== "completed") && (
                      <button
                        type="button"
                        disabled={runningChain || Boolean(runningTaskId)}
                        onClick={handleRunChain}
                        className="rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:opacity-95 disabled:opacity-50"
                      >
                        {runningChain
                          ? "Menjalankan Berantai..."
                          : "Jalankan Berantai"}
                      </button>
                    )}
                    <Badge variant="emerald">Tersimpan di PostgreSQL</Badge>
                  </div>
                </div>

                <div className="space-y-2">
                  {visibleTasks.map((t) => {
                    const payload = (t.input_payload ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const out = (t.output_payload ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const stepOrder = Number(
                      payload.stepOrder ?? t.step_order ?? 1
                    );
                    const instructionText = String(
                      payload.instruction ?? t.instruction ?? ""
                    );
                    const isRunningThis = runningTaskId === t.id;
                    const isCopiedThis = copiedTaskId === t.id;
                    const isSavingMemThis = savingMemoryTaskId === t.id;
                    const isSavedMemThis = Boolean(savedMemoryTaskIds[t.id]);

                    return (
                      <div
                        key={t.id}
                        className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3 space-y-2 text-xs"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 font-semibold">
                              <span>
                                #{stepOrder} • {t.title}
                              </span>
                              <Badge
                                variant={
                                  t.status === "completed"
                                    ? "emerald"
                                    : t.status === "running"
                                    ? "blue"
                                    : t.status === "failed"
                                    ? "rose"
                                    : "amber"
                                }
                              >
                                {t.status}
                              </Badge>
                              <span className="text-[11px] font-normal text-slate-400">
                                {t.progress ?? 0}%
                              </span>
                            </div>
                            <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                              {instructionText}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
                            {t.status !== "completed" && (
                              <button
                                type="button"
                                disabled={isRunningThis || runningChain}
                                onClick={() => handleRunTask(t.id)}
                                className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-2.5 py-1 text-[11px] font-medium text-purple-300 hover:bg-purple-600/30 disabled:opacity-50"
                              >
                                {isRunningThis
                                  ? "Menjalankan..."
                                  : "Jalankan Agen"}
                              </button>
                            )}
                            {t.status !== "running" &&
                              t.status !== "completed" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateTaskStatus(t.id, "running")
                                  }
                                  className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-2.5 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-600/30"
                                >
                                  Mulai
                                </button>
                              )}
                            {t.status !== "completed" && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleUpdateTaskStatus(t.id, "completed")
                                }
                                className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-600/30"
                              >
                                Selesai
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={deletingTaskId === t.id}
                              onClick={() => handleDeleteTask(t.id)}
                              aria-label="Hapus tugas"
                              className="rounded-lg bg-rose-600/20 border border-rose-500/30 p-1 text-rose-300 hover:bg-rose-600/30 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {t.status === "completed" &&
                          Boolean(out.summary || out.contentMarkdown) && (
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-2">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyTaskOutput(t.id, t, out)
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-600/40 bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/70"
                                >
                                  {isCopiedThis ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-400" />
                                      <span>Tersalin</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3 text-blue-400" />
                                      <span>Salin</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadTaskOutput(t, out)
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-600/40 bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/70"
                                >
                                  <Download className="h-3 w-3 text-purple-400" />
                                  <span>Unduh .md</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isSavingMemThis || isSavedMemThis}
                                  onClick={() =>
                                    handleSaveTaskToMemory(t, out)
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-600/20 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-60"
                                >
                                  <BookmarkPlus className="h-3 w-3" />
                                  <span>
                                    {isSavedMemThis
                                      ? "Tersimpan di Memori"
                                      : isSavingMemThis
                                      ? "Menyimpan..."
                                      : "Simpan ke Memori"}
                                  </span>
                                </button>
                              </div>

                              {Boolean(out.summary) && (
                                <p className="font-medium text-emerald-300">
                                  {String(out.summary)}
                                </p>
                              )}
                              {Boolean(out.contentMarkdown) && (
                                <p className="whitespace-pre-line text-slate-300 leading-relaxed">
                                  {String(out.contentMarkdown)}
                                </p>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </>
      )}
    </div>
  );
}
