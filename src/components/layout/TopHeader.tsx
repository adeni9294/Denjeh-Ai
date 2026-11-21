"use client";

import React from "react";
import { Cpu, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Badge } from "@/components/ui/Badge";

export function TopHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 dark:border-studio-border bg-white/85 dark:bg-studio-navy/85 backdrop-blur-md px-4 sm:px-6">
      {/* Mobile Brand */}
      <div className="flex items-center gap-2.5 sm:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 text-white">
          <Cpu className="h-4 w-4" />
        </div>
        <span className="font-bold text-sm tracking-wide">
          DENJEH <span className="text-blue-500">AI</span>
        </span>
      </div>

      {/* Desktop/Tablet Context Info */}
      <div className="hidden sm:flex items-center gap-3">
        <Badge variant="blue">Fase 1: UI & PWA Shell</Badge>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Timezone: Asia/Jakarta (WIB)
        </span>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2.5">
        <div className="hidden md:flex items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Free-First Mode</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}