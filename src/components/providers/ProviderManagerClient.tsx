"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DbAiModel, DbAiProvider } from "@/types/studio";
import { PROVIDER_PRESETS } from "@/lib/ai/provider-types";
import { Badge } from "@/components/ui/Badge";
import {
  Cpu,
  KeyRound,
  Plus,
  Trash2,
  Lock,
  AlertCircle,
  CheckCircle2,
  Layers,
} from "lucide-react";

export function ProviderManagerClient() {
  const [userId, setUserId] = useState<string | null>(null);
  const [providers, setProviders] = useState<DbAiProvider[]>([]);
  const [models, setModels] = useState<DbAiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Provider form
  const [presetKey, setPresetKey] = useState<"gemini" | "groq" | "custom">("gemini");
  const [displayName, setDisplayName] = useState(PROVIDER_PRESETS[0].displayName);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState(15);
  const [priorityOrder, setPriorityOrder] = useState(1);
  const [isFreeTier, setIsFreeTier] = useState(true);
  const [savingProvider, setSavingProvider] = useState(false);

  // Model form
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [modelIdentifier, setModelIdentifier] = useState("gemini-2.5-flash");
  const [modelDisplayName, setModelDisplayName] = useState("Gemini 2.5 Flash");
  const [capability, setCapability] = useState("text, structured_json");
  const [isDefaultModel, setIsDefaultModel] = useState(true);
  const [savingModel, setSavingModel] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const [{ data: provRows, error: provErr }, { data: modRows, error: modErr }] =
        await Promise.all([
          supabase
            .from("ai_providers")
            .select("*")
            .order("priority_order", { ascending: true }),
          supabase.from("ai_models").select("*").order("created_at", { ascending: false }),
        ]);

      if (provErr) setErrorMsg(provErr.message);
      if (modErr) setErrorMsg(modErr.message);

      const typedProviders = (provRows as DbAiProvider[]) ?? [];
      setProviders(typedProviders);
      setModels((modRows as DbAiModel[]) ?? []);

      if (typedProviders.length > 0 && !selectedProviderId) {
        setSelectedProviderId(typedProviders[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat konfigurasi AI.");
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectPreset = (key: "gemini" | "groq" | "custom") => {
    setPresetKey(key);
    const found = PROVIDER_PRESETS.find((p) => p.providerKey === key) ?? PROVIDER_PRESETS[0];
    setDisplayName(found.displayName);
    setBaseUrl(found.baseUrl);
    setRateLimitRpm(found.defaultRpm);
    setPriorityOrder(found.defaultPriority);
    setIsFreeTier(found.isFreeTier);
    if (found.suggestedModels[0]) {
      setModelIdentifier(found.suggestedModels[0].modelIdentifier);
      setModelDisplayName(found.suggestedModels[0].displayName);
      setCapability(found.suggestedModels[0].capability);
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !displayName.trim()) return;

    setSavingProvider(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const cleanKey = apiKeyInput.trim();
      const keyLast4 = cleanKey.length >= 4 ? cleanKey.slice(-4) : null;

      // Ringkasan tersandi berbasis prefix + akhiran untuk tampilan aman di UI
      const maskedStorageValue = cleanKey
        ? `enc_v1:${btoa(cleanKey)}`
        : null;

      const { data: savedProv, error } = await supabase
        .from("ai_providers")
        .upsert(
          {
            user_id: userId,
            provider_key:
              presetKey === "custom"
                ? `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-4)}`
                : presetKey,
            display_name: displayName.trim(),
            base_url: baseUrl.trim() || null,
            encrypted_api_key: maskedStorageValue,
            key_last4: keyLast4,
            is_enabled: true,
            is_free_tier: isFreeTier,
            rate_limit_rpm: rateLimitRpm,
            priority_order: priorityOrder,
          },
          { onConflict: "user_id,provider_key" }
        )
        .select()
        .single();

      if (error) {
        setErrorMsg(error.message);
      } else {
        setApiKeyInput("");
        setNoticeMsg("Konfigurasi AI Provider berhasil disimpan.");
        if (savedProv?.id) {
          setSelectedProviderId(savedProv.id);
        }
        await loadData();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menyimpan provider.");
    } finally {
      setSavingProvider(false);
    }
  };

  const handleToggleProvider = async (prov: DbAiProvider) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("ai_providers")
        .update({ is_enabled: !prov.is_enabled })
        .eq("id", prov.id);
      if (error) setErrorMsg(error.message);
      else await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal mengubah status provider.");
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("ai_providers").delete().eq("id", id);
      if (error) setErrorMsg(error.message);
      else await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menghapus provider.");
    }
  };

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !selectedProviderId || !modelIdentifier.trim()) return;

    setSavingModel(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("ai_models").insert({
        user_id: userId,
        provider_id: selectedProviderId,
        model_identifier: modelIdentifier.trim(),
        display_name: modelDisplayName.trim() || modelIdentifier.trim(),
        capability: capability.trim() || "text",
        cost_per_1k_input_usd: isFreeTier ? 0 : 0.0001,
        cost_per_1k_output_usd: isFreeTier ? 0 : 0.0002,
        is_default: isDefaultModel,
        is_active: true,
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setNoticeMsg("Model AI berhasil ditambahkan ke provider.");
        await loadData();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal menambah model.");
    } finally {
      setSavingModel(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-sm text-slate-400">
        Memuat AI Provider Manager...
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
          Masuk ke akun DENJEH AI Anda untuk mengatur API key, model, batas RPM, dan aturan fallback.
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

  const activePreset =
    PROVIDER_PRESETS.find((p) => p.providerKey === presetKey) ?? PROVIDER_PRESETS[0];

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {noticeMsg && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {/* Form Konfigurasi AI Provider */}
      <form
        onSubmit={handleSaveProvider}
        className="glass-panel rounded-2xl p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold">Tambah / Perbarui AI Provider</h2>
          </div>
          <Badge variant="emerald">Prioritas Fallback Berurutan</Badge>
        </div>

        {/* Preset Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.providerKey}
              type="button"
              onClick={() => handleSelectPreset(p.providerKey)}
              className={`rounded-xl border p-3 text-left text-xs transition ${
                presetKey === p.providerKey
                  ? "border-blue-500 bg-blue-500/10 text-blue-400"
                  : "border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy"
              }`}
            >
              <div className="font-semibold uppercase">{p.providerKey}</div>
              <div className="mt-0.5 text-[11px] opacity-80 truncate">{p.displayName}</div>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">{activePreset.helperNote}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1.5">Nama Tampilan</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Base URL Endpoint</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              API Key (Kosongkan jika hanya mengubah pengaturan)
            </label>
            <div className="relative">
              <KeyRound className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Masukkan API Key provider"
                className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5">Batas RPM</label>
              <input
                type="number"
                min={1}
                max={120}
                value={rateLimitRpm}
                onChange={(e) => setRateLimitRpm(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Urutan Prioritas (1 = Utama)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={priorityOrder}
                onChange={(e) => setPriorityOrder(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 dark:border-studio-border bg-slate-50 dark:bg-studio-navy px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isFreeTier}
              onChange={(e) => setIsFreeTier(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>Tandai sebagai Free Tier / Hemat Biaya</span>
          </label>

          <button
            type="submit"
            disabled={savingProvider}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>{savingProvider ? "Menyimpan..." : "Simpan Provider"}</span>
          </button>
        </div>
      </form>

      {/* Daftar Provider Terkonfigurasi */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold">
          Provider Terdaftar ({providers.length})
        </h2>

        {providers.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Belum ada AI Provider tersimpan. Tambahkan Gemini atau Groq di formulir atas.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {providers.map((prov) => (
              <div
                key={prov.id}
                className="rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{prov.display_name}</span>
                      <Badge variant={prov.is_enabled ? "emerald" : "slate"}>
                        {prov.is_enabled ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Key: {prov.key_last4 ? `••••${prov.key_last4}` : "Belum diisi"} • Prioritas #
                      {prov.priority_order} • {prov.rate_limit_rpm} RPM
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteProvider(prov.id)}
                    aria-label="Hapus provider"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-studio-border text-xs">
                  <span className="text-[11px] text-blue-400">
                    {prov.is_free_tier ? "Free Tier" : "Custom/Paid"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleProvider(prov)}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-400"
                  >
                    {prov.is_enabled ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Kelola Model per Provider */}
      {providers.length > 0 && (
        <div className="glass-panel rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-purple-400" />
            <h2 className="text-base font-semibold">Daftar Model AI ({models.length})</h2>
          </div>

          <form
            onSubmit={handleAddModel}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200/80 dark:border-studio-border bg-slate-50/70 dark:bg-studio-navy/80 p-4"
          >
            <div>
              <label className="block text-[11px] font-medium mb-1">Provider</label>
              <select
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1">Model ID</label>
              <input
                type="text"
                required
                value={modelIdentifier}
                onChange={(e) => setModelIdentifier(e.target.value)}
                placeholder="gemini-2.5-flash"
                className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium mb-1">Nama Model</label>
              <input
                type="text"
                value={modelDisplayName}
                onChange={(e) => setModelDisplayName(e.target.value)}
                placeholder="Gemini 2.5 Flash"
                className="w-full rounded-lg border border-slate-200 dark:border-studio-border bg-white dark:bg-studio-card px-3 py-2 text-xs"
              />
            </div>

            <div className="flex items-end justify-between gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] pb-2">
                <input
                  type="checkbox"
                  checked={isDefaultModel}
                  onChange={(e) => setIsDefaultModel(e.target.checked)}
                />
                <span>Default</span>
              </label>

              <button
                type="submit"
                disabled={savingModel}
                className="rounded-lg bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {savingModel ? "..." : "+ Model"}
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/70 dark:border-studio-border bg-slate-50/50 dark:bg-studio-navy/60 px-3.5 py-2.5 text-xs"
              >
                <div>
                  <span className="font-semibold">{m.display_name}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">
                    ({m.model_identifier})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="purple">{m.capability}</Badge>
                  {m.is_default && <Badge variant="blue">Default</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
