"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CommandMessage, DbProject } from "@/types/studio";
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
} from "lucide-react";

interface AttachmentRef {
  name: string;
  type: string;
  note?: string;
}

export function CommandWorkspace() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [mode, setMode] = useState<"manual" | "autonomous">("manual");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [messages, setMessages] = useState<CommandMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

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
    const initialQuery = searchParams.get("q");
    if (initialQuery) {
      setInput(initialQuery);
    }
  }, [searchParams]);

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

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || submitting) return;

    setErrorMsg(null);
    setSubmitting(true);

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

    const lastOrchestratorMsg = [...messages]
      .reverse()
      .find((m) => m.sender === "orchestrator" && m.plan);

    const previousPlanSummary = lastOrchestratorMsg
      ? `${lastOrchestratorMsg.content}\nLangkah sebelumnya: ${lastOrchestratorMsg.plan
          ?.map((s) => `${s.stepNumber}. ${s.agentName}: ${s.action}`)
          .join("; ")}`
      : undefined;

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
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
        planResult?: {
          intentSummary: string;
          steps: {
            stepNumber: number;
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
        setErrorMsg(data.error ?? "Gagal memproses instruksi di Master Orchestrator.");
        setSubmitting(false);
        return;
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
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Koneksi ke server gagal."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePlan = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, approved: true } : m))
    );
  };

  const handleRequestRevision = (stepTitle: string) => {
    setInput(`Revisi bagian "${stepTitle}": `);
  };

  return (
    <div className="space-y-4">
      {isLoggedIn === false && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Anda belum login. Silakan masuk terlebih dahulu agar Master Orchestrator dapat mengakses proyek, memori, dan API key Anda.
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
            <p className="font-semibold">Gagal Menyusun Rencana</p>
            <p>{errorMsg}</p>
            <Link href="/providers" className="inline-block underline text-blue-400">
              Periksa pengaturan AI Provider Manager →
            </Link>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" />
            <span>Proyek Aktif:</span>
          </div>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
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

        {/* Mode Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Mode:</span>
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
              Manual (Approval)
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
        </div>
      </div>

      {/* Conversation & Execution Plan Feed */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-5 min-h-[340px] max-h-[62vh] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="py-10 text-center space-y-3 max-w-xl mx-auto">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-400">
              <Bot className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold">Master Orchestrator Siap</h3>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Tulis instruksi produksi kreatif di bawah. Master Orchestrator akan menarik memori proyek terpilih dan menyusun rencana kerja lintas agen secara terstruktur.
            </p>
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
                    {msg.sender === "user" ? "Anda" : "Master Orchestrator"}
                  </span>
                  <span>{msg.timestamp}</span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-line">{msg.content}</p>

                {/* Structured Execution Plan */}
                {msg.plan && (
                  <div className="mt-4 space-y-2 border-t border-slate-200 dark:border-studio-border pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-500 dark:text-blue-400">
                        Rencana Eksekusi Multi-Agen (JSON DAG)
                      </span>
                      <Badge variant={msg.approved ? "emerald" : "amber"}>
                        {msg.approved ? "Disetujui" : "Menunggu Persetujuan"}
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
                              onClick={() => handleRequestRevision(step.agentName)}
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
                          onClick={() => handleApprovePlan(msg.id)}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>Setujui Rencana Eksekusi</span>
                        </button>
                      </div>
                    )}

                    {msg.approved && (
                      <div className="pt-1 flex items-center gap-1.5 text-xs text-emerald-500">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>
                          Rencana disetujui. Antrean eksekusi paralel tiap agen akan dihubungkan di Fase 6–7.
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

      {/* Attachment Chips */}
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

      {/* Command Input Form */}
      <form
        onSubmit={handleSendCommand}
        className="glass-panel rounded-2xl p-3 sm:p-4 space-y-2.5"
      >
        <textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tulis instruksi kreatif atau permintaan revisi lanjutan ke Master Orchestrator..."
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
            <span>{submitting ? "Menyusun Rencana..." : "Kirim Instruksi"}</span>
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
