"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TerminalSquare,
  FolderKanban,
  Bot,
  GitBranch,
  Sparkles,
  CalendarDays,
  Send,
  BarChart3,
  Database,
  Cpu,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  phaseReady: boolean;
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, phaseReady: true },
  { label: "AI Command Center", href: "/command-center", icon: TerminalSquare, phaseReady: true },
  { label: "Projects", href: "/projects", icon: FolderKanban, phaseReady: true },
  { label: "Agent Studio", href: "/agents", icon: Bot, phaseReady: true },
  { label: "Workflow Builder", href: "/workflows", icon: GitBranch, phaseReady: true },
  { label: "Content Studio", href: "/content-studio", icon: Sparkles, phaseReady: true },
  { label: "Content Planner", href: "/planner", icon: CalendarDays, phaseReady: true },
  { label: "Publishing Center", href: "/publishing", icon: Send, phaseReady: true },
  { label: "Analytics", href: "/analytics", icon: BarChart3, phaseReady: true },
  { label: "Memory & Settings", href: "/memory", icon: Database, phaseReady: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden sm:flex sm:w-20 lg:w-64 sm:flex-col sm:fixed sm:inset-y-0 z-30 border-r border-slate-200 dark:border-studio-border bg-white dark:bg-studio-surface transition-all">
      {/* Brand Header */}
      <div className="flex h-16 items-center gap-3 px-4 lg:px-5 border-b border-slate-200 dark:border-studio-border">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-sm">
          <Cpu className="h-5 w-5" />
        </div>
        <div className="hidden lg:block overflow-hidden">
          <div className="font-bold tracking-wide text-slate-900 dark:text-white">
            DENJEH <span className="text-blue-500">AI</span>
          </div>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            Autonomous Creative Studio
          </p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4">
        {MAIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              title={item.label}
              className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-blue-600/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-studio-card dark:hover:text-slate-100"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
              </div>
              {!item.phaseReady && (
                <span className="hidden lg:inline rounded bg-slate-200/80 dark:bg-studio-navy px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  Soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Cloud Lightweight Status */}
      <div className="hidden lg:block border-t border-slate-200 dark:border-studio-border p-4">
        <div className="rounded-xl bg-slate-100 dark:bg-studio-navy p-3 border border-slate-200 dark:border-studio-border">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-slate-600 dark:text-slate-300">Arsitektur Cloud</span>
            <span className="text-emerald-500">● Siap</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            0% beban GPU/LLM lokal. Optimal untuk perangkat RAM 4 GB.
          </p>
        </div>
      </div>
    </aside>
  );
}
