"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TerminalSquare,
  FolderKanban,
  Bot,
  Menu,
  X,
} from "lucide-react";
import { MAIN_NAV_ITEMS } from "./Sidebar";

const MOBILE_PRIMARY_TABS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Command", href: "/command-center", icon: TerminalSquare },
  { label: "Projects", href: "/#projects", icon: FolderKanban },
  { label: "Agents", href: "/#agents", icon: Bot },
];

export function BottomNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Full Navigation Drawer for Mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden bg-slate-950/75 backdrop-blur-sm flex flex-col justify-end">
          <div className="rounded-t-2xl border-t border-studio-border bg-white dark:bg-studio-surface p-5 max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-studio-border">
              <span className="font-semibold text-sm">Semua Modul Studio</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-studio-card"
                aria-label="Tutup menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {MAIN_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-card p-3 text-xs font-medium"
                  >
                    <Icon className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Fixed Bottom Bar (< 640px) */}
      <nav
        aria-label="Navigasi Mobile"
        className="fixed bottom-0 inset-x-0 z-40 sm:hidden border-t border-slate-200 dark:border-studio-border bg-white/95 dark:bg-studio-surface/95 backdrop-blur-md"
      >
        <div className="grid grid-cols-5 h-16">
          {MOBILE_PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.label}
                href={tab.href}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400"
          >
            <Menu className="h-5 w-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    </>
  );
}