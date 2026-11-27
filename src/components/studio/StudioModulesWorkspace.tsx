"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbAiModel, DbProject, DbTask, DbWorkflowRun } from "@/types/studio";
import {
  MULTI_AGENT_SPECIALISTS,
  AGENT_TOOL_REGISTRY,
} from "@/lib/ai/agent-tools";
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
  X,
  ArrowUpRight,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Download,
} from "lucide-react";

export type StudioModuleKey =
  | "agents"
  | "workflows"
  | "planner"
  | "publishing"
  | "analytics";

export type FormatTabKey = "text" | "photo" | "video";

export type DivisionFilterKey = "all" | "text" | "photo" | "story" | "reels";

export type DailySlotKind = "story" | "photo" | "text" | "reels";
export type DailySlotCheckStatus = "pending" | "success" | "failed";

export interface DailyScheduleSlot {
  id: string;
  dateCode: string;
  dateLabel: string;
  timeLabel: string;
  kind: DailySlotKind;
  title: string;
  caption: string;
  mediaUrl?: string;
  status: DailySlotCheckStatus;
  statusNote?: string;
  lastRunAt?: string;
}

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
  checkpoint_state?: Record<string, unknown> | null;
};

type WorkflowRunWithPlan = DbWorkflowRun & {
  plan_json?: Record<string, unknown> | null;
};

interface WorkflowMasterPromptItem {
  id: string;
  taskId: string;
  workflowRunId: string | null;
  stepOrder: number;
  clipNumber?: number;
  isClipMaster: boolean;
  badgeLabel: string;
  title: string;
  subtitle: string;
  promptText: string;
}

interface AgentModelPrefs {
  mode: "auto" | "manual";
  perAgent: Record<string, string>;
}

const STORAGE_KEY = "denjeh_agent_model_prefs";

const FALLBACK_MODEL_OPTIONS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile (Groq)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Groq)" },
];

function getDateCodeWib(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = parts.find((p) => p.type === "year")?.value ?? "26";
  return `${day}${month}${year}`;
}

