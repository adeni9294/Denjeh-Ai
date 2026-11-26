export type AgentToolId =
  | "decompose_dag_plan"
  | "read_project_memories"
  | "save_project_memory"
  | "draft_text_post"
  | "craft_story_sequence"
  | "design_photo_prompt"
  | "build_reels_sequence"
  | "split_clip_prompts_per_duration"
  | "generate_social_caption_pack"
  | "audit_content_format"
  | "prepare_facebook_page_payload";

export interface AgentToolDefinition {
  id: AgentToolId;
  name: string;
  category: "orchestration" | "memory" | "creative" | "quality" | "publishing";
  description: string;
  runtime: "internal_db" | "prompt_structurer" | "external_api_ready";
}

export interface AgentSpecialistSpec {
  code: string;
  name: string;
  title: string;
  role: string;
  preferredTier: string;
  allowedTools: AgentToolId[];
  defaultPrompt: string;
}

export const AGENT_TOOL_REGISTRY: Record<AgentToolId, AgentToolDefinition> = {
  decompose_dag_plan: {
    id: "decompose_dag_plan",
    name: "Decompose JSON DAG Plan",
    category: "orchestration",
    description:
      "Memecah instruksi menjadi langkah berurutan sesuai jenis konten yang diminta (Teks, Story, Foto, atau Reels) lengkap dengan dependensi.",
    runtime: "prompt_structurer",
  },
  read_project_memories: {
    id: "read_project_memories",
    name: "Read Project Memories",
    category: "memory",
    description:
      "Mengambil memori proyek & preferensi dari tabel memories berdasarkan bobot.",
    runtime: "internal_db",
  },
  save_project_memory: {
    id: "save_project_memory",
    name: "Save Project Memory",
    category: "memory",
    description:
      "Menyimpan keputusan gaya bahasa, konsep, atau aturan konten baru ke tabel memories.",
    runtime: "internal_db",
  },
  draft_text_post: {
    id: "draft_text_post",
    name: "Draft Text Post",
    category: "creative",
    description:
      "Menyusun konten teks (hook kuat, isi utama, CTA/diskusi) tanpa memaksakan format skrip atau durasi video.",
    runtime: "prompt_structurer",
  },
  craft_story_sequence: {
    id: "craft_story_sequence",
    name: "Craft Story Sequence",
    category: "creative",
    description:
      "Menyusun konsep dan teks singkat padat untuk Story lengkap dengan elemen interaksi (polling, pertanyaan, ajakan balasan).",
    runtime: "prompt_structurer",
  },
  design_photo_prompt: {
    id: "design_photo_prompt",
    name: "Design Photo Prompt",
    category: "creative",
    description:
      "Merancang konsep gambar tunggal, sudut pandang, pencahayaan, dan prompt gambar statis siap pakai.",
    runtime: "prompt_structurer",
  },
  build_reels_sequence: {
    id: "build_reels_sequence",
    name: "Build Reels Sequence",
    category: "creative",
    description:
      "Menyusun alur hook, poin adegan, dan narasi singkat khusus konten Reels/video sesuai durasi yang diminta.",
    runtime: "prompt_structurer",
  },
  split_clip_prompts_per_duration: {
    id: "split_clip_prompts_per_duration",
    name: "Build Master Prompt Per Clip",
    category: "creative",
    description:
      "Khusus Reels/Video: menyusun 1 master prompt utuh per klip sesuai durasi yang diminta.",
    runtime: "prompt_structurer",
  },
  generate_social_caption_pack: {
    id: "generate_social_caption_pack",
    name: "Generate Social Caption Pack",
    category: "publishing",
    description:
      "Menyusun hook, caption, tagar, dan saran waktu unggah sesuai format (Teks, Story, Foto, atau Reels).",
    runtime: "prompt_structurer",
  },
  audit_content_format: {
    id: "audit_content_format",
    name: "Audit Content Format",
    category: "quality",
    description:
      "Memeriksa kesesuaian hasil dengan jenis konten yang diminta (Teks, Story, Foto, atau Reels) dan memori.",
    runtime: "prompt_structurer",
  },
  prepare_facebook_page_payload: {
    id: "prepare_facebook_page_payload",
    name: "Prepare Facebook Page Payload",
    category: "publishing",
    description:
      "Menyiapkan draf rilis teks, foto, story, atau reels siap kirim ke Facebook Page.",
    runtime: "external_api_ready",
  },
};

