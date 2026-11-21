"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  INITIAL_COMMAND_HISTORY,
  INITIAL_PROJECTS,
} from "@/data/mockPhase1Data";
import { CommandMessage } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Bot,
  CheckCircle2,
  Play,
  Send,
  SlidersHorizontal,
  User,
} from "lucide-react";

export function CommandWorkspace() {
  const searchParams = useSearchParams();
  const [selectedProject, setSelectedProject] = useState(INITIAL_PROJECTS[0].id);
  const [mode, setMode] = useState<"manual" | "autonomous">("manual");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CommandMessage[]>(
    INITIAL_COMMAND_HISTORY
  );

  useEffect(() => {
    const initialQuery = searchParams.get("q");
    if (initialQuery) {
      setInput(initialQuery);
    }
  }, [searchParams]);

  const handleSendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    const projectObj = INITIAL_PROJECTS.find((p) => p.id === selectedProject);
    const userMsg: CommandMessage = {
      id: `msg-${Date.now()}`,
      sender: "user",
      timestamp: "Baru saja",
      mode,
      content: trimmed,
    };

    const orchestratorPreview: CommandMessage = {
      id: `msg-${Date.now() + 1}`,
      sender: "orchestrator",
      timestamp: "Baru saja",
      mode,
      requiresApproval: mode === "manual",
      approved: mode === "autonomous",
      content: `[Simulasi Rencana Fase 1] Instruksi diterima untuk proyek "${
        projectObj?.name ?? "Default"
      }" dalam mode ${mode.toUpperCase()}. Pada Fase 5–6, rencana JSON ini akan dikirim ke Cloudflare Queues untuk dieksekusi oleh agen sungguhan.`,
      plan: [
        {
          stepNumber: 1,
          agentName: "Idea & Research Agent",
          action: "Menganalisis objektif perintah dan menarik memori proyek terkait.",
          dependsOn: "User Prompt",
          estimatedOutput: "Brief Kreatif Terstruktur",
        },
        {
          stepNumber: 2,
          agentName: "Story & Visual Agent",
          action: "Menyusun draf konten utama dan arahan visual/prompt.",
          dependsOn: "Step 1",
          estimatedOutput: "Draf Artefak Kreatif",
        },
        {
          stepNumber: 3,
          agentName: "Quality Agent",
          action: "Memvalidasi hasil terhadap standar kualitas & konsistensi proyek.",
          dependsOn: "Step 2",
          estimatedOutput: "Status Lolos Uji / Catatan Revisi",
        },
      ],
    };

    setMessages((prev) => [...prev, userMsg, orchestratorPreview]);
    setInput("");
  };

  const handleApprovePlan = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, approved: true } : m))
    );
  };

  return (
    <div className="space-y-4">
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
            {INITIAL_PROJECTS.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name}
              </option>
            ))}
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
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-5 max-h-[60vh] overflow-y-auto">
        {messages.map((msg) => (
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
              <p className="text-sm leading-relaxed">{msg.content}</p>

              {/* Structured Execution Plan */}
              {msg.plan && (
                <div className="mt-4 space-y-2 border-t border-slate-200 dark:border-studio-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-500 dark:text-blue-400">
                      Rencana Eksekusi Multi-Agen (DAG)
                    </span>
                    <Badge variant={msg.approved ? "emerald" : "amber"}>
                      {msg.approved ? "Disetujui & Siap Antre" : "Menunggu Persetujuan"}
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
                        <p className="mt-1 text-[11px] text-purple-500 dark:text-purple-400">
                          Output: {step.estimatedOutput}
                        </p>
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
                        <span>Setujui & Jalankan Rencana</span>
                      </button>
                    </div>
                  )}

                  {msg.approved && (
                    <div className="pt-1 flex items-center gap-1.5 text-xs text-emerald-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Rencana dikonfirmasi (Antrean cloud nyata akan dihubungkan di Fase 6–7).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Command Input Form */}
      <form
        onSubmit={handleSendCommand}
        className="glass-panel rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row gap-2.5"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tulis instruksi kreatif, permintaan revisi, atau arahan proyek ke Master Orchestrator..."
          className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-3 text-sm font-semibold text-white hover:opacity-95 sm:self-end"
        >
          <span>Kirim Instruksi</span>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}