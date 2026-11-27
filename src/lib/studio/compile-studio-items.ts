export type StudioMediaTab = "story" | "text" | "photo" | "reels";

export interface RawStudioTask {
  id: string;
  workflow_run_id?: string | null;
  title: string;
  status: string;
  agent_code?: string | null;
  created_at: string;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  checkpoint_state?: Record<string, unknown> | null;
}

export interface CompiledStudioItem {
  id: string;
  sourceTaskIds: string[];
  primaryTaskId: string;
  workflowRunId: string;
  slotKey: "pagi" | "siang" | "sore" | "malam" | "umum";
  slotBadge: string;
  scheduleLabel: string;
  tab: StudioMediaTab;
  cleanTitle: string;
  compiledContent: string;
  qualityNote?: string;
  isReadyToPublish: boolean;
  mediaUrl?: string;
}

/**
 * Memecah teks output agen menjadi bagian per slot jika satu output memuat lebih dari satu slot.
 */
function splitByTimeSlot(rawText: string): Partial<Record<"pagi" | "siang" | "sore" | "malam", string>> {
  const text = rawText.trim();
  if (!text) return {};

  const markers: { key: "pagi" | "siang" | "sore" | "malam"; regex: RegExp }[] = [
    { key: "pagi", regex: /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+PAGI[^\n]*/i },
    { key: "siang", regex: /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+SIANG[^\n]*/i },
    { key: "sore", regex: /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+SORE[^\n]*/i },
    { key: "malam", regex: /(?:===+\s*)?(?:KONSEP\s+KONTEN\s+|CAPTION\s+|AUDIT\s+KONTEN\s+)?SLOT\s+MALAM[^\n]*/i },
  ];

  const found: { key: "pagi" | "siang" | "sore" | "malam"; index: number }[] = [];
  for (const m of markers) {
    const match = m.regex.exec(text);
    if (match && typeof match.index === "number") {
      found.push({ key: m.key, index: match.index });
    }
  }

  if (found.length === 0) return {};

  found.sort((a, b) => a.index - b.index);
  const result: Partial<Record<"pagi" | "siang" | "sore" | "malam", string>> = {};

  for (let i = 0; i < found.length; i++) {
    const start = found[i].index;
    const end = i + 1 < found.length ? found[i + 1].index : text.length;
    const slice = text.slice(start, end).trim();
    if (slice) {
      result[found[i].key] = slice;
    }
  }

  return result;
}

/**
 * Mengambil judul bersih dari Hook / Judul konten (bukan prompt instruksi agen).
 */