function formatDateLabelWib(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getCurrentWibMinutes(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function sanitizeCaptionText(raw: string, fallbackTitle: string): string {
  let text = raw.trim();

  const jsonMatch = text.match(
    /\{[\s\S]*"message"\s*:\s*"([\s\S]*?)"[\s\S]*\}/
  );
  if (jsonMatch?.[1]) {
    text = jsonMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  const cleaned = text
    .replace(/^\d+\.\s*Prepare Facebook Page payload:\s*/i, "")
    .replace(/["']?accessToken["']?\s*:\s*["'][^"']*["']?,?/gi, "")
    .replace(/access_token\s*=\s*[^\s&"']+/gi, "")
    .replace(/EAA[A-Za-z0-9_-]{15,}/g, "")
    .replace(
      /\d+\.\s*\[Publishing Agent\]\s*prepare_facebook_page_payload\s*\{[\s\S]*?\}\s*/gi,
      ""
    )
    .replace(/\(#200\)[\s\S]*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned || fallbackTitle;
}

function inferTaskDivision(
  t: TaskWithPayloads
): Exclude<DivisionFilterKey, "all"> {
  const payload = (t.input_payload ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
  const code = String(payload.agentCode ?? t.agent_code ?? "")
    .toLowerCase()
    .trim();

  if (code === "reels" || code === "video") return "reels";
  if (code === "story") return "story";
  if (code === "photo" || code === "visual") return "photo";
  if (code === "text") return "text";

  const explicitDiv = String(
    cp.slotKind ??
      cp.publishType ??
      out.division ??
      payload.division ??
      payload.contentType ??
      ""
  )
    .toLowerCase()
    .trim();

  if (
    explicitDiv === "reels" ||
    explicitDiv === "video" ||
    explicitDiv === "story" ||
    explicitDiv === "photo" ||
    explicitDiv === "text"
  ) {
    return explicitDiv === "video" ? "reels" : explicitDiv;
  }

  const raw = `${t.title ?? ""} ${String(out.summary ?? "")}`.toLowerCase();
  if (
    raw.includes("reels") ||
    raw.includes("video") ||
    raw.includes("malam")
  ) {
    return "reels";
  }
  if (
    raw.includes("story") ||
    raw.includes("teaser") ||
    raw.includes("pagi")
  ) {
    return "story";
  }
  if (
    raw.includes("foto") ||
    raw.includes("photo") ||
    raw.includes("gambar") ||
    raw.includes("visual") ||
    raw.includes("siang")
  ) {
    return "photo";
  }
  return "text";
}

function extractFbPostId(t: TaskWithPayloads): string {
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  return String(
    cp.facebookPostId ??
      cp.fbPostId ??
      cp.postId ??
      out.facebookPostId ??
      out.fbPostId ??
      out.postId ??
      ""
  ).trim();
}

function isPublishedToFacebook(t: TaskWithPayloads): boolean {
  const fbId = extractFbPostId(t);
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const publishStatus = String(
    cp.publishStatus ?? out.publishStatus ?? t.status ?? ""
  )
    .toLowerCase()
    .trim();

  return Boolean(fbId) || publishStatus === "published";
}

function getPublishedContentText(t: TaskWithPayloads): string {
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const raw = String(
    cp.caption || out.contentMarkdown || out.summary || t.title || ""
  ).trim();
  return sanitizeCaptionText(raw, t.title);
}

function formatDivisionLabel(div: Exclude<DivisionFilterKey, "all">): string {
  if (div === "reels") return "Reels";
  if (div === "photo") return "Foto";
  if (div === "story") return "Story";
  return "Teks";
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

function expandTaskToWorkflowPrompts(
  task: TaskWithPayloads
): WorkflowMasterPromptItem[] {
  const payload = (task.input_payload ?? {}) as Record<string, unknown>;
  const out = (task.output_payload ?? {}) as Record<string, unknown>;
  const stepOrder = Number(payload.stepOrder ?? task.step_order ?? 1);
  const code = String(
    payload.agentCode || out.agentCode || task.agent_code || ""
  )
    .toLowerCase()
    .trim();
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

export function StudioModulesWorkspace({
  moduleKey,
}: {
  moduleKey: StudioModuleKey;
}) {
  const now = useMemo(() => new Date(), []);
  const todayDateCode = useMemo(() => getDateCodeWib(now), [now]);
  const todayDateLabel = useMemo(() => formatDateLabelWib(now), [now]);
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [runs, setRuns] = useState<DbWorkflowRun[]>([]);
  const [tasks, setTasks] = useState<TaskWithPayloads[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogRow[]>([]);
  const [availableModels, setAvailableModels] = useState<
    { id: string; label: string }[]
  >(FALLBACK_MODEL_OPTIONS);
  const [modelPrefs, setModelPrefs] = useState<AgentModelPrefs>({
    mode: "auto",
    perAgent: {},
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [divisionFilter, setDivisionFilter] =
    useState<DivisionFilterKey>("all");
  const [showAllPublished, setShowAllPublished] = useState(false);
  const [fbPageId, setFbPageId] = useState("");
  const [fbAccessToken, setFbAccessToken] = useState("");
  const [hasSavedFbCreds, setHasSavedFbCreds] = useState(false);
  const [savingFbCreds, setSavingFbCreds] = useState(false);
  const [fbCredFeedback, setFbCredFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AgentModelPrefs;
        if (parsed && (parsed.mode === "auto" || parsed.mode === "manual")) {
          setModelPrefs({
            mode: parsed.mode,
            perAgent: parsed.perAgent ?? {},
          });
        }
      }
    } catch {
      // Abaikan error localStorage
    }
  }, []);

  const updateModelPrefs = (next: AgentModelPrefs) => {
    setModelPrefs(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Abaikan error localStorage
    }
  };

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

      const [
        { data: rData },
        { data: tData },
        { data: uData },
        { data: mData },
        { data: fbCred },
      ] = await Promise.all([
        runsQ,
        tasksQ,
        usageQ,
        supabase.from("ai_models").select("*").eq("is_active", true),
        supabase
          .from("memories")
          .select("content")
          .eq("user_id", user.id)
          .eq("scope", "user")
          .eq("memory_key", "fb_page_credentials")
          .maybeSingle(),
      ]);

      setRuns((rData as DbWorkflowRun[]) ?? []);
      setTasks((tData as TaskWithPayloads[]) ?? []);
      setUsageLogs((uData as UsageLogRow[]) ?? []);

      if (fbCred?.content) {
        try {
          const parsed = JSON.parse(String(fbCred.content)) as {
            pageId?: string;
            accessToken?: string;
          };
          if (parsed.pageId) setFbPageId(parsed.pageId);
          if (parsed.accessToken) setHasSavedFbCreds(true);
        } catch {
          // Abaikan JSON tidak valid
        }
      }

      const dbModelRows = (mData as DbAiModel[]) ?? [];
      if (dbModelRows.length > 0) {
        const mapped = Array.from(
          new Map(
            dbModelRows.map((m) => [
              m.model_identifier,
              {
                id: m.model_identifier,
                label: m.display_name || m.model_identifier,
              },
            ])
          ).values()
        );
        setAvailableModels(mapped);
      }
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
        setAuthReady(true);
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
      }
      setAuthReady(true);
    })();
  }, []);

  useEffect(() => {
    if (authReady) {
      loadData(selectedProject);
    }
  }, [authReady, selectedProject, loadData]);

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((prev) => (prev === key ? null : prev)),
        2000
      );
    } catch {
      // Abaikan error clipboard
    }
  };

  const handleSaveFbCredentials = async () => {
    if (savingFbCreds) return;
    setSavingFbCreds(true);
    setFbCredFeedback(null);
    try {
      const res = await fetch("/api/publish/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_credentials",
          pageId: fbPageId,
          accessToken: fbAccessToken,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setFbCredFeedback({
          ok: false,
          message: data.error || "Gagal menyimpan kredensial Facebook Page.",
        });
        return;
      }
      setHasSavedFbCreds(true);
      setFbAccessToken("");
      setFbCredFeedback({
        ok: true,
        message: data.message || "Kredensial Facebook Page tersimpan.",
      });
    } catch (err) {
      setFbCredFeedback({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : "Gagal menghubungi server saat menyimpan kredensial.",
      });
    } finally {
      setSavingFbCreds(false);
    }
  };

  const handleClearFbCredentials = async () => {
    if (savingFbCreds) return;
    setSavingFbCreds(true);
    setFbCredFeedback(null);
    try {
      const res = await fetch("/api/publish/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_credentials" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setFbCredFeedback({
          ok: false,
          message: data.error || "Gagal menghapus kredensial.",
        });
        return;
      }
      setFbPageId("");
      setFbAccessToken("");
      setHasSavedFbCreds(false);
      setFbCredFeedback({
        ok: true,
        message: data.message || "Kredensial dihapus.",
      });
    } finally {
      setSavingFbCreds(false);
    }
  };

  const dailySlots = useMemo<DailyScheduleSlot[]>(() => {
    const currentWibMinutes = getCurrentWibMinutes(new Date());
    const todayTasks = tasks.filter((t) => {
      const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
      const refDate = cp.publishedAt
        ? new Date(String(cp.publishedAt))
        : new Date(t.created_at);
      return getDateCodeWib(refDate) === todayDateCode;
    });

    if (todayTasks.length === 0) {
      return [];
    }

    const slotMetaMap: Record<
      DailySlotKind,
      { timeLabel: string; title: string; defaultCaption: string }
    > = {
      story: {
        timeLabel: "08.00",
        title: "Slot Pagi — Story Singkat",
        defaultCaption: "Jadwal otomatis pukul 08.00 WIB.",
      },
      photo: {
        timeLabel: "11.00",
        title: "Slot Siang — Konten Foto / Visual",
        defaultCaption: "Jadwal otomatis pukul 11.00 WIB.",
      },
      text: {
        timeLabel: "15.00",
        title: "Slot Sore — Postingan Teks / Edukasi",
        defaultCaption: "Jadwal otomatis pukul 15.00 WIB.",
      },
      reels: {
        timeLabel: "19.00",
        title: "Slot Malam — Video / Reels",
        defaultCaption: "Jadwal otomatis pukul 19.00 WIB.",
      },
    };

    const groupedByKind = new Map<DailySlotKind, TaskWithPayloads>();
    for (const t of todayTasks) {
      const kind = inferTaskDivision(t);
      if (!groupedByKind.has(kind)) {
        groupedByKind.set(kind, t);
      }
    }

    const orderedKinds: DailySlotKind[] = ["story", "photo", "text", "reels"];

    return orderedKinds
      .filter((kind) => groupedByKind.has(kind))
      .map((kind) => {
        const matchedTask = groupedByKind.get(kind)!;
        const meta = slotMetaMap[kind];
        const [slotH, slotM] = meta.timeLabel.split(".").map((n) => Number(n));
        const slotMinutes = (slotH || 0) * 60 + (slotM || 0);
        const isPastSlot = currentWibMinutes > slotMinutes;

        const cp = (matchedTask.checkpoint_state ?? {}) as Record<
          string,
          unknown
        >;
        const out = (matchedTask.output_payload ?? {}) as Record<
          string,
          unknown
        >;
        const fbId = extractFbPostId(matchedTask);
        const publishStatus = String(
          cp.publishStatus ?? out.publishStatus ?? ""
        ).toLowerCase();
        const publishError = String(
          cp.publishError ?? out.publishError ?? ""
        ).trim();
        const contentPreview =
          getPublishedContentText(matchedTask) || meta.defaultCaption;

        let status: DailySlotCheckStatus = "pending";
        let statusNote: string | undefined;
        let lastRunAt: string | undefined;

        if (fbId || publishStatus === "published") {
          status = "success";
          statusNote = fbId ? `Sukses posting (ID: ${fbId})` : "Sukses posting";
          if (cp.publishedAt) {
            const publishedTime = new Date(
              String(cp.publishedAt)
            ).toLocaleTimeString("id-ID", {
              timeZone: "Asia/Jakarta",
              hour: "2-digit",
              minute: "2-digit",
            });
            lastRunAt = `${publishedTime} WIB`;
          }
        } else if (publishStatus === "failed" || publishError) {
          status = "failed";
          statusNote = publishError || "Gagal posting";
        } else if (isPastSlot) {
          status = "failed";
          statusNote = "Terlewat jadwal otomatis";
        }

        return {
          id: `slot-${todayDateCode}-${meta.timeLabel.replace(".", "")}-${kind}`,
          dateCode: todayDateCode,
          dateLabel: todayDateLabel,
          timeLabel: meta.timeLabel,
          kind,
          title: meta.title,
          caption: contentPreview,
          mediaUrl: String(cp.photoUrl ?? cp.videoUrl ?? "").trim(),
          status,
          statusNote,
          lastRunAt,
        };
      });
  }, [tasks, todayDateCode, todayDateLabel]);

  const workflowMasterPrompts = useMemo<WorkflowMasterPromptItem[]>(() => {
    const completed = tasks
      .filter((t) => t.status === "completed")
      .sort((a, b) => {
        const aOrder = Number(
          (a.input_payload ?? {}).stepOrder ?? a.step_order ?? 0
        );
        const bOrder = Number(
          (b.input_payload ?? {}).stepOrder ?? b.step_order ?? 0
        );
        return aOrder - bOrder;
      });
    return completed.flatMap(expandTaskToWorkflowPrompts);
  }, [tasks]);

  const completedTasks = tasks.filter((t) => t.status === "completed");
  const publishedTasks = useMemo(
    () => tasks.filter((t) => isPublishedToFacebook(t)),
    [tasks]
  );

  const filteredPublishedTasks = useMemo(() => {
    const base =
      divisionFilter === "all"
        ? publishedTasks
        : publishedTasks.filter((t) => inferTaskDivision(t) === divisionFilter);
    return showAllPublished ? base : base.slice(0, 5);
  }, [publishedTasks, divisionFilter, showAllPublished]);

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
            <option value="">Semua / Tanpa Proyek (Bebas)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
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
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Cpu className="h-4 w-4 text-purple-400" />
              <div>
                <p className="font-semibold text-slate-100">
                  Mode Pemilihan Model AI
                </p>
                <p className="text-[11px] text-slate-400">
                  {modelPrefs.mode === "auto"
                    ? "Otomatis mengikuti urutan prioritas & fallback di Memory & Settings."
                    : "Manual: pilih model spesifik untuk masing-masing agen di bawah."}
                </p>
              </div>
            </div>

            <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900/80 p-1">
              <button
                type="button"
                onClick={() =>
                  updateModelPrefs({ ...modelPrefs, mode: "auto" })
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  modelPrefs.mode === "auto"
                    ? "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Otomatis (Fallback)
              </button>
              <button
                type="button"
                onClick={() =>
                  updateModelPrefs({ ...modelPrefs, mode: "manual" })
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  modelPrefs.mode === "manual"
                    ? "bg-purple-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Manual per Agen
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MULTI_AGENT_SPECIALISTS.map((ag) => {
              const selectedModelId =
                modelPrefs.perAgent[ag.code] || availableModels[0]?.id || "";
              const commandHref =
                modelPrefs.mode === "manual" && selectedModelId
                  ? `/command-center?q=${encodeURIComponent(
                      ag.defaultPrompt
                    )}&agent=${encodeURIComponent(
                      ag.code
                    )}&model=${encodeURIComponent(selectedModelId)}`
                  : `/command-center?q=${encodeURIComponent(
                      ag.defaultPrompt
                    )}&agent=${encodeURIComponent(ag.code)}`;

              return (
                <div
                  key={ag.code}
                  className="glass-panel rounded-2xl p-4 space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        <Bot className="h-4 w-4 text-purple-400" />
                        <span>{ag.name}</span>
                      </div>
                      <p className="text-[11px] text-blue-300 mt-0.5">
                        {ag.title}
                      </p>
                    </div>
                    <Badge
                      variant={modelPrefs.mode === "manual" ? "blue" : "purple"}
                    >
                      {modelPrefs.mode === "manual"
                        ? selectedModelId
                        : ag.preferredTier}
                    </Badge>
                  </div>

                  <p className="text-slate-300 leading-relaxed">{ag.role}</p>

                  {modelPrefs.mode === "manual" && (
                    <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-2.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-purple-200 font-medium">
                        Model Agen:
                      </span>
                      <select
                        value={selectedModelId}
                        onChange={(e) =>
                          updateModelPrefs({
                            ...modelPrefs,
                            perAgent: {
                              ...modelPrefs.perAgent,
                              [ag.code]: e.target.value,
                            },
                          })
                        }
                        aria-label={`Pilih model untuk ${ag.name}`}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-100"
                      >
                        {availableModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-slate-400">
                      Izin Tools ({ag.allowedTools.length}):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {ag.allowedTools.map((toolId) => {
                        const toolDef = AGENT_TOOL_REGISTRY[toolId];
                        return (
                          <span
                            key={toolId}
                            title={toolDef.description}
                            className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300"
                          >
                            {toolDef.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleCopyText(ag.code, ag.defaultPrompt)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
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
                      href={commandHref}
                      className="text-[11px] font-medium text-blue-400 hover:underline"
                    >
                      Kirim ke Command Center →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : moduleKey === "workflows" ? (
        <div className="space-y-4">
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
                Belum ada workflow run untuk filter ini.
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
                          {String(
                            meta.title || r.title || `Run #${r.id.slice(0, 8)}`
                          )}
                        </span>
                        <Badge
                          variant={
                            r.status === "completed" ? "emerald" : "amber"
                          }
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

          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold">
                  Katalog Master Prompt & Artefak Langkah (
                  {workflowMasterPrompts.length})
                </h2>
              </div>
              <Badge variant="purple">Master Prompt Workflow</Badge>
            </div>

            {workflowMasterPrompts.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada master prompt langkah workflow yang selesai untuk
                filter ini.
              </p>
            ) : (
              <div className="space-y-3">
                {workflowMasterPrompts.map((item) => {
                  const copyId = `wf-prompt-${item.id}`;
                  const isCopied = copiedKey === copyId;
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2 font-semibold">
                            <span className="text-sm text-slate-100">
                              {item.title}
                            </span>
                            <Badge variant={item.isClipMaster ? "purple" : "blue"}>
                              {item.badgeLabel}
                            </Badge>
                          </div>
                          {item.subtitle && (
                            <p className="text-[11px] text-slate-400">
                              {item.subtitle}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(copyId, item.promptText)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-purple-500/40 bg-purple-600/20 px-2.5 py-1 text-[11px] font-medium text-purple-200 hover:bg-purple-600/30"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span>Tersalin</span>
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
                            onClick={() => {
                              const slug = item.clipNumber
                                ? `clip-${String(item.clipNumber).padStart(2, "0")}-master-prompt`
                                : `step-${item.stepOrder}-master-prompt`;
                              downloadMdFile(
                                `${slug}.md`,
                                `# ${item.title}\n\n${item.promptText}\n`
                              );
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                          >
                            <Download className="h-3 w-3 text-blue-400" />
                            <span>.md</span>
                          </button>
                        </div>
                      </div>

                      <pre className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 whitespace-pre-wrap font-mono text-[11px] text-slate-200 leading-relaxed overflow-x-auto">
                        {item.promptText}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : moduleKey === "planner" ? (
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  Jadwal Posting Harian Otomatis ({todayDateLabel})
                </h2>
                <p className="text-xs text-slate-400">
                  Disusun otomatis dari tugas aktif sesuai jadwal WIB; centang
                  hijau (✓) bila sukses tayang dan silang merah (✕) bila gagal /
                  terlewat.
                </p>
              </div>
              <Badge variant="blue">Auto-Schedule WIB</Badge>
            </div>

            {dailySlots.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">
                Belum ada jadwal slot aktif untuk {todayDateLabel}. Kirim
                perintah di AI Command Center untuk membuat tugas slot tertentu.
              </p>
            ) : (
              <div className="space-y-2">
                {dailySlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-blue-300">
                          {slot.dateLabel} • {slot.timeLabel} WIB
                        </span>
                        <span className="font-semibold text-slate-100">
                          {slot.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {slot.caption}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {slot.status === "success" ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                          <Check className="h-3.5 w-3.5" />
                          <span>
                            {slot.statusNote || "Sukses posting"}
                            {slot.lastRunAt ? ` (${slot.lastRunAt})` : ""}
                          </span>
                        </span>
                      ) : slot.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300">
                          <X className="h-3.5 w-3.5" />
                          <span>
                            {slot.statusNote
                              ? `Gagal posting: ${slot.statusNote}`
                              : "Gagal posting"}
                            {slot.lastRunAt ? ` (${slot.lastRunAt})` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                          <Clock className="h-3 w-3" />
                          <span>Menunggu Jadwal</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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

            {tasks.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada antrean tugas produksi untuk proyek ini.
              </p>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => {
                  const payload = (t.input_payload ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const stepOrder = Number(
                    payload.stepOrder ?? t.step_order ?? 1
                  );
                  const isPublished = isPublishedToFacebook(t);
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
                          Target:{" "}
                          {String(payload.estimatedOutput || "Artefak")} •
                          Dibuat:{" "}
                          {new Date(t.created_at).toLocaleDateString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isPublished && (
                          <Badge variant="blue">Sudah Tayang FB</Badge>
                        )}
                        <Badge
                          variant={
                            t.status === "completed" ? "emerald" : "amber"
                          }
                        >
                          {t.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : moduleKey === "publishing" ? (
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  Koneksi Facebook Page Graph API
                </h2>
                <p className="text-xs text-slate-400">
                  Kredensial halaman yang digunakan oleh penjadwalan otomatis
                  saat mempublikasikan konten ke Facebook Page.
                </p>
              </div>
              <Badge variant={hasSavedFbCreds ? "emerald" : "amber"}>
                {hasSavedFbCreds ? "Token Tersimpan" : "Perlu Token Halaman"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">
                  Facebook Page ID
                </label>
                <input
                  type="text"
                  value={fbPageId}
                  onChange={(e) => setFbPageId(e.target.value)}
                  placeholder="Contoh: 123456789012345"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">
                  Page Access Token{" "}
                  {hasSavedFbCreds ? "(Kosongkan jika pakai tersimpan)" : ""}
                </label>
                <input
                  type="password"
                  value={fbAccessToken}
                  onChange={(e) => setFbAccessToken(e.target.value)}
                  placeholder="EAABsbCS1iHgBO..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {hasSavedFbCreds && (
                <button
                  type="button"
                  disabled={savingFbCreds}
                  onClick={handleClearFbCredentials}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  Hapus Kredensial
                </button>
              )}
              <button
                type="button"
                disabled={savingFbCreds}
                onClick={handleSaveFbCredentials}
                className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {savingFbCreds ? "Menyimpan..." : "Simpan Kredensial"}
              </button>
            </div>

            {fbCredFeedback && (
              <div
                className={`flex items-center gap-1.5 rounded-lg p-2 text-[11px] ${
                  fbCredFeedback.ok
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-rose-500/30 bg-rose-500/10 text-rose-300"
                }`}
              >
                {fbCredFeedback.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{fbCredFeedback.message}</span>
              </div>
            )}
          </div>

          <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-emerald-400" />
                <div>
                  <h2 className="text-base font-semibold">
                    Publishing Center — Arsip Tayang Facebook (
                    {publishedTasks.length} Item)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Menampilkan konten yang telah berhasil diposting ke Facebook
                    Page melalui jadwal otomatis.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="emerald">Sudah Tayang FB</Badge>
                {publishedTasks.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPublished((prev) => !prev)}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                  >
                    {showAllPublished
                      ? "Ringkas (5 Item)"
                      : `Lihat Semua (${publishedTasks.length})`}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: "all", label: "Semua" },
                  { key: "text", label: "Divisi Teks" },
                  { key: "photo", label: "Divisi Foto" },
                  { key: "story", label: "Divisi Story" },
                  { key: "reels", label: "Divisi Reels" },
                ] as { key: DivisionFilterKey; label: string }[]
              ).map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setDivisionFilter(pill.key)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    divisionFilter === pill.key
                      ? "bg-blue-600 text-white"
                      : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {filteredPublishedTasks.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada konten yang berhasil dipublikasikan ke Facebook untuk
                filter ini. Konten siap tayang di Content Studio akan otomatis
                masuk ke arsip ini setelah dijadwalkan dan diposting oleh
                Content Planner.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredPublishedTasks.map((t) => {
                  const cp = (t.checkpoint_state ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const postId = extractFbPostId(t);
                  const contentText = getPublishedContentText(t);
                  const photoUrl = String(cp.photoUrl ?? "").trim();
                  const videoUrl = String(cp.videoUrl ?? "").trim();
                  const division = inferTaskDivision(t);
                  const publishedAtRaw = cp.publishedAt
                    ? String(cp.publishedAt)
                    : t.created_at;

                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="font-semibold text-sm text-slate-100">
                              {t.title}
                            </span>
                            <Badge variant="emerald">Terpublikasi</Badge>
                            <Badge variant="blue">
                              {formatDivisionLabel(division)}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                            <span>
                              Tayang:{" "}
                              {new Date(publishedAtRaw).toLocaleString("id-ID", {
                                timeZone: "Asia/Jakarta",
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              WIB
                            </span>
                            {postId && (
                              <span className="font-mono text-emerald-300">
                                • FB ID: {postId}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {postId && (
                            <button
                              type="button"
                              onClick={() => handleCopyText(`fb-${t.id}`, postId)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                            >
                              {copiedKey === `fb-${t.id}` ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span>ID Tersalin</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3 text-emerald-400" />
                                  <span>Salin FB ID</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(`txt-${t.id}`, contentText)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                          >
                            {copiedKey === `txt-${t.id}` ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span>Teks Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-blue-400" />
                                <span>Salin Teks</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                        {contentText}
                      </div>

                      {photoUrl &&
                        /^https?:\/\//i.test(photoUrl) &&
                        !photoUrl.includes("...") && (
                          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950 p-1.5">
                            <img
                              src={photoUrl}
                              alt={t.title}
                              className="max-h-56 w-full rounded object-cover"
                            />
                          </div>
                        )}

                      {videoUrl &&
                        /^https?:\/\//i.test(videoUrl) &&
                        !videoUrl.includes("...") && (
                          <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[11px] text-slate-300 truncate">
                            Video Reels:{" "}
                            <a
                              href={videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-300 underline"
                            >
                              {videoUrl}
                            </a>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
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
                Belum ada log penggunaan token untuk filter ini.
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
