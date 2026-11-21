"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbMemory, DbProject } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  Brain,
  Plus,
  Trash2,
  Save,
  SlidersHorizontal,
  AlertCircle,
  CheckCircle2,
  Search,
} from "lucide-react";

type MemoryRow = DbMemory & {
  scope?: string | null;
  memory_key?: string | null;
  importance?: number | null;
  project_id?: string | null;
};

type ProjectRow = DbProject & {
  system_instructions?: string | null;
};

export function MemorySettingsWorkspace() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "project" | "user">("all");

  // Form tambah memori baru
  const [newKey, setNewKey] = useState("");
  const [newScope, setNewScope] = useState<"project" | "user">("project");
  const [newImportance, setNewImportance] = useState<number>(7);
  const [newContent, setNewContent] = useState("");

  // System instructions proyek aktif
  const [systemInstructions, setSystemInstructions] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);

  // Edit inline memori
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editImportance, setEditImportance] = useState<number>(7);

  const [loading, setLoading] = useState(true);
  const [savingNew, setSavingNew] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const loadMemories = useCallback(async (projectId: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from("memories")
        .select("*")
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);

      if (projectId) {
        query = query.or(
          `project_id.eq.${projectId},and(scope.eq.user,project_id.is.null)`
        );
      }

      const { data, error } = await query;
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setMemories((data as MemoryRow[]) ?? []);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memuat data memori."
      );
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
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
      const { data: projRows } = await supabase
        .from("projects")
        .select("*")
        .neq("status", "archived")
        .order("updated_at", { ascending: false });

      const list = (projRows as ProjectRow[]) ?? [];
      setProjects(list);

      if (list.length > 0) {
        const defaultProj = list[0];
        setSelectedProject((prev) => prev || defaultProj.id);
        setSystemInstructions(String(defaultProj.system_instructions ?? ""));
      }
    } catch {
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const activeProj = projects.find((p) => p.id === selectedProject);
    setSystemInstructions(String(activeProj?.system_instructions ?? ""));
    loadMemories(selectedProject);
  }, [selectedProject, projects, isLoggedIn, loadMemories]);

  const handleSaveSystemInstructions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || savingInstructions) return;
    setSavingInstructions(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("projects")
        .update({
          system_instructions: systemInstructions,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedProject);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setProjects((prev) =>
        prev.map((p) =>
          p.id === selectedProject
            ? { ...p, system_instructions: systemInstructions }
            : p
        )
      );
      setNoticeMsg("System Instructions proyek berhasil diperbarui.");
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan System Instructions."
      );
    } finally {
      setSavingInstructions(false);
    }
  };

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    const contentTrimmed = newContent.trim();
    if (!contentTrimmed || savingNew) return;

    setSavingNew(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErrorMsg("Sesi tidak valid. Silakan login terlebih dahulu.");
        return;
      }

      const keyNormalized =
        (newKey.trim() || `catatan_${Date.now()}`)
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, "_");

      const clampedImp = Math.min(10, Math.max(1, Number(newImportance) || 7));

      const { error } = await supabase.from("memories").insert({
        user_id: user.id,
        project_id: newScope === "project" ? selectedProject || null : null,
        scope: newScope,
        memory_key: keyNormalized,
        content: contentTrimmed,
        importance: clampedImp,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setNewKey("");
      setNewContent("");
      setNoticeMsg("Memori baru berhasil ditambahkan.");
      await loadMemories(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menambahkan memori."
      );
    } finally {
      setSavingNew(false);
    }
  };

  const startEditMemory = (m: MemoryRow) => {
    setEditingId(m.id);
    setEditContent(String(m.content ?? ""));
    setEditImportance(Number(m.importance ?? 7));
  };

  const handleUpdateMemory = async (id: string) => {
    if (!editContent.trim()) return;
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("memories")
        .update({
          content: editContent.trim(),
          importance: Math.min(10, Math.max(1, Number(editImportance) || 7)),
        })
        .eq("id", id);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setEditingId(null);
      setNoticeMsg("Perubahan memori berhasil disimpan.");
      await loadMemories(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal memperbarui memori."
      );
    }
  };

  const handleDeleteMemory = async (id: string) => {
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("memories").delete().eq("id", id);
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      setNoticeMsg("Memori berhasil dihapus.");
      await loadMemories(selectedProject);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menghapus memori."
      );
    }
  };

  const filteredMemories = memories.filter((m) => {
    const scopeVal = String(m.scope ?? "project");
    if (scopeFilter !== "all" && scopeVal !== scopeFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      String(m.memory_key ?? "").toLowerCase().includes(q) ||
      String(m.content ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {isLoggedIn === false && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Anda belum login. Silakan masuk terlebih dahulu untuk mengelola
            memori dan pengaturan proyek.
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

      {noticeMsg && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p>{noticeMsg}</p>
        </div>
      )}

      {/* Selector Proyek */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" />
            <span>Proyek Aktif:</span>
          </div>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="Pilih Proyek Memori"
            className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-1.5 text-xs font-medium focus:border-blue-500 focus:outline-none"
          >
            {projects.length === 0 ? (
              <option value="">Belum ada proyek</option>
            ) : (
              projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))
            )}
          </select>
        </div>

        <Link
          href="/command-center"
          className="text-xs font-medium text-blue-400 hover:underline"
        >
          Kembali ke AI Command Center →
        </Link>
      </div>

      {/* System Instructions Proyek */}
      {isLoggedIn && selectedProject && (
        <form
          onSubmit={handleSaveSystemInstructions}
          className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              System Instructions Proyek
            </h2>
            <Badge variant="blue">Konteks Master Orchestrator</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Instruksi dasar ini otomatis dikirim ke Master Orchestrator dan
            agen setiap kali rencana atau tugas baru dijalankan.
          </p>
          <textarea
            rows={3}
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
            placeholder="Contoh: Fokus pada live-action fantasy action berdurasi 60 detik dengan kontinuitas kostum dan karakter yang ketat..."
            className="w-full resize-none rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-xs focus:border-blue-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingInstructions}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>
                {savingInstructions ? "Menyimpan..." : "Simpan System Instructions"}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Form Tambah Memori Baru */}
      {isLoggedIn && (
        <form
          onSubmit={handleCreateMemory}
          className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Tambah Memori Baru</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Kunci memori (misal: karakter_aria)"
              className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
            <select
              value={newScope}
              onChange={(e) =>
                setNewScope(e.target.value === "user" ? "user" : "project")
              }
              aria-label="Scope Memori"
              className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="project">Scope: Project</option>
              <option value="user">Scope: User (Global)</option>
            </select>
            <input
              type="number"
              min={1}
              max={10}
              value={newImportance}
              onChange={(e) => setNewImportance(Number(e.target.value))}
              aria-label="Prioritas Kepentingan (1-10)"
              className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <textarea
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Tulis fakta, aturan kontinuitas, keputusan visual, atau ringkasan output agen..."
            className="w-full resize-none rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-xs focus:border-blue-500 focus:outline-none"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingNew || !newContent.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{savingNew ? "Menyimpan..." : "Simpan Memori"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Daftar Memori Tersimpan */}
      {isLoggedIn && (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-400" />
              <h2 className="text-base font-semibold">
                Memori Tersimpan ({filteredMemories.length})
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari memori..."
                  className="rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy pl-8 pr-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="inline-flex rounded-xl border border-slate-200 dark:border-studio-border bg-slate-100 dark:bg-studio-navy p-0.5 text-[11px]">
                {(["all", "project", "user"] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setScopeFilter(sc)}
                    className={`rounded-lg px-2.5 py-1 font-medium ${
                      scopeFilter === sc
                        ? "bg-purple-600 text-white"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {sc === "all" ? "Semua" : sc}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-slate-400 py-4">Memuat memori...</p>
          ) : filteredMemories.length === 0 ? (
            <p className="text-xs text-slate-400 py-4">
              Belum ada memori yang cocok dengan filter saat ini.
            </p>
          ) : (
            <div className="space-y-2.5">
              {filteredMemories.map((m) => {
                const isEditing = editingId === m.id;
                return (
                  <div
                    key={m.id}
                    className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-blue-300">
                          {String(m.memory_key || "memori")}
                        </span>
                        <Badge
                          variant={
                            String(m.scope) === "project" ? "purple" : "blue"
                          }
                        >
                          {String(m.scope || "project")}
                        </Badge>
                        <span className="text-[11px] text-slate-400">
                          Bobot: {Number(m.importance ?? 5)}/10
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!isEditing ? (
                          <button
                            type="button"
                            onClick={() => startEditMemory(m)}
                            className="rounded-lg border border-slate-600/40 bg-slate-800/70 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700/70"
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUpdateMemory(m.id)}
                            className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-600/30"
                          >
                            Simpan
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteMemory(m.id)}
                          aria-label="Hapus memori"
                          className="rounded-lg bg-rose-600/20 border border-rose-500/30 p-1 text-rose-300 hover:bg-rose-600/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          rows={4}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full resize-none rounded-lg border border-slate-600 bg-slate-900 p-2 text-xs text-slate-100"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">
                            Bobot (1-10):
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={editImportance}
                            onChange={(e) =>
                              setEditImportance(Number(e.target.value))
                            }
                            className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line text-slate-300 leading-relaxed">
                        {String(m.content ?? "")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
