"use client";

import React, { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TopHeader } from "./TopHeader";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Pendaftaran SW gagal secara senyap jika browser membatasi
      });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-studio-navy text-slate-900 dark:text-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col sm:pl-20 lg:pl-64 pb-20 sm:pb-8">
        <TopHeader />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}