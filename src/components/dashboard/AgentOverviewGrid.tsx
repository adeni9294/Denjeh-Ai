"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MULTI_AGENT_SPECIALISTS } from "@/lib/ai/agent-tools";
import { Badge } from "@/components/ui/Badge";
import { Bot, ArrowUpRight } from "lucide-react";

interface TaskAgentSummaryRow {
  status: string;
  agent_code: string | null;
  input_payload: Record<string, unknown> | null;
}

export function AgentOverviewGrid() {
  const [completedCounts, setCompletedCounts] = useState<
    Record<string, number>
  >({});
  const [runningCodes, setRunningCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: taskRows } = await supabase
          .from("tasks")
          .select("status, agent_code, input_payload")
          .eq("user_id", user.id)
          .limit(200);

        const counts: Record<string, number> = {};
        const active = new Set<string>();

        for (const row of (taskRows as TaskAgentSummaryRow[]) ?? []) {
          const payload = (row.input_payload ?? {}) as Record<string, unknown>;
          const rawCode = String(
            payload.agentCode ?? row.agent_code ?? ""
          )
            .toLowerCase()
            .trim();
          const code = rawCode === "video" ? "reels" : rawCode;
          if (!code) continue;

          if (row.status === "completed") {
            counts[code] = (counts[code] ?? 0) + 1;
          } else if (row.status === "running") {
            active.add(code);
          }
        }

        setCompletedCounts(counts);
        setRunningCodes(active);
      } catch {
        // Abaikan error pemuatan ringkasan agen
      }
    })();
  }, []);

  return (
    <section id="agents" className="glass-panel rounded-2xl p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold">
            Multi-Agent Roster ({MULTI_AGENT_SPECIALISTS.length} Spesialis)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Spesialis konten Teks, Story, Foto, dan Reels dengan izin alat
            terpisah
          </p>
        </div>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:underline"
        >
          <span>Kelola Agen</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {MULTI_AGENT_SPECIALISTS.map((agent) => {
          const isBusy = runningCodes.has(agent.code);
          const doneCount = completedCounts[agent.code] ?? 0;

          return (
            <div
              key={agent.code}
              className="flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3.5 transition hover:border-blue-500/40"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
                    <Bot className="h-4 w-4" />
                  </div>
                  <Badge variant={isBusy ? "amber" : "emerald"}>
                    {isBusy ? "busy" : "ready"}
                  </Badge>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{agent.name}</h3>
                <p className="text-[11px] font-medium text-blue-500 dark:text-blue-400">
                  {agent.title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {agent.role}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-studio-border flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span className="truncate max-w-[130px]">
                  {agent.preferredTier}
                </span>
                <span>{doneCount} tugas</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
