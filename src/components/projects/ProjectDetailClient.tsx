"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbMemory, DbProject, MemoryScope } from "@/types/studio";
import { Badge } from "@/components/ui/Badge";
import {
  ArrowLeft,
  Brain,
  Plus,
  Save,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<DbProject | null>(null);
  const [memories, setMemories] = useState<DbMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Editable project fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [savingProject, setSavingProject] = useState(false);

  // New memory fields
  const [scope, setScope] = useState<MemoryScope>("project");
  const [memoryKey, setMemoryKey] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(8);
  const [addingMemory, setAddingMemory] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setErrorMsg("Sesi login tidak ditemukan. Silakan masuk terlebih dahulu.");
        setLoading(false);
        return;
      }

      const { data: projData, error: projErr } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (projErr || !projData) {
        setErrorMsg("Proyek tidak ditemukan atau Anda tidak memiliki akses.");
        setLoading(false);
        return;
      }

      const typedProj = projData as DbProject;
      setProject(typedProj);
      setName(typedProj.name);
      setDescription(typedProj.description ?? "");
      setSystemInstructions(typedProj.system_instructions ?? "");

      // Ambil memori khusus proyek ini + memori global user (terisolasi dari proyek lain)
      const { data: memData, error: memErr } = await supabase
        .from("memories")
        .select("*")
        .or(`project_id.eq.${projectId},and(scope.eq.user,project_id.is.null)`)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false });

      if (memErr) {
        setErrorMsg(memErr.message);
      } else {
        setMemories((memData as DbMemory[]) ?? []);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat workspace.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !name.trim()) return;

    setSavingProject(true);
    setSavedNotice(null);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("projects")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          system_instructions: systemInstructions.trim() || null,
        })
        .eq("id", project.id);

      if (error) {
        setErrorMsg(error.message);
      } else {
        setSavedNotice("Perubahan informasi proyek berhasil disimpan.");
        await loadWorkspace();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menyimpan proyek.");
    } finally {
      setSavingProject(false);
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !memoryKey.trim() || !content.trim()) return;

    setAddingMemory(true);
    setErrorMsg(null);
    setSavedNotice(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from("memories").insert({
        user_id: user.id,
        project_id: scope === "user" ? null : project.id,
        scope,
        memory_key: memoryKey.trim(),
        content: content.trim(),
        importance,
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setMemoryKey("");
        setContent("");
        setSavedNotice("Memori baru berhasil disimpan ke database.");
        await loadWorkspace();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menambah memori.");
    } finally {
      setAddingMemory(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("memories").delete().eq("id", memoryId);
      if (error) {
        setErrorMsg(error.message);
      } else {
        await loadWorkspace();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menghapus memori.");
    }
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-sm text-slate-400">
        Memuat konteks & memori proyek...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <p className="text-sm text-rose-400">{errorMsg || "Proyek tidak ditemukan."}</p>
        <Link href="/projects" className="text-xs text-blue-500 hover:underline">
          ← Kembali ke daftar proyek
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-400"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Kembali ke Daftar Proyek</span>
        </Link>
        <Badge variant="purple">Isolasi Memori Aktif</Badge>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {savedNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Editor Detail Proyek */}
      <form
        onSubmit={handleUpdateProject}
        className="glass-panel rounded-2xl p-4 sm:p-6 space-y-4"
      >
        <h2 className="text-base font-semibold">Konfigurasi Workspace Proyek</h2>

        <div>
          <label className="block text-xs font-medium mb-1.5">Nama Proyek</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">Deskripsi</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">
            Project System Instructions (Dibaca seluruh agen pada proyek ini)
          </label>
          <textarea
            rows={3}
            value={systemInstructions}
            onChange={(e) => setSystemInstructions(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingProject}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{savingProject ? "Menyimpan..." : "Simpan Perubahan"}</span>
          </button>
        </div>
      </form>

      {/* Memory System (4 Kategori Terisolasi) */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-400" />
            <div>
              <h2 className="text-base font-semibold">Project & User Memory Bank</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Memori di bawah ini hanya berlaku untuk proyek ini (dan memori global User), tidak tercampur dengan proyek lain.
              </p>
            </div>
          </div>
          <Badge variant="blue">{memories.length} Entri Memori</Badge>
        </div>

        {/* Form Tambah Memori */}
        <form
          onSubmit={handleAddMemory}
          className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1">Kategori Memori</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as MemoryScope)}
                className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              >
                <option value="project">Project Memory (Khusus Proyek Ini)</option>
                <option value="user">User Memory (Global Lintas Proyek)</option>
                <option value="agent">Agent Memory (Catatan Agen)</option>
                <option value="task">Task Memory (Konteks Tugas)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1">Kunci / Topik Memori *</label>
              <input
                type="text"
                required
                value={memoryKey}
                onChange={(e) => setMemoryKey(e.target.value)}
                placeholder="Misal: Identitas Karakter Arka"
                className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1">
                Prioritas (1–10): {importance}
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium mb-1">Isi Memori / Aturan Kontinuitas *</label>
            <textarea
              rows={2}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Contoh: Arka mengenakan jubah hitam beraksen biru elektrik, berusia 24 tahun, gaya visual live-action sinematik."
              className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={addingMemory}
              className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{addingMemory ? "Menyimpan..." : "Tambah Memori"}</span>
            </button>
          </div>
        </form>

        {/* Daftar Entri Memori */}
        {memories.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Belum ada entri memori pada proyek ini. Tambahkan identitas karakter, gaya visual, atau aturan merek di atas.
          </p>
        ) : (
          <div className="space-y-2.5">
            {memories.map((mem) => (
              <div
                key={mem.id}
                className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/60 dark:bg-studio-navy/70 p-3.5 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{mem.memory_key}</span>
                    <Badge variant={mem.scope === "project" ? "purple" : "blue"}>
                      {mem.scope}
                    </Badge>
                    <span className="text-[11px] text-slate-500">
                      Prioritas {mem.importance}/10
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {mem.content}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteMemory(mem.id)}
                  aria-label="Hapus memori"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