function extractCleanHeadline(content: string, slotBadge: string): string {
  const hookMatch = content.match(/Hook\s*:\s*["“']?([^"\n”']+)["”']?/i);
  if (hookMatch?.[1]) {
    return hookMatch[1].trim();
  }

  const titleMatch = content.match(/(?:Sudut\s*Pandang\/)?Judul\s*:\s*["“']?([^"\n”']+)["”']?/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  const lines = content
    .split("\n")
    .map((l) => l.replace(/^[-*#=]+\s*/, "").trim())
    .filter(
      (l) =>
        l.length > 8 &&
        !/^(slot\s+(pagi|siang|sore|malam)|berikut adalah|audit konten|caption slot|isi utama)/i.test(l)
    );

  if (lines[0]) {
    return lines[0].slice(0, 90);
  }

  return `Konten Siap Tayang — ${slotBadge}`;
}

function getSlotSchedule(slot: "pagi" | "siang" | "sore" | "malam" | "umum"): {
  badge: string;
  scheduleLabel: string;
} {
  if (slot === "pagi") return { badge: "Slot Pagi", scheduleLabel: "08.00 WIB" };
  if (slot === "siang") return { badge: "Slot Siang", scheduleLabel: "11.00 WIB" };
  if (slot === "sore") return { badge: "Slot Sore", scheduleLabel: "15.00 WIB" };
  if (slot === "malam") return { badge: "Slot Malam", scheduleLabel: "19.30 WIB" };
  return { badge: "Reguler", scheduleLabel: "15.00 WIB" };
}

function detectAgentRole(task: RawStudioTask): "idea" | "text" | "marketing" | "quality" | "media" | "other" {
  const payload = (task.input_payload ?? {}) as Record<string, unknown>;
  const code = String(payload.agentCode ?? task.agent_code ?? "").toLowerCase();
  const title = (task.title ?? "").toLowerCase();

  if (code === "idea" || title.startsWith("idea agent")) return "idea";
  if (code === "quality" || title.startsWith("quality agent")) return "quality";
  if (code === "marketing" || title.startsWith("marketing agent")) return "marketing";
  if (code === "text" || title.startsWith("text agent")) return "text";
  if (["photo", "visual", "story", "reels", "video"].includes(code)) return "media";
  return "other";
}

function detectMediaTab(task: RawStudioTask, slotKey: string): StudioMediaTab {
  const payload = (task.input_payload ?? {}) as Record<string, unknown>;
  const cp = (task.checkpoint_state ?? {}) as Record<string, unknown>;
  const code = String(cp.slotKind ?? payload.agentCode ?? task.agent_code ?? "").toLowerCase();

  if (code === "story" || slotKey === "pagi") return "story";
  if (code === "photo" || code === "visual") return "photo";
  if (code === "reels" || code === "video") return "reels";
  return "text";
}

/**
 * Mengompilasi tugas-tugas hasil eksekusi multi-agent menjadi 1 paket konten final per slot.
 */
export function compileStudioTasksToPublishableItems(tasks: RawStudioTask[]): CompiledStudioItem[] {
  const completed = tasks.filter((t) => t.status === "completed");

  type SlotBucket = {
    runId: string;
    slotKey: "pagi" | "siang" | "sore" | "malam" | "umum";
    textParts: string[];
    marketingParts: string[];
    qualityParts: string[];
    otherParts: string[];
    taskIds: string[];
    primaryTask?: RawStudioTask;
    mediaUrl?: string;
    isReadyToPublish: boolean;
  };

  const buckets = new Map<string, SlotBucket>();

  const ensureBucket = (
    runId: string,
    slotKey: "pagi" | "siang" | "sore" | "malam" | "umum"
  ): SlotBucket => {
    const key = `${runId}::${slotKey}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        runId,
        slotKey,
        textParts: [],
        marketingParts: [],
        qualityParts: [],
        otherParts: [],
        taskIds: [],
        isReadyToPublish: false,
      });
    }
    return buckets.get(key)!;
  };

  for (const task of completed) {
    const role = detectAgentRole(task);
    // Abaikan Idea Agent agar ide mentah tidak ikut muncul sebagai konten siap posting
    if (role === "idea") continue;

    const runId = task.workflow_run_id || task.id;
    const out = (task.output_payload ?? {}) as Record<string, unknown>;
    const cp = (task.checkpoint_state ?? {}) as Record<string, unknown>;
    const rawBody = String(out.contentMarkdown ?? out.summary ?? "").trim();
    if (!rawBody) continue;

    const mediaUrl = String(cp.photoUrl ?? cp.videoUrl ?? "").trim() || undefined;
    const readyFlag = Boolean(cp.readyToPublish || cp.publishStatus === "ready");

    const splitSlots = splitByTimeSlot(rawBody);
    const slotEntries = Object.entries(splitSlots) as [
      "pagi" | "siang" | "sore" | "malam",
      string
    ][];

    if (slotEntries.length > 0) {
      for (const [slotKey, sectionText] of slotEntries) {
        const b = ensureBucket(runId, slotKey);
        if (!b.taskIds.includes(task.id)) b.taskIds.push(task.id);
        if (mediaUrl) b.mediaUrl = mediaUrl;
        if (readyFlag) b.isReadyToPublish = true;

        if (role === "text") {
          b.textParts.push(sectionText);
          b.primaryTask = task;
        } else if (role === "marketing") {
          b.marketingParts.push(sectionText);
          if (!b.primaryTask) b.primaryTask = task;
        } else if (role === "quality") {
          b.qualityParts.push(sectionText);
        } else {
          b.otherParts.push(sectionText);
          if (!b.primaryTask) b.primaryTask = task;
        }
      }
    } else {
      const lowerTitle = task.title.toLowerCase();
      const inferredSlot: "pagi" | "siang" | "sore" | "malam" | "umum" =
        lowerTitle.includes("malam")
          ? "malam"
          : lowerTitle.includes("sore")
          ? "sore"
          : lowerTitle.includes("siang")
          ? "siang"
          : lowerTitle.includes("pagi")
          ? "pagi"
          : "umum";

      const b = ensureBucket(runId, inferredSlot);
      if (!b.taskIds.includes(task.id)) b.taskIds.push(task.id);
      if (mediaUrl) b.mediaUrl = mediaUrl;
      if (readyFlag) b.isReadyToPublish = true;

      if (role === "text") {
        b.textParts.push(rawBody);
        b.primaryTask = task;
      } else if (role === "marketing") {
        b.marketingParts.push(rawBody);
        if (!b.primaryTask) b.primaryTask = task;
      } else if (role === "quality") {
        b.qualityParts.push(rawBody);
      } else {
        b.otherParts.push(rawBody);
        if (!b.primaryTask) b.primaryTask = task;
      }
    }
  }

  const slotOrder: Record<string, number> = {
    pagi: 1,
    siang: 2,
    sore: 3,
    malam: 4,
    umum: 5,
  };

  return Array.from(buckets.values())
    .filter(
      (b) =>
        b.textParts.length > 0 ||
        b.marketingParts.length > 0 ||
        b.otherParts.length > 0
    )
    .sort((a, b) => (slotOrder[a.slotKey] ?? 9) - (slotOrder[b.slotKey] ?? 9))
    .map((b) => {
      const { badge, scheduleLabel } = getSlotSchedule(b.slotKey);
      const mergedSections = [
        ...b.textParts,
        ...b.marketingParts,
        ...b.otherParts,
      ].join("\n\n---\n\n");

      const primaryTask = b.primaryTask!;
      const tab = detectMediaTab(primaryTask, b.slotKey);

      return {
        id: `compiled-${b.runId}-${b.slotKey}`,
        sourceTaskIds: b.taskIds,
        primaryTaskId: primaryTask.id,
        workflowRunId: b.runId,
        slotKey: b.slotKey,
        slotBadge: badge,
        scheduleLabel,
        tab,
        cleanTitle: extractCleanHeadline(mergedSections, badge),
        compiledContent: mergedSections,
        qualityNote: b.qualityParts[0],
        isReadyToPublish: b.isReadyToPublish,
        mediaUrl: b.mediaUrl,
      };
    });
}
