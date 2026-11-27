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
  Video,
  Image as ImageIcon,
  FileText,
  CheckCircle2,
  AlertCircle,
  Zap,
  Play,
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

interface AgentModelPrefs {
  mode: "auto" | "manual";
  perAgent: Record<string, string>;
}

interface PublishItemState {
  publishType: "reels" | "photo" | "text";
  videoUrl: string;
  photoUrl: string;
  caption: string;
  autoPublishOnRender: boolean;
}

const STORAGE_KEY = "denjeh_agent_model_prefs";

const FALLBACK_MODEL_OPTIONS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile (Groq)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Groq)" },
];

function getTodayDateCodeWib(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(new Date());

  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = parts.find((p) => p.type === "year")?.value ?? "26";
  return `${day}${month}${year}`;
}

function buildDefaultDailySlots(dateCode: string): DailyScheduleSlot[] {
  return [
    {
      id: `slot-${dateCode}-0800-story`,
      dateCode,
      timeLabel: "08.00",
      kind: "story",
      title: "Slot Pagi — Story Singkat",
      caption: "Sapaan pagi & pemantik interaksi singkat hari ini.",
      mediaUrl: "",
      status: "pending",
    },
    {
      id: `slot-${dateCode}-1100-photo`,
      dateCode,
      timeLabel: "11.00",
      kind: "photo",
      title: "Slot Siang — Konten Foto / Visual",
      caption: "Visual tunggal dengan pesan utama yang jelas.",
      mediaUrl: "",
      status: "pending",
    },
    {
      id: `slot-${dateCode}-1500-text`,
      dateCode,
      timeLabel: "15.00",
      kind: "text",
      title: "Slot Sore — Postingan Teks / Edukasi",
      caption: "Ringkasan insight, tips praktis, atau diskusi santai.",
      mediaUrl: "",
      status: "pending",
    },
    {
      id: `slot-${dateCode}-1900-reels`,
      dateCode,
      timeLabel: "19.00",
      kind: "reels",
      title: "Slot Malam — Video / Reels",
      caption: "Cuplikan video pendek berdurasi singkat.",
      mediaUrl: "",
      status: "pending",
    },
  ];
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

function composeUnifiedTextDeliverable(
  t: TaskWithPayloads,
  allTasks: TaskWithPayloads[]
): string {
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;

  const primaryRaw = String(
    cp.caption || out.contentMarkdown || out.summary || t.title
  );
  const cleanPrimary = sanitizeCaptionText(primaryRaw, t.title).trim();

  const runId = t.workflow_run_id;
  if (runId) {
    const companionTexts = allTasks
      .filter((other) => {
        if (other.id === t.id || other.status !== "completed") return false;
        if (other.workflow_run_id !== runId) return false;
        const otherPayload = (other.input_payload ?? {}) as Record<
          string,
          unknown
        >;
        const code = String(
          otherPayload.agentCode ?? other.agent_code ?? ""
        ).toLowerCase();
        return code === "marketing" || code === "publishing";
      })
      .map((other) => {
        const otherOut = (other.output_payload ?? {}) as Record<
          string,
          unknown
        >;
        const otherCp = (other.checkpoint_state ?? {}) as Record<
          string,
          unknown
        >;
        const rawOther = String(
          otherCp.caption || otherOut.contentMarkdown || otherOut.summary || ""
        );
        return sanitizeCaptionText(rawOther, "").trim();
      })
      .filter((txt) => {
        if (!txt) return false;
        const normalizedPrimary = cleanPrimary
          .toLowerCase()
          .replace(/\s+/g, " ");
        const normalizedOther = txt.toLowerCase().replace(/\s+/g, " ");
        return (
          normalizedPrimary !== normalizedOther &&
          !normalizedPrimary.includes(normalizedOther.slice(0, 80))
        );
      });

    if (companionTexts.length > 0) {
      return `${cleanPrimary}\n\n${companionTexts.join("\n\n")}`.trim();
    }
  }

  return cleanPrimary || t.title;
}

function inferTaskDivision(
  t: TaskWithPayloads
): Exclude<DivisionFilterKey, "all"> {
  const payload = (t.input_payload ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const code = String(payload.agentCode ?? t.agent_code ?? "")
    .toLowerCase()
    .trim();

  if (code === "reels" || code === "video") return "reels";
  if (code === "story") return "story";
  if (code === "photo" || code === "visual") return "photo";
  if (code === "text") return "text";

  const explicitDiv = String(
    out.division ?? payload.division ?? payload.contentType ?? ""
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
  if (raw.includes("reels") || raw.includes("video")) return "reels";
  if (raw.includes("story") || raw.includes("teaser")) return "story";
  if (
    raw.includes("foto") ||
    raw.includes("photo") ||
    raw.includes("gambar") ||
    raw.includes("visual")
  ) {
    return "photo";
  }
  return "text";
}

function isFinishedDeliverableTask(t: TaskWithPayloads): boolean {
  if (t.status !== "completed") return false;

  const payload = (t.input_payload ?? {}) as Record<string, unknown>;
  const out = (t.output_payload ?? {}) as Record<string, unknown>;
  const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
  const code = String(payload.agentCode ?? t.agent_code ?? "")
    .toLowerCase()
    .trim();

  const intermediateCodes = new Set([
    "idea",
    "research",
    "orchestrator",
    "quality",
  ]);
  if (intermediateCodes.has(code)) {
    return false;
  }

  const contentBody = String(
    cp.caption || out.contentMarkdown || out.summary || ""
  ).trim();

  const hasMediaAsset = Boolean(
    String(cp.photoUrl ?? "").trim() || String(cp.videoUrl ?? "").trim()
  );

  if (!contentBody && !hasMediaAsset) {
    return false;
  }

  const looksLikeRawTaskPlan =
    /^\s*(1\.\s*\[[^\]]+\]|berikan daftar\s+\d+\s+konsep|mengumpulkan data,\s*referensi)/i.test(
      contentBody
    );

  return !looksLikeRawTaskPlan || hasMediaAsset;
}

export function StudioModulesWorkspace({
  moduleKey,
}: {
  moduleKey: StudioModuleKey;
}) {
  const todayDateCode = useMemo(() => getTodayDateCodeWib(), []);
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
  const [publishItems, setPublishItems] = useState<
    Record<string, PublishItemState>
  >({});
  const [activeFormatTabs, setActiveFormatTabs] = useState<
    Record<string, FormatTabKey>
  >({});
  const [divisionFilter, setDivisionFilter] =
    useState<DivisionFilterKey>("all");
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [photoPrompts, setPhotoPrompts] = useState<Record<string, string>>({});
  const [generatingPhotoTaskId, setGeneratingPhotoTaskId] = useState<
    string | null
  >(null);
  const [dailySlots, setDailySlots] = useState<DailyScheduleSlot[]>(() =>
    buildDefaultDailySlots(getTodayDateCodeWib())
  );
  const [runningSlotId, setRunningSlotId] = useState<string | null>(null);
  const [runningAllSlots, setRunningAllSlots] = useState(false);
  const [fbPageId, setFbPageId] = useState("");
  const [fbAccessToken, setFbAccessToken] = useState("");
  const [hasSavedFbCreds, setHasSavedFbCreds] = useState(false);
  const [savingFbCreds, setSavingFbCreds] = useState(false);
  const [fbCredFeedback, setFbCredFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [publishingTaskId, setPublishingTaskId] = useState<string | null>(null);
  const [runningAutoTaskId, setRunningAutoTaskId] = useState<string | null>(
    null
  );
  const [publishFeedback, setPublishFeedback] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});
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

  const executeSingleDailySlot = async (slot: DailyScheduleSlot) => {
    setRunningSlotId(slot.id);
    const nowStr = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    try {
      const mappedPublishType =
        slot.kind === "reels"
          ? "reels"
          : slot.kind === "photo" || slot.kind === "story"
          ? "photo"
          : "text";

      const res = await fetch("/api/publish/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject || null,
          pageId: fbPageId,
          accessToken: fbAccessToken,
          publishType: mappedPublishType,
          slotKind: slot.kind,
          caption: sanitizeCaptionText(slot.caption, slot.title),
          photoUrl:
            slot.kind === "photo" || slot.kind === "story"
              ? slot.mediaUrl || ""
              : "",
          videoUrl: slot.kind === "reels" ? slot.mediaUrl || "" : "",
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        postId?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setDailySlots((prev) =>
          prev.map((item) =>
            item.id === slot.id
              ? {
                  ...item,
                  status: "failed",
                  statusNote: data.error || "Gagal posting",
                  lastRunAt: `${nowStr} WIB`,
                }
              : item
          )
        );
        return;
      }

      setDailySlots((prev) =>
        prev.map((item) =>
          item.id === slot.id
            ? {
                ...item,
                status: "success",
                statusNote: data.postId
                  ? `Sukses posting (ID: ${data.postId})`
                  : "Sukses posting",
                lastRunAt: `${nowStr} WIB`,
              }
            : item
        )
      );
    } catch (err) {
      setDailySlots((prev) =>
        prev.map((item) =>
          item.id === slot.id
            ? {
                ...item,
                status: "failed",
                statusNote:
                  err instanceof Error ? err.message : "Gagal koneksi jaringan",
                lastRunAt: `${nowStr} WIB`,
              }
            : item
        )
      );
    } finally {
      setRunningSlotId(null);
    }
  };

  const handleRunAllDailySlots = async () => {
    if (runningAllSlots || runningSlotId) return;
    setRunningAllSlots(true);
    try {
      for (const slot of dailySlots) {
        await executeSingleDailySlot(slot);
      }
    } finally {
      setRunningAllSlots(false);
    }
  };

  const getPublishItemState = (t: TaskWithPayloads): PublishItemState => {
    if (publishItems[t.id]) return publishItems[t.id];
    const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
    const inferredDiv = inferTaskDivision(t);
    const fallbackType: "reels" | "photo" | "text" =
      inferredDiv === "reels"
        ? "reels"
        : inferredDiv === "photo" || inferredDiv === "story"
        ? "photo"
        : "text";
    const cpType =
      cp.publishType === "reels" ||
      cp.publishType === "photo" ||
      cp.publishType === "text"
        ? cp.publishType
        : fallbackType;

    const unifiedCaption = composeUnifiedTextDeliverable(t, tasks);

    return {
      publishType: cpType,
      videoUrl: String(cp.videoUrl ?? ""),
      photoUrl: String(cp.photoUrl ?? ""),
      caption: unifiedCaption,
      autoPublishOnRender: Boolean(cp.autoPublishFacebook ?? true),
    };
  };

  const getActiveTab = (
    t: TaskWithPayloads,
    item: PublishItemState
  ): FormatTabKey => {
    if (activeFormatTabs[t.id]) return activeFormatTabs[t.id];
    if (item.publishType === "photo") return "photo";
    if (item.publishType === "reels") return "video";
    return "text";
  };

  const selectFormatTab = (
    t: TaskWithPayloads,
    item: PublishItemState,
    tab: FormatTabKey
  ) => {
    setActiveFormatTabs((prev) => ({ ...prev, [t.id]: tab }));
    const mappedType: "reels" | "photo" | "text" =
      tab === "video" ? "reels" : tab;
    updatePublishItemState(t.id, item, { publishType: mappedType });
  };

  const getPhotoPrompt = (
    t: TaskWithPayloads,
    item: PublishItemState
  ): string => {
    if (photoPrompts[t.id] !== undefined) return photoPrompts[t.id];
    const out = (t.output_payload ?? {}) as Record<string, unknown>;
    const payload = (t.input_payload ?? {}) as Record<string, unknown>;
    const rawPrompt = String(
      payload.imagePrompt || out.visualPrompt || item.caption || t.title
    ).trim();
    return rawPrompt.slice(0, 600);
  };

  const updatePublishItemState = (
    taskId: string,
    base: PublishItemState,
    patch: Partial<PublishItemState>
  ) => {
    setPublishItems((prev) => ({
      ...prev,
      [taskId]: { ...base, ...patch },
    }));
  };

  const handleGeneratePhoto = async (
    t: TaskWithPayloads,
    item: PublishItemState
  ) => {
    if (generatingPhotoTaskId || runningAutoTaskId || publishingTaskId) return;
    const promptValue = getPhotoPrompt(t, item).trim();
    if (!promptValue) {
      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: false,
          message: "Isi prompt gambar terlebih dahulu sebelum generate foto.",
        },
      }));
      return;
    }

    setGeneratingPhotoTaskId(t.id);
    setPublishFeedback((prev) => {
      const copy = { ...prev };
      delete copy[t.id];
      return copy;
    });

    try {
      const res = await fetch("/api/media/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptValue,
          taskId: t.id,
          filePrefix: `task-${t.id.slice(0, 8)}`,
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        imageUrl?: string;
        error?: string;
      };

      if (!res.ok || !data.ok || !data.imageUrl) {
        setPublishFeedback((prev) => ({
          ...prev,
          [t.id]: {
            ok: false,
            message:
              data.error ||
              "Gagal membuat gambar melalui /api/media/generate-image.",
          },
        }));
        return;
      }

      const nextItem: PublishItemState = {
        ...item,
        publishType: "photo",
        photoUrl: data.imageUrl,
      };
      setPublishItems((prev) => ({ ...prev, [t.id]: nextItem }));
      setActiveFormatTabs((prev) => ({ ...prev, [t.id]: "photo" }));

      const supabase = createSupabaseBrowserClient();
      const prevCp =
        t.checkpoint_state && typeof t.checkpoint_state === "object"
          ? (t.checkpoint_state as Record<string, unknown>)
          : {};

      await supabase
        .from("tasks")
        .update({
          checkpoint_state: {
            ...prevCp,
            publishType: "photo",
            photoUrl: data.imageUrl,
            caption: sanitizeCaptionText(item.caption, t.title),
          },
        })
        .eq("id", t.id);

      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: true,
          message:
            "Gambar berhasil dibuat & tersimpan ke Storage. Siap diposting ke Facebook.",
        },
      }));
    } catch (err) {
      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Gagal memanggil endpoint generate gambar.",
        },
      }));
    } finally {
      setGeneratingPhotoTaskId(null);
    }
  };

  const handleToggleAutoPublishOnRender = async (
    t: TaskWithPayloads,
    item: PublishItemState
  ) => {
    const nextAuto = !item.autoPublishOnRender;
    const cleanCaption = sanitizeCaptionText(item.caption, t.title);
    updatePublishItemState(t.id, item, {
      autoPublishOnRender: nextAuto,
      caption: cleanCaption,
    });

    try {
      const supabase = createSupabaseBrowserClient();
      const prevCp =
        t.checkpoint_state && typeof t.checkpoint_state === "object"
          ? (t.checkpoint_state as Record<string, unknown>)
          : {};

      await supabase
        .from("tasks")
        .update({
          checkpoint_state: {
            ...prevCp,
            autoPublishFacebook: nextAuto,
            publishType: item.publishType,
            videoUrl: item.videoUrl,
            photoUrl: item.photoUrl,
            caption: cleanCaption,
          },
        })
        .eq("id", t.id);

      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: true,
          message: nextAuto
            ? "Mode otomatis aktif: saat render selesai atau dijalankan, posting ke Facebook berjalan otomatis."
            : "Mode otomatis dimatikan untuk tugas ini.",
        },
      }));
    } catch {
      // Abaikan error pembaruan sakelar
    }
  };

  const handleRunAutomatedPipelineFromApp = async (
    t: TaskWithPayloads,
    item: PublishItemState
  ) => {
    if (runningAutoTaskId || publishingTaskId) return;
    setRunningAutoTaskId(t.id);
    setPublishFeedback((prev) => {
      const copy = { ...prev };
      delete copy[t.id];
      return copy;
    });

    const activeItem = publishItems[t.id] ?? item;
    const cleanCaption = sanitizeCaptionText(activeItem.caption, t.title);

    try {
      const supabase = createSupabaseBrowserClient();
      const prevCp =
        t.checkpoint_state && typeof t.checkpoint_state === "object"
          ? (t.checkpoint_state as Record<string, unknown>)
          : {};

      await supabase
        .from("tasks")
        .update({
          checkpoint_state: {
            ...prevCp,
            renderStatus: "completed",
            renderedAt: new Date().toISOString(),
            autoPublishFacebook: activeItem.autoPublishOnRender,
            publishType: activeItem.publishType,
            videoUrl: activeItem.videoUrl,
            photoUrl: activeItem.photoUrl,
            caption: cleanCaption,
          },
        })
        .eq("id", t.id);

      if (!activeItem.autoPublishOnRender) {
        setPublishFeedback((prev) => ({
          ...prev,
          [t.id]: {
            ok: true,
            message:
              "Data render tersimpan (Render Selesai). Aktifkan Auto ON atau klik Posting ke FB untuk mempublikasikan.",
          },
        }));
        await loadData(selectedProject);
        return;
      }

      const res = await fetch("/api/publish/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: t.project_id || selectedProject || null,
          taskId: t.id,
          pageId: fbPageId,
          accessToken: fbAccessToken,
          publishType: activeItem.publishType,
          caption: cleanCaption,
          videoUrl: activeItem.videoUrl,
          photoUrl: activeItem.photoUrl,
          saveCredentials: Boolean(fbPageId && fbAccessToken),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        postId?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setPublishFeedback((prev) => ({
          ...prev,
          [t.id]: {
            ok: false,
            message:
              data.error || "Alur otomatis gagal memposting ke Facebook Page.",
          },
        }));
        return;
      }

      if (fbPageId && fbAccessToken) {
        setHasSavedFbCreds(true);
        setFbAccessToken("");
      }

      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: true,
          message: `Alur otomatis sukses: render dicatat & diposting ke Facebook Page (ID: ${data.postId})`,
        },
      }));
      await loadData(selectedProject);
    } catch (err) {
      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Gagal menjalankan alur otomatis dari aplikasi.",
        },
      }));
    } finally {
      setRunningAutoTaskId(null);
    }
  };

  const handleFacebookAutoPost = async (
    t: TaskWithPayloads,
    overrideType?: "reels" | "photo" | "text"
  ) => {
    if (publishingTaskId || runningAutoTaskId) return;
    const baseItem = publishItems[t.id] ?? getPublishItemState(t);
    const effectiveType = overrideType ?? baseItem.publishType;
    const cleanCaption = sanitizeCaptionText(baseItem.caption, t.title);
    setPublishingTaskId(t.id);
    setPublishFeedback((prev) => {
      const copy = { ...prev };
      delete copy[t.id];
      return copy;
    });

    try {
      const res = await fetch("/api/publish/facebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: t.project_id || selectedProject || null,
          taskId: t.id,
          pageId: fbPageId,
          accessToken: fbAccessToken,
          publishType: effectiveType,
          caption: cleanCaption,
          videoUrl: baseItem.videoUrl,
          photoUrl: baseItem.photoUrl,
          saveCredentials: Boolean(fbPageId && fbAccessToken),
        }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        postId?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        setPublishFeedback((prev) => ({
          ...prev,
          [t.id]: {
            ok: false,
            message: data.error || "Gagal mempublikasikan ke Facebook Page.",
          },
        }));
        return;
      }

      if (fbPageId && fbAccessToken) {
        setHasSavedFbCreds(true);
        setFbAccessToken("");
      }

      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: true,
          message: `Berhasil dipublikasikan ke Facebook Page (ID: ${data.postId})`,
        },
      }));
      await loadData(selectedProject);
    } catch (err) {
      setPublishFeedback((prev) => ({
        ...prev,
        [t.id]: {
          ok: false,
          message:
            err instanceof Error
              ? err.message
              : "Koneksi gagal saat menghubungi API Facebook.",
        },
      }));
    } finally {
      setPublishingTaskId(null);
    }
  };

  const completedTasks = tasks.filter((t) => t.status === "completed");
  const finishedDeliverables = useMemo(
    () => tasks.filter((t) => isFinishedDeliverableTask(t)),
    [tasks]
  );

  const filteredCompletedTasks = useMemo(() => {
    const base =
      divisionFilter === "all"
        ? finishedDeliverables
        : finishedDeliverables.filter(
            (t) => inferTaskDivision(t) === divisionFilter
          );
    return showAllCompleted ? base : base.slice(0, 3);
  }, [finishedDeliverables, divisionFilter, showAllCompleted]);

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
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  Ceklis Jadwal Posting Harian (Tanggal {todayDateCode})
                </h2>
                <p className="text-xs text-slate-400">
                  Asisten menjalankan slot harian sesuai jam: centang hijau (✓)
                  bila sukses posting dan silang merah (✕) bila gagal posting.
                </p>
              </div>

              <button
                type="button"
                disabled={runningAllSlots || Boolean(runningSlotId)}
                onClick={() => void handleRunAllDailySlots()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                <span>
                  {runningAllSlots
                    ? "Menjalankan Jadwal..."
                    : "Jalankan Semua Slot Hari Ini"}
                </span>
              </button>
            </div>

            <div className="space-y-2">
              {dailySlots.map((slot) => {
                const isRunningThis = runningSlotId === slot.id;
                return (
                  <div
                    key={slot.id}
                    className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-blue-300">
                          {slot.dateCode} • {slot.timeLabel}
                        </span>
                        <span className="font-semibold text-slate-100">
                          {slot.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {slot.caption}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
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
                        <Badge variant="amber">Menunggu Jadwal</Badge>
                      )}

                      <button
                        type="button"
                        disabled={isRunningThis || runningAllSlots}
                        onClick={() => void executeSingleDailySlot(slot)}
                        className="rounded-lg border border-blue-500/40 bg-blue-600/20 px-2.5 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-600/30 disabled:opacity-50"
                      >
                        {isRunningThis ? "Memproses..." : "Jalankan Slot"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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

            <div className="space-y-2">
              {tasks.map((t) => {
                const payload = (t.input_payload ?? {}) as Record<
                  string,
                  unknown
                >;
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
        </div>
      ) : moduleKey === "publishing" ? (
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  Koneksi Facebook Page Graph API & Otomatisasi App
                </h2>
                <p className="text-xs text-slate-400">
                  Simpan kredensial halaman lalu rilis barang jadi Teks, Foto,
                  Story, atau Reels ke Facebook Page.
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
                <Send className="h-5 w-5 text-purple-400" />
                <div>
                  <h2 className="text-base font-semibold">
                    Publishing Center — Barang Jadi Siap Rilis (
                    {finishedDeliverables.length} Item)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Menampilkan hasil akhir konten yang siap diposting per
                    divisi (langkah riset/ide mentah disembunyikan).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="purple">Teks • Foto • Story • Reels</Badge>
                {finishedDeliverables.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllCompleted((prev) => !prev)}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                  >
                    {showAllCompleted
                      ? "Ringkas (3 Item)"
                      : `Lihat Semua (${finishedDeliverables.length})`}
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

            {filteredCompletedTasks.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada barang jadi untuk filter ini. Selesaikan tugas output
                (Teks, Foto, Story, atau Reels) di AI Command Center terlebih
                dahulu.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredCompletedTasks.map((t) => {
                  const item = publishItems[t.id] ?? getPublishItemState(t);
                  const currentTab = getActiveTab(t, item);
                  const feedback = publishFeedback[t.id];
                  const isPublishingThis = publishingTaskId === t.id;
                  const isRunningAutoThis = runningAutoTaskId === t.id;
                  const isGeneratingPhotoThis = generatingPhotoTaskId === t.id;
                  const cp = (t.checkpoint_state ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const publishedId = String(cp.facebookPostId ?? "");
                  const renderStatus = String(cp.renderStatus ?? "");

                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3.5 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">
                              {t.title}
                            </span>
                            <Badge variant="emerald">Barang Jadi</Badge>
                            {renderStatus === "completed" && (
                              <Badge variant="blue">Render Selesai</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                              #{t.id.slice(0, 8)}
                            </code>
                            <button
                              type="button"
                              onClick={() => handleCopyText(`id-${t.id}`, t.id)}
                              className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                            >
                              {copiedKey === `id-${t.id}` ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span>ID Tersalin</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Salin ID</span>
                                </>
                              )}
                            </button>
                            {publishedId && (
                              <span className="text-emerald-400">
                                • FB ID: {publishedId}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleAutoPublishOnRender(t, item)
                            }
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                              item.autoPublishOnRender
                                ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                                : "border-slate-700 bg-slate-800/70 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Zap className="h-3 w-3" />
                            <span>
                              {item.autoPublishOnRender ? "Auto ON" : "Auto OFF"}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={
                              isRunningAutoThis ||
                              isPublishingThis ||
                              isGeneratingPhotoThis
                            }
                            onClick={() =>
                              handleRunAutomatedPipelineFromApp(t, item)
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" />
                            <span>
                              {isRunningAutoThis ? "Jalan..." : "Jalankan"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyText(t.id, item.caption)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                          >
                            {copiedKey === t.id ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3 text-blue-400" />
                            )}
                            <span>Salin</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
                        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-900/90 p-1">
                          <button
                            type="button"
                            onClick={() => selectFormatTab(t, item, "text")}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                              currentTab === "text"
                                ? "bg-emerald-600 text-white"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <FileText className="h-3 w-3" />
                            <span>Teks</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => selectFormatTab(t, item, "photo")}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                              currentTab === "photo"
                                ? "bg-blue-600 text-white"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <ImageIcon className="h-3 w-3" />
                            <span>Foto</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => selectFormatTab(t, item, "video")}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                              currentTab === "video"
                                ? "bg-purple-600 text-white"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Video className="h-3 w-3" />
                            <span>Reels</span>
                          </button>
                        </div>

                        {currentTab === "text" && (
                          <div className="space-y-2">
                            <textarea
                              rows={6}
                              value={item.caption}
                              onChange={(e) =>
                                updatePublishItemState(t.id, item, {
                                  publishType: "text",
                                  caption: e.target.value,
                                })
                              }
                              className="w-full max-h-60 resize-y rounded-lg border border-slate-700 bg-slate-900/90 p-2.5 text-xs leading-relaxed text-slate-200"
                            />
                            <button
                              type="button"
                              disabled={
                                isPublishingThis ||
                                isRunningAutoThis ||
                                isGeneratingPhotoThis
                              }
                              onClick={() => {
                                updatePublishItemState(t.id, item, {
                                  publishType: "text",
                                });
                                void handleFacebookAutoPost(t, "text");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              <Send className="h-3 w-3" />
                              <span>
                                {isPublishingThis
                                  ? "Memposting..."
                                  : "Posting Teks ke FB"}
                              </span>
                            </button>
                          </div>
                        )}

                        {currentTab === "photo" && (
                          <div className="space-y-2">
                            <textarea
                              rows={2}
                              value={getPhotoPrompt(t, item)}
                              onChange={(e) =>
                                setPhotoPrompts((prev) => ({
                                  ...prev,
                                  [t.id]: e.target.value,
                                }))
                              }
                              className="w-full max-h-24 resize-none rounded-lg border border-slate-700 bg-slate-900/90 p-2 text-xs text-slate-200"
                            />

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={
                                  isGeneratingPhotoThis ||
                                  isPublishingThis ||
                                  isRunningAutoThis
                                }
                                onClick={() =>
                                  void handleGeneratePhoto(t, item)
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                              >
                                <ImageIcon className="h-3 w-3" />
                                <span>
                                  {isGeneratingPhotoThis
                                    ? "Generating..."
                                    : "Generate Foto"}
                                </span>
                              </button>

                              <button
                                type="button"
                                disabled={
                                  !item.photoUrl.trim() ||
                                  item.photoUrl.includes("...") ||
                                  isPublishingThis ||
                                  isRunningAutoThis ||
                                  isGeneratingPhotoThis
                                }
                                onClick={() => {
                                  updatePublishItemState(t.id, item, {
                                    publishType: "photo",
                                  });
                                  void handleFacebookAutoPost(t, "photo");
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                              >
                                <Send className="h-3 w-3" />
                                <span>
                                  {isPublishingThis
                                    ? "Memposting..."
                                    : "Posting Foto ke FB"}
                                </span>
                              </button>
                            </div>

                            <input
                              type="url"
                              value={item.photoUrl}
                              onChange={(e) =>
                                updatePublishItemState(t.id, item, {
                                  publishType: "photo",
                                  photoUrl: e.target.value,
                                })
                              }
                              placeholder="https://.../storage/v1/object/public/..."
                              className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200"
                            />

                            {item.photoUrl &&
                              /^https?:\/\//i.test(item.photoUrl) &&
                              !item.photoUrl.includes("...") && (
                                <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900 p-1.5">
                                  <img
                                    src={item.photoUrl}
                                    alt={t.title}
                                    className="max-h-48 w-full rounded object-cover"
                                  />
                                </div>
                              )}
                          </div>
                        )}

                        {currentTab === "video" && (
                          <div className="space-y-2">
                            <input
                              type="url"
                              value={item.videoUrl}
                              onChange={(e) =>
                                updatePublishItemState(t.id, item, {
                                  publishType: "reels",
                                  videoUrl: e.target.value,
                                })
                              }
                              placeholder="https://.../video-reels.mp4"
                              className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200"
                            />

                            <button
                              type="button"
                              disabled={
                                !item.videoUrl.trim() ||
                                item.videoUrl.includes("...") ||
                                isPublishingThis ||
                                isRunningAutoThis ||
                                isGeneratingPhotoThis
                              }
                              onClick={() => {
                                updatePublishItemState(t.id, item, {
                                  publishType: "reels",
                                });
                                void handleFacebookAutoPost(t, "reels");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                            >
                              <Send className="h-3 w-3" />
                              <span>
                                {isPublishingThis
                                  ? "Memposting..."
                                  : "Posting Reels ke FB"}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>

                      {feedback && (
                        <div
                          className={`flex items-center gap-1.5 rounded-lg p-2 text-[11px] ${
                            feedback.ok
                              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border border-rose-500/30 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {feedback.ok ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{feedback.message}</span>
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
