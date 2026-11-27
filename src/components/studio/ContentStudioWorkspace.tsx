"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbProject, DbTask, DbWorkflowRun } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Sparkles,
  SlidersHorizontal,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  FileText,
  Image as ImageIcon,
  Film,
  CalendarClock,
} from "lucide-react";

export type ReadyPublishTabKey = "story" | "text" | "photo" | "reels";

type TaskWithPayloads = DbTask & {
  workflow_run_id?: string | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  checkpoint_state?: Record<string, unknown> | null;
  progress?: number | null;
};

type WorkflowRunWithPlan = DbWorkflowRun & {
  plan_json?: Record<string, unknown> | null;
};

interface ReadyPublishItem {
  id: string;
  taskId: string;
  sourceTaskIds: string[];
  projectId: string | null;
  workflowRunId: string | null;
  stepOrder: number;
  channel: ReadyPublishTabKey;
  slotTimeLabel: string;
  title: string;
  contentText: string;
  mediaUrl: string;
  isReadyToPublish: boolean;
  checkpointState: Record<string, unknown>;
}

const PUBLISH_TABS: {
  key: ReadyPublishTabKey;
  label: string;
  slotTime: string;
}[] = [
  { key: "story", label: "Story", slotTime: "08.00 WIB" },
  { key: "text", label: "Teks", slotTime: "15.00 WIB" },
  { key: "photo", label: "Foto", slotTime: "11.00 WIB" },
  { key: "reels", label: "Reels", slotTime: "19.00 WIB" },
];

function cleanReadableText(raw: string, fallbackTitle: string): string {
  const normalized = raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\d+\.\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized || fallbackTitle;
}

