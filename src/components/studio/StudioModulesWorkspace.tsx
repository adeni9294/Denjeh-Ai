"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Free)" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (Free)" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile (Groq)" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant (Groq)" },
];

// Filter otomatis untuk menghapus accessToken, blok prepare_facebook_page_payload, dan pesan (#200)
function sanitizeCaptionText(raw: string, fallbackTitle: string): string {
  const cleaned = raw
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

  const getPublishItemState = (t: TaskWithPayloads): PublishItemState => {
    if (publishItems[t.id]) return publishItems[t.id];
    const out = (t.output_payload ?? {}) as Record<string, unknown>;
    const payload = (t.input_payload ?? {}) as Record<string, unknown>;
    const cp = (t.checkpoint_state ?? {}) as Record<string, unknown>;
    const agCode = String(payload.agentCode ?? "").toLowerCase();
    const fallbackType: "reels" | "photo" | "text" =
      agCode === "video"
        ? "reels"
        : agCode === "visual" || agCode === "character"
        ? "photo"
        : "text";
    const cpType =
      cp.publishType === "reels" ||
      cp.publishType === "photo" ||
      cp.publishType === "text"
        ? cp.publishType
        : fallbackType;

    const rawCaption = String(
      cp.caption || out.contentMarkdown || out.summary || t.title
    );

    return {
      publishType: cpType,
      videoUrl: String(cp.videoUrl ?? ""),
      photoUrl: String(cp.photoUrl ?? ""),
      caption: sanitizeCaptionText(rawCaption, t.title),
      autoPublishOnRender: Boolean(cp.autoPublishFacebook ?? true),
    };
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
            ? "Mode otomatis aktif: saat callback render masuk atau dijalankan, posting ke Facebook berjalan otomatis."
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

    const cleanCaption = sanitizeCaptionText(item.caption, t.title);

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
            autoPublishFacebook: item.autoPublishOnRender,
            publishType: item.publishType,
            videoUrl: item.videoUrl,
            photoUrl: item.photoUrl,
            caption: cleanCaption,
          },
        })
        .eq("id", t.id);

      if (!item.autoPublishOnRender) {
        setPublishFeedback((prev) => ({
          ...prev,
          [t.id]: {
            ok: true,
            message:
              "Data render tersimpan (Render Selesai). Aktifkan Auto-Render→FB: ON atau klik Auto-Post Facebook untuk mempublikasikan.",
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
          publishType: item.publishType,
          caption: cleanCaption,
          videoUrl: item.videoUrl,
          photoUrl: item.photoUrl,
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

  const handleFacebookAutoPost = async (t: TaskWithPayloads) => {
    if (publishingTaskId || runningAutoTaskId) return;
    const item = getPublishItemState(t);
    const cleanCaption = sanitizeCaptionText(item.caption, t.title);
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
          publishType: item.publishType,
          caption: cleanCaption,
          videoUrl: item.videoUrl,
          photoUrl: item.photoUrl,
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
        <div className="space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold">
                  Koneksi Facebook Page Graph API & Otomatisasi App
                </h2>
                <p className="text-xs text-slate-400">
                  Jalankan alur otomatis (simpan hasil render + posting Video
                  Reels, Foto, atau Teks ke Facebook Page) langsung dari
                  aplikasi DENJEH AI atau via webhook{" "}
                  <code className="text-blue-300">/api/render/callback</code>.
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

          <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold">
                  Publishing Center — Paket Video Reels, Foto & Teks (
                  {completedTasks.length})
                </h2>
              </div>
              <Badge variant="purple">3 Format Output</Badge>
            </div>

            {completedTasks.length === 0 ? (
              <p className="text-xs text-slate-400">
                Belum ada tugas selesai. Jalankan agen di AI Command Center
                untuk menyiapkan materi rilis.
              </p>
            ) : (
              <div className="space-y-3">
                {completedTasks.map((t) => {
                  const item = getPublishItemState(t);
                  const feedback = publishFeedback[t.id];
                  const isPublishingThis = publishingTaskId === t.id;
                  const isRunningAutoThis = runningAutoTaskId === t.id;
                  const cp = (t.checkpoint_state ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const publishedId = String(cp.facebookPostId ?? "");
                  const renderStatus = String(cp.renderStatus ?? "");

                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 space-y-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              {t.title}
                            </span>
                            {renderStatus === "completed" && (
                              <Badge variant="emerald">Render Selesai</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                            <span>Task ID:</span>
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                              {t.id}
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
                                  <span>Salin Task ID</span>
                                </>
                              )}
                            </button>
                          </div>
                          {publishedId && (
                            <p className="text-[11px] text-emerald-400">
                              Terakhir rilis ke FB Post ID: {publishedId}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleAutoPublishOnRender(t, item)
                            }
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                              item.autoPublishOnRender
                                ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                                : "border-slate-700 bg-slate-800/70 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <Zap className="h-3 w-3" />
                            <span>
                              {item.autoPublishOnRender
                                ? "Auto-Render→FB: ON"
                                : "Auto-Render→FB: OFF"}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={isRunningAutoThis || isPublishingThis}
                            onClick={() =>
                              handleRunAutomatedPipelineFromApp(t, item)
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" />
                            <span>
                              {isRunningAutoThis
                                ? "Menjalankan..."
                                : "Jalankan Otomatis"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyText(t.id, item.caption)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                          >
                            {copiedKey === t.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span>Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-blue-400" />
                                <span>Salin Caption</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isPublishingThis || isRunningAutoThis}
                            onClick={() => handleFacebookAutoPost(t)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                          >
                            <Send className="h-3 w-3" />
                            <span>
                              {isPublishingThis
                                ? "Mempublikasikan..."
                                : "Auto-Post Facebook"}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-400">
                          Format Publikasi:
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updatePublishItemState(t.id, item, {
                              publishType: "reels",
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border ${
                            item.publishType === "reels"
                              ? "border-purple-500 bg-purple-600/25 text-purple-200"
                              : "border-slate-700 bg-slate-800/60 text-slate-400"
                          }`}
                        >
                          <Video className="h-3 w-3" />
                          <span>Video Reels</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updatePublishItemState(t.id, item, {
                              publishType: "photo",
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border ${
                            item.publishType === "photo"
                              ? "border-blue-500 bg-blue-600/25 text-blue-200"
                              : "border-slate-700 bg-slate-800/60 text-slate-400"
                          }`}
                        >
                          <ImageIcon className="h-3 w-3" />
                          <span>Foto</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updatePublishItemState(t.id, item, {
                              publishType: "text",
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium border ${
                            item.publishType === "text"
                              ? "border-emerald-500 bg-emerald-600/25 text-emerald-200"
                              : "border-slate-700 bg-slate-800/60 text-slate-400"
                          }`}
                        >
                          <FileText className="h-3 w-3" />
                          <span>Teks</span>
                        </button>
                      </div>

                      {item.publishType === "reels" && (
                        <div className="space-y-1">
                          <label className="text-[11px] text-purple-300 font-medium">
                            URL Video Reels (MP4 publik hasil render Seedance /
                            Flow)
                          </label>
                          <input
                            type="url"
                            value={item.videoUrl}
                            onChange={(e) =>
                              updatePublishItemState(t.id, item, {
                                videoUrl: e.target.value,
                              })
                            }
                            placeholder="https://.../dnaverse-reels.mp4"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-200"
                          />
                        </div>
                      )}

                      {item.publishType === "photo" && (
                        <div className="space-y-1">
                          <label className="text-[11px] text-blue-300 font-medium">
                            URL Foto / Cover (JPG/PNG publik)
                          </label>
                          <input
                            type="url"
                            value={item.photoUrl}
                            onChange={(e) =>
                              updatePublishItemState(t.id, item, {
                                photoUrl: e.target.value,
                              })
                            }
                            placeholder="https://.../dnaverse-keyframe.png"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-200"
                          />
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">
                          Teks Caption / Hook / Tagar Rilis
                        </label>
                        <textarea
                          rows={4}
                          value={item.caption}
                          onChange={(e) =>
                            updatePublishItemState(t.id, item, {
                              caption: e.target.value,
                            })
                          }
                          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 p-2.5 text-xs text-slate-200"
                        />
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
