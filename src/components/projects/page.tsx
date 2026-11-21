"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbProject } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  FolderPlus,
  FolderKanban,
  ArrowRight,
  Archive,
  RotateCcw,
  AlertCircle,
  Lock,
} from "lucide-react";

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 48) +
    "-" +
    Math.random().toString(36).slice(2, 6)
  );
}

export function ProjectsManager() {
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [defaultMode, setDefaultMode] = useState<"manual" | "autonomous">("manual");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setProjects([]);
        setLoading(false);
        return;
      }

      setUserId(user.id);
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setProjects((data as DbProject[]) ?? []);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat proyek.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !name.trim()) return;

    setCreating(true);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("projects").insert({
        user_id: userId,
        name: name.trim(),
        slug: slugify(name),
        description: description.trim() || null,
        system_instructions: systemInstructions.trim() || null,
        default_mode: defaultMode,
        status: "active",
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setName("");
        setDescription("");
        setSystemInstructions("");
        await loadProjects();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal membuat proyek.");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleArchive = async (project: DbProject) => {
    const nextStatus = project.status === "archived" ? "active" : "archived";
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("projects")
        .update({ status: nextStatus })
        .eq("id", project.id);

      if (error) {
        setErrorMsg(error.message);
      } else {
        await loadProjects();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal mengubah status proyek.");
    }
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-sm text-slate-400">
        Memuat Project Workspaces dari Supabase...
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="glass-panel rounded-2xl p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-400">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Login Diperlukan</h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Silakan masuk ke akun DENJEH AI Anda terlebih dahulu untuk membuat dan mengelola Project Workspaces terisolasi.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Masuk Sekarang
        </Link>
      </div>
    );
  }

  const visibleProjects = projects.filter((p) =>
    showArchived ? p.status === "archived" : p.status !== "archived"
  );

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Form Buat Proyek Baru */}
      <form
        onSubmit={handleCreateProject}
        className="glass-panel rounded-2xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <FolderPlus className="h-5 w-5 text-blue-500" />
          <h2 className="text-base font-semibold">Buat Project Workspace Baru</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5">Nama Proyek *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: DNAverse — The Awakening"
              className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Mode Operasi Default</label>
            <select
              value={defaultMode}
              onChange={(e) => setDefaultMode(e.target.value as "manual" | "autonomous")}
              className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="manual">Manual (Dengan Persetujuan)</option>
              <option value="autonomous">Autonomous (Otomatis Terjadwal)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">Deskripsi Proyek</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ringkasan singkat tujuan kreatif, target audiens, atau format konten..."
            className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">
            Instruksi Khusus Proyek (Project System Instructions)
          </label>
          <textarea
            rows={2}
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
            placeholder="Aturan wajib untuk seluruh agen di proyek ini (misal: gaya visual, bahasa, larangan merek)..."
            className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            <FolderPlus className="h-4 w-4" />
            <span>{creating ? "Menyimpan..." : "Simpan Proyek"}</span>
          </button>
        </div>
      </form>

      {/* Filter Tab Aktif / Arsip */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {showArchived ? "Proyek Diarsipkan" : "Proyek Aktif"} ({visibleProjects.length})
        </h2>
        <button
          type="button"
          onClick={() => setShowArchived((prev) => !prev)}
          className="text-xs font-medium text-blue-500 hover:underline"
        >
          {showArchived ? "Lihat Proyek Aktif" : "Lihat Arsip Proyek"}
        </button>
      </div>

      {/* Daftar Proyek */}
      {visibleProjects.length === 0 ? (
        <div className="glass-panel rounded-2xl p-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          {showArchived
            ? "Belum ada proyek yang diarsipkan."
            : "Belum ada proyek tersimpan. Buat proyek pertama Anda menggunakan formulir di atas."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleProjects.map((project) => (
            <div
              key={project.id}
              className="glass-panel rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <FolderKanban className="h-5 w-5 text-purple-400 shrink-0" />
                    <h3 className="text-base font-semibold">{project.name}</h3>
                  </div>
                  <Badge variant={project.status === "active" ? "emerald" : "slate"}>
                    {project.status}
                  </Badge>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {project.description || "Belum ada deskripsi proyek."}
                </p>

                {project.system_instructions && (
                  <div className="mt-3 rounded-xl bg-slate-100 dark:bg-studio-navy p-2.5 text-[11px] text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-studio-border">
                    <span className="font-semibold text-blue-400">Instruksi: </span>
                    {project.system_instructions}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200/70 dark:border-studio-border flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleArchive(project)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400"
                >
                  {project.status === "archived" ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Pulihkan</span>
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5" />
                      <span>Arsipkan</span>
                    </>
                  )}
                </button>

                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600/15 border border-blue-500/30 px-3.5 py-2 text-xs font-semibold text-blue-400 hover:bg-blue-600/25"
                >
                  <span>Buka Workspace & Memori</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