function extractCleanTitleFromContent(content: string, fallback: string): string {
  const hookMatch = content.match(/Hook\s*:\s*["“']?([^"\n”']+)["”']?/i);
  if (hookMatch?.[1]?.trim()) {
    return hookMatch[1].trim().slice(0, 95);
  }

  const titleMatch = content.match(
    /(?:Sudut\s*Pandang\/)?Judul\s*:\s*["“']?([^"\n”']+)["”']?/i
  );
  if (titleMatch?.[1]?.trim()) {
    return titleMatch[1].trim().slice(0, 95);
  }

  const lines = content
    .split("\n")
    .map((l) => l.replace(/^[-*#=]+\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 8 &&
        !/^(slot\s+(pagi|siang|sore|malam)|isi utama|caption slot|audit konten|berikut adalah)/i.test(
          l
        )
    );

  if (lines[0]) {
    return lines[0].slice(0, 95);
  }

  return fallback;
}

function detectAgentRole(
  task: TaskWithPayloads
): "idea" | "text" | "marketing" | "quality" | "media" | "other" {
  const payload =
    task.input_payload && typeof task.input_payload === "object"
      ? (task.input_payload as Record<string, unknown>)
      : {};
  const out =
    task.output_payload && typeof task.output_payload === "object"
      ? (task.output_payload as Record<string, unknown>)
      : {};

  const code = String(
    payload.agentCode ?? out.agentCode ?? task.agent_code ?? ""
  )
    .toLowerCase()
    .trim();
  const title = String(task.title ?? "").toLowerCase();

  if (code === "idea" || title.startsWith("idea agent")) return "idea";
  if (code === "quality" || title.startsWith("quality agent")) return "quality";
  if (code === "marketing" || title.startsWith("marketing agent"))
    return "marketing";
  if (code === "text" || title.startsWith("text agent")) return "text";
  if (["story", "photo", "visual", "reels", "video"].includes(code))
    return "media";

  return "other";
}

function splitSectionsBySlot(
  rawText: string
): Partial<Record<"pagi" | "siang" | "sore" | "malam", string>> {
  const markers: {
    key: "pagi" | "siang" | "sore" | "malam";
    regex: RegExp;
  }[] = [
    {
      key: "pagi",
      regex:
        /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+PAGI[^\n]*/i,
    },
    {
      key: "siang",
      regex:
        /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+SIANG[^\n]*/i,
    },
    {
      key: "sore",
      regex:
        /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+SORE[^\n]*/i,
    },
    {
      key: "malam",
      regex:
        /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+MALAM[^\n]*/i,
    },
  ];

  const found: {
    key: "pagi" | "siang" | "sore" | "malam";
    index: number;
  }[] = [];

  for (const m of markers) {
    const match = m.regex.exec(rawText);
    if (match && typeof match.index === "number") {
      found.push({ key: m.key, index: match.index });
    }
  }

  if (found.length === 0) return {};

  found.sort((a, b) => a.index - b.index);
  const result: Partial<Record<"pagi" | "siang" | "sore" | "malam", string>> =
    {};

  for (let i = 0; i < found.length; i++) {
    const start = found[i].index;
    const end = i + 1 < found.length ? found[i + 1].index : rawText.length;
    const slice = rawText.slice(start, end).trim();
    if (slice) {
      result[found[i].key] = slice;
    }
  }

  return result;
}

function inferPublishChannel(task: TaskWithPayloads): ReadyPublishTabKey {
  const cp =
    task.checkpoint_state && typeof task.checkpoint_state === "object"
      ? (task.checkpoint_state as Record<string, unknown>)
      : {};
  const payload =
    task.input_payload && typeof task.input_payload === "object"
      ? (task.input_payload as Record<string, unknown>)
      : {};
  const out =
    task.output_payload && typeof task.output_payload === "object"
      ? (task.output_payload as Record<string, unknown>)
      : {};

  const explicit = String(
    cp.slotKind ??
      cp.publishType ??
      payload.slotKind ??
      payload.publishType ??
      out.division ??
      ""
  )
    .toLowerCase()
    .trim();

  if (explicit === "story") return "story";
  if (explicit === "photo" || explicit === "visual") return "photo";
  if (explicit === "reels" || explicit === "video") return "reels";
  if (explicit === "text") return "text";

  const code = String(
    payload.agentCode ?? out.agentCode ?? task.agent_code ?? ""
  )
    .toLowerCase()
    .trim();

  if (code === "story") return "story";
  if (code === "photo" || code === "visual") return "photo";
  if (code === "video" || code === "reels") return "reels";

  const textHint = `${task.title ?? ""} ${String(out.summary ?? "")}`.toLowerCase();
  if (textHint.includes("story")) return "story";
  if (
    textHint.includes("foto") ||
    textHint.includes("photo") ||
    textHint.includes("gambar") ||
    textHint.includes("visual")
  ) {
    return "photo";
  }
  if (textHint.includes("reels") || textHint.includes("video")) return "reels";

  return "text";
}

function getSlotTimeForChannel(channel: ReadyPublishTabKey): string {
  return (
    PUBLISH_TABS.find((tab) => tab.key === channel)?.slotTime ?? "15.00 WIB"
  );
}

function getSlotScheduleLabel(
  slotKey: "pagi" | "siang" | "sore" | "malam" | "umum",
  channel: ReadyPublishTabKey
): string {
  if (slotKey === "pagi") return "08.00 WIB";
  if (slotKey === "siang") return "11.00 WIB";
  if (slotKey === "sore") return "15.00 WIB";
  if (slotKey === "malam") return "19.00 WIB";
  return getSlotTimeForChannel(channel);
}

function buildReadyPublishItems(tasks: TaskWithPayloads[]): ReadyPublishItem[] {
  type SlotGroup = {
    groupKey: string;
    runId: string | null;
    slotKey: "pagi" | "siang" | "sore" | "malam" | "umum";
    textParts: string[];
    marketingParts: string[];
    qualityParts: string[];
    otherParts: string[];
    sourceTaskIds: string[];
    primaryTask?: TaskWithPayloads;
    channel: ReadyPublishTabKey;
    mediaUrl: string;
    isReadyToPublish: boolean;
    checkpointState: Record<string, unknown>;
    stepOrder: number;
  };

  const groups = new Map<string, SlotGroup>();

  const ensureGroup = (
    runId: string | null,
    slotKey: "pagi" | "siang" | "sore" | "malam" | "umum",
    fallbackTask: TaskWithPayloads,
    channel: ReadyPublishTabKey,
    mediaUrl: string,
    cp: Record<string, unknown>,
    stepOrder: number
  ): SlotGroup => {
    const key = `${runId ?? `solo-${fallbackTask.id}`}::${slotKey}::${channel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        runId,
        slotKey,
        textParts: [],
        marketingParts: [],
        qualityParts: [],
        otherParts: [],
        sourceTaskIds: [],
        primaryTask: fallbackTask,
        channel,
        mediaUrl,
        isReadyToPublish: Boolean(cp.readyToPublish || cp.scheduledForCron),
        checkpointState: cp,
        stepOrder,
      });
    }

    const g = groups.get(key)!;
    if (!g.sourceTaskIds.includes(fallbackTask.id)) {
      g.sourceTaskIds.push(fallbackTask.id);
    }
    if (mediaUrl && !g.mediaUrl) {
      g.mediaUrl = mediaUrl;
    }
    if (cp.readyToPublish || cp.scheduledForCron) {
      g.isReadyToPublish = true;
      g.checkpointState = cp;
      g.primaryTask = fallbackTask;
    }
    return g;
  };

  for (const task of tasks) {
    const role = detectAgentRole(task);
    if (role === "idea") continue;

    const payload =
      task.input_payload && typeof task.input_payload === "object"
        ? (task.input_payload as Record<string, unknown>)
        : {};
    const out =
      task.output_payload && typeof task.output_payload === "object"
        ? (task.output_payload as Record<string, unknown>)
        : {};
    const cp =
      task.checkpoint_state && typeof task.checkpoint_state === "object"
        ? (task.checkpoint_state as Record<string, unknown>)
        : {};

    const stepOrder = Number(payload.stepOrder ?? task.step_order ?? 1);
    const channel = inferPublishChannel(task);
    const photoUrl = String(cp.photoUrl ?? out.photoUrl ?? "").trim();
    const videoUrl = String(cp.videoUrl ?? out.videoUrl ?? "").trim();
    const mediaUrl =
      channel === "reels"
        ? videoUrl
        : channel === "photo"
        ? photoUrl
        : photoUrl || videoUrl;

    const rawBody = String(
      cp.caption ?? out.contentMarkdown ?? out.summary ?? ""
    ).trim();
    const cleanBody = cleanReadableText(rawBody, "");
    if (!cleanBody) continue;

    const slotSections = splitSectionsBySlot(cleanBody);
    const slotEntries = Object.entries(slotSections) as [
      "pagi" | "siang" | "sore" | "malam",
      string
    ][];

    if (slotEntries.length > 0) {
      for (const [slotKey, sectionText] of slotEntries) {
        const cleanedSection = cleanReadableText(sectionText, "");
        if (!cleanedSection) continue;

        const grp = ensureGroup(
          task.workflow_run_id ?? null,
          slotKey,
          task,
          channel,
          mediaUrl,
          cp,
          stepOrder
        );

        if (role === "text") {
          grp.textParts.push(cleanedSection);
          if (!cp.readyToPublish) grp.primaryTask = task;
        } else if (role === "marketing") {
          grp.marketingParts.push(cleanedSection);
        } else if (role === "quality") {
          grp.qualityParts.push(cleanedSection);
        } else {
          grp.otherParts.push(cleanedSection);
        }
      }
    } else {
      const lowerHint = `${task.title ?? ""} ${cleanBody.slice(0, 120)}`.toLowerCase();
      const inferredSlot: "pagi" | "siang" | "sore" | "malam" | "umum" =
        lowerHint.includes("malam")
          ? "malam"
          : lowerHint.includes("sore")
          ? "sore"
          : lowerHint.includes("siang")
          ? "siang"
          : lowerHint.includes("pagi")
          ? "pagi"
          : "umum";

      const grp = ensureGroup(
        task.workflow_run_id ?? null,
        inferredSlot,
        task,
        channel,
        mediaUrl,
        cp,
        stepOrder
      );

      if (role === "text") {
        grp.textParts.push(cleanBody);
        if (!cp.readyToPublish) grp.primaryTask = task;
      } else if (role === "marketing") {
        grp.marketingParts.push(cleanBody);
      } else if (role === "quality") {
        grp.qualityParts.push(cleanBody);
      } else {
        grp.otherParts.push(cleanBody);
      }
    }
  }

  const slotRank: Record<string, number> = {
    pagi: 1,
    siang: 2,
    sore: 3,
    malam: 4,
    umum: 5,
  };

  return Array.from(groups.values())
    .filter(
      (g) =>
        g.textParts.length > 0 ||
        g.marketingParts.length > 0 ||
        g.otherParts.length > 0
    )
    .sort((a, b) => (slotRank[a.slotKey] ?? 9) - (slotRank[b.slotKey] ?? 9))
    .map((g) => {
      const mergedBody = [
        ...g.textParts,
        ...g.marketingParts,
        ...g.otherParts,
        ...(g.qualityParts.length > 0
          ? [`Catatan Audit Kualitas:\n${g.qualityParts.join("\n")}`]
          : []),
      ].join("\n\n");

      const slotSuffix =
        g.slotKey === "sore"
          ? " • Sore"
          : g.slotKey === "malam"
          ? " • Malam"
          : g.slotKey === "pagi"
          ? " • Pagi"
          : g.slotKey === "siang"
          ? " • Siang"
          : "";

      const primary = g.primaryTask!;
      const headline = extractCleanTitleFromContent(
        mergedBody,
        `Konten Siap Tayang${slotSuffix}`
      );

      return {
        id: g.groupKey,
        taskId: primary.id,
        sourceTaskIds: g.sourceTaskIds,
        projectId: primary.project_id ?? null,
        workflowRunId: g.runId,
        stepOrder: g.stepOrder,
        channel: g.channel,
        slotTimeLabel: getSlotScheduleLabel(g.slotKey, g.channel),
        title: `${headline}${slotSuffix}`,
        contentText: mergedBody,
        mediaUrl: g.mediaUrl,
        isReadyToPublish: g.isReadyToPublish,
        checkpointState: g.checkpointState,
      };
    });
}

export function ContentStudioWorkspace() {
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [runs, setRuns] = useState<DbWorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("all");
  const [tasks, setTasks] = useState<TaskWithPayloads[]>([]);
  const [activeTab, setActiveTab] = useState<ReadyPublishTabKey>("text");
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const [draftMediaUrls, setDraftMediaUrls] = useState<Record<string, string>>(
    {}
  );
  const [draftChannels, setDraftChannels] = useState<
    Record<string, ReadyPublishTabKey>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

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

      if (runsErr) setErrorMsg(runsErr.message);
      if (tasksErr) setErrorMsg(tasksErr.message);

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

  const allReadyItems = useMemo(() => {
    const rawItems = buildReadyPublishItems(tasks);
    if (selectedRunId === "all") return rawItems;
    return rawItems.filter((item) => item.workflowRunId === selectedRunId);
  }, [tasks, selectedRunId]);

  const countsByTab = useMemo(() => {
    return {
      story: allReadyItems.filter(
        (i) => (draftChannels[i.id] ?? i.channel) === "story"
      ).length,
      text: allReadyItems.filter(
        (i) => (draftChannels[i.id] ?? i.channel) === "text"
      ).length,
      photo: allReadyItems.filter(
        (i) => (draftChannels[i.id] ?? i.channel) === "photo"
      ).length,
      reels: allReadyItems.filter(
        (i) => (draftChannels[i.id] ?? i.channel) === "reels"
      ).length,
    };
  }, [allReadyItems, draftChannels]);

  const tabItems = useMemo(() => {
    return allReadyItems.filter(
      (i) => (draftChannels[i.id] ?? i.channel) === activeTab
    );
  }, [allReadyItems, draftChannels, activeTab]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      setErrorMsg("Gagal menyalin konten ke clipboard.");
    }
  };

  const handleMarkReadyToPublish = async (item: ReadyPublishItem) => {
    if (savingId) return;
    setSavingId(item.id);
    setErrorMsg(null);
    setInfoMsg(null);

    const finalChannel = draftChannels[item.id] ?? item.channel;
    const finalText = (draftTexts[item.id] ?? item.contentText).trim();
    const finalMedia = (draftMediaUrls[item.id] ?? item.mediaUrl).trim();

    if (!finalText) {
      setErrorMsg("Konten siap publish tidak boleh kosong.");
      setSavingId(null);
      return;
    }

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const nextCheckpoint: Record<string, unknown> = {
        ...item.checkpointState,
        slotKind: finalChannel,
        publishType:
          finalChannel === "reels"
            ? "reels"
            : finalChannel === "photo" || finalChannel === "story"
            ? "photo"
            : "text",
        caption: finalText,
        readyToPublish: true,
        scheduledForCron: true,
        preparedAt: new Date().toISOString(),
      };

      if (finalChannel === "reels") {
        nextCheckpoint.videoUrl = finalMedia;
      } else if (finalMedia) {
        nextCheckpoint.photoUrl = finalMedia;
      }

      const targetIds =
        item.sourceTaskIds.length > 0 ? item.sourceTaskIds : [item.taskId];

      const { error } = await supabase
        .from("tasks")
        .update({ checkpoint_state: nextCheckpoint })
        .in("id", targetIds)
        .eq("user_id", user.id);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      const targetIdSet = new Set(targetIds);
      setTasks((prev) =>
        prev.map((t) =>
          targetIdSet.has(t.id) ? { ...t, checkpoint_state: nextCheckpoint } : t
        )
      );
      setSavedIds((prev) => ({ ...prev, [item.id]: true }));
      setInfoMsg(
        `Konten "${item.title}" ditandai Siap Publish untuk tab ${finalChannel.toUpperCase()} (${item.slotTimeLabel}).`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan status siap publish."
      );
    } finally {
      setSavingId(null);
    }
  };

  const renderTabIcon = (key: ReadyPublishTabKey) => {
    if (key === "story") return <BookOpen className="h-3.5 w-3.5" />;
    if (key === "text") return <FileText className="h-3.5 w-3.5" />;
    if (key === "photo") return <ImageIcon className="h-3.5 w-3.5" />;
    return <Film className="h-3.5 w-3.5" />;
  };

  return (
    <div className="space-y-4">
      {isLoggedIn === false && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Anda belum login. Silakan masuk untuk melihat konten siap publish di
            Content Studio.
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

      {infoMsg && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{infoMsg}</p>
        </div>
      )}

      {/* Filter Proyek & Sesi Run */}
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
        </div>

        <Link
          href="/command-center"
          className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium text-blue-400 hover:border-blue-500/40"
        >
          Buka Command Center →
        </Link>
      </div>

      {/* 4 Tab Kanal Konten Siap Publish */}
      <div className="glass-panel rounded-2xl p-2 flex flex-wrap gap-1.5">
        {PUBLISH_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const totalInTab = countsByTab[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 min-w-[130px] inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
              }`}
            >
              {renderTabIcon(tab.key)}
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {totalInTab}
              </span>
            </button>
          );
        })}
      </div>

      {/* Daftar Konten Siap Publish pada Tab Aktif */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold">
              Konten Siap Publish —{" "}
              {PUBLISH_TABS.find((t) => t.key === activeTab)?.label} (
              {tabItems.length})
            </h2>
          </div>
          <Badge variant="emerald">
            Slot {getSlotTimeForChannel(activeTab)}
          </Badge>
        </div>

        {loading ? (
          <p className="text-xs text-slate-400 py-6">
            Memuat konten siap publish...
          </p>
        ) : tabItems.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-xs text-slate-400">
              Belum ada konten siap publish untuk tab{" "}
              <strong className="text-slate-200">
                {PUBLISH_TABS.find((t) => t.key === activeTab)?.label}
              </strong>
              .
            </p>
            <p className="text-[11px] text-slate-500">
              Anda juga bisa memindahkan item dari tab lain melalui dropdown
              kanal di kartu konten.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tabItems.map((item) => {
              const currentText = draftTexts[item.id] ?? item.contentText;
              const currentMedia = draftMediaUrls[item.id] ?? item.mediaUrl;
              const currentChannel = draftChannels[item.id] ?? item.channel;
              const isCopied = copiedId === item.id;
              const isSaving = savingId === item.id;
              const isReady =
                Boolean(savedIds[item.id]) || item.isReadyToPublish;

              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-slate-100">
                          {item.title}
                        </span>
                        <Badge variant={isReady ? "emerald" : "blue"}>
                          {isReady ? "Siap Publish" : "Draf Siap Rilis"}
                        </Badge>
                        <span className="text-[11px] text-slate-400">
                          Jadwal: {item.slotTimeLabel} ·{" "}
                          {item.sourceTaskIds.length} agen digabungkan
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <select
                        value={currentChannel}
                        onChange={(e) =>
                          setDraftChannels((prev) => ({
                            ...prev,
                            [item.id]: e.target.value as ReadyPublishTabKey,
                          }))
                        }
                        aria-label={`Pindahkan kanal untuk ${item.title}`}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200"
                      >
                        <option value="story">Tab Story</option>
                        <option value="text">Tab Teks</option>
                        <option value="photo">Tab Foto</option>
                        <option value="reels">Tab Reels</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleCopy(item.id, currentText)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>Tersalin</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-blue-400" />
                            <span>Salin Konten</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleMarkReadyToPublish(item)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <CalendarClock className="h-3 w-3" />
                        <span>
                          {isSaving
                            ? "Menyimpan..."
                            : isReady
                            ? "Perbarui Siap Publish"
                            : "Tandai Siap Publish"}
                        </span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={currentText}
                    onChange={(e) =>
                      setDraftTexts((prev) => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-700/70 bg-slate-950/80 p-3 text-xs leading-relaxed text-slate-200 focus:border-blue-500 focus:outline-none"
                  />

                  {(currentChannel === "photo" ||
                    currentChannel === "story" ||
                    currentChannel === "reels" ||
                    currentMedia) && (
                    <div className="space-y-2">
                      <input
                        type="url"
                        value={currentMedia}
                        onChange={(e) =>
                          setDraftMediaUrls((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        placeholder={
                          currentChannel === "reels"
                            ? "URL video Reels (.mp4) siap publish..."
                            : "URL gambar / visual (.jpg/.png/.webp) siap publish..."
                        }
                        className="w-full rounded-xl border border-slate-700/70 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      />

                      {currentMedia &&
                        /^https?:\/\//i.test(currentMedia) &&
                        !currentMedia.includes("...") &&
                        currentChannel !== "reels" && (
                          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-1.5">
                            <img
                              src={currentMedia}
                              alt={item.title}
                              className="max-h-48 w-full rounded-lg object-cover"
                            />
                          </div>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