export const MULTI_AGENT_SPECIALISTS: AgentSpecialistSpec[] = [
  {
    code: "orchestrator",
    name: "Master Orchestrator",
    title: "Koordinator Utama & Perencana",
    role: "Memecah perintah ke agen yang relevan (Teks, Story, Foto, atau Reels) sesuai permintaan pengguna.",
    preferredTier: "Gemini / Groq",
    allowedTools: [
      "decompose_dag_plan",
      "read_project_memories",
      "save_project_memory",
    ],
    defaultPrompt:
      "Susun rencana konten sesuai permintaan (teks, story, foto, atau reels) lengkap dengan pembagian tugas yang jelas.",
  },
  {
    code: "text",
    name: "Text Agent",
    title: "Penulis Konten Teks & Postingan",
    role: "Menyusun postingan teks, edukasi/tips, hook pembuka, dan narasi tulisan tanpa format video.",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "draft_text_post",
      "generate_social_caption_pack",
    ],
    defaultPrompt:
      "Tuliskan draf konten teks yang jelas, menarik, dan siap diposting dengan hook pembuka serta ajakan interaksi.",
  },
  {
    code: "story",
    name: "Story Agent",
    title: "Kreator Story Singkat & Interaktif",
    role: "Menyusun konsep dan teks singkat untuk Story lengkap dengan ide polling/pertanyaan audiens.",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "craft_story_sequence",
      "save_project_memory",
    ],
    defaultPrompt:
      "Buat rangkaian konsep Story singkat yang padat, menarik, dan dilengkapi elemen interaksi audiens.",
  },
  {
    code: "photo",
    name: "Photo Agent",
    title: "Desainer Konsep & Prompt Foto",
    role: "Menyusun konsep foto tunggal, komposisi, pencahayaan, dan prompt gambar statis.",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "design_photo_prompt",
      "generate_social_caption_pack",
    ],
    defaultPrompt:
      "Buat konsep foto dan prompt gambar statis yang detail beserta komposisi dan pencahayaan yang sesuai.",
  },
  {
    code: "reels",
    name: "Reels Agent",
    title: "Kreator Video Pendek & Reels",
    role: "Khusus konten Reels/Video: menyusun hook cepat, alur adegan, dan prompt per klip sesuai durasi.",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "build_reels_sequence",
      "split_clip_prompts_per_duration",
    ],
    defaultPrompt:
      "Susun konsep Reels/video pendek lengkap dengan hook pembuka dan prompt per klip sesuai durasi yang diminta.",
  },
  {
    code: "idea",
    name: "Idea Agent",
    title: "Konseptor Kreatif",
    role: "Mengembangkan ide dan sudut pandang konten untuk berbagai format (teks, story, foto, atau reels).",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: ["read_project_memories", "save_project_memory"],
    defaultPrompt:
      "Kembangkan 3 variasi ide konten yang relevan dan segar sesuai topik yang diminta.",
  },
  {
    code: "research",
    name: "Research Agent",
    title: "Riset & Referensi",
    role: "Mengumpulkan referensi topik, sudut pandang audiens, dan poin fakta pendukung.",
    preferredTier: "Llama 3.3 70B (Groq)",
    allowedTools: ["read_project_memories", "save_project_memory"],
    defaultPrompt:
      "Ringkas poin riset, sudut pandang utama, dan referensi pendukung untuk topik yang diminta.",
  },
  {
    code: "marketing",
    name: "Marketing Agent",
    title: "Strategi Distribusi & Copywriting",
    role: "Menyusun caption, tagar, CTA, dan saran waktu rilis sesuai jenis konten.",
    preferredTier: "Llama 3.3 70B (Groq)",
    allowedTools: ["read_project_memories", "generate_social_caption_pack"],
    defaultPrompt:
      "Siapkan caption, tagar, dan saran waktu rilis yang sesuai untuk jenis konten yang dibuat.",
  },
  {
    code: "quality",
    name: "Quality Agent",
    title: "Audit Kualitas & Kesesuaian Format",
    role: "Memeriksa apakah hasil sudah sesuai dengan format yang diminta (teks, story, foto, atau reels).",
    preferredTier: "Gemini Flash (Free)",
    allowedTools: ["read_project_memories", "audit_content_format"],
    defaultPrompt:
      "Audit hasil konten agar sesuai dengan format yang diminta, jelas, dan siap dipublikasikan.",
  },
  {
    code: "publishing",
    name: "Publishing Agent",
    title: "Kesiapan Publikasi",
    role: "Menyiapkan draf konten Teks, Story, Foto, atau Reels agar siap dipublikasikan ke kanal tujuan.",
    preferredTier: "Rule Engine + API",
    allowedTools: [
      "read_project_memories",
      "generate_social_caption_pack",
      "prepare_facebook_page_payload",
    ],
    defaultPrompt:
      "Rapikan paket konten siap rilis sesuai jenis medianya (teks, story, foto, atau reels).",
  },
];

export function getAgentSpec(agentCode: string): AgentSpecialistSpec {
  const normalized = agentCode.toLowerCase().trim();
  const mappedCode = normalized === "video" ? "reels" : normalized;
  return (
    MULTI_AGENT_SPECIALISTS.find((a) => a.code === mappedCode) ??
    MULTI_AGENT_SPECIALISTS[0]
  );
}

export function buildAgentToolInstructionBlock(agentCode: string): string {
  const spec = getAgentSpec(agentCode);
  const toolsList = spec.allowedTools
    .map((toolId) => {
      const def = AGENT_TOOL_REGISTRY[toolId];
      return `- [${def.id}] (${def.runtime}): ${def.description}`;
    })
    .join("\n");

  const isReelsOrVideo = spec.code === "reels";
  const executionRule = isReelsOrVideo
    ? "INSTRUKSI EKSEKUSI (REELS/VIDEO): Patuhi durasi klip yang diminta pengguna secara konsisten dan susun prompt klip/adegan yang jelas."
    : "INSTRUKSI EKSEKUSI: Sesuaikan format keluaran dengan peran agen dan permintaan pengguna (teks, story, atau foto). Jangan memaksakan format skrip video berdurasi detik bila tidak diminta.";

  return [
    `PERAN SPESIALIS: ${spec.name} (${spec.title})`,
    `TANGGUNG JAWAB: ${spec.role}`,
    `IZIN TOOLS AKTIF:`,
    toolsList,
    executionRule,
  ].join("\n");
}
