export type AgentToolId =
  | "decompose_dag_plan"
  | "read_project_memories"
  | "save_project_memory"
  | "extract_story_beats"
  | "validate_character_continuity"
  | "build_visual_keyframes"
  | "split_clip_prompts_10_15s"
  | "generate_social_caption_pack"
  | "audit_continuity_checklist"
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
      "Memecah instruksi kreatif menjadi langkah berurutan lengkap dengan dependensi antar-agen.",
    runtime: "prompt_structurer",
  },
  read_project_memories: {
    id: "read_project_memories",
    name: "Read Project Memories",
    category: "memory",
    description:
      "Mengambil memori proyek & aturan kontinuitas dari tabel memories Supabase berdasarkan bobot.",
    runtime: "internal_db",
  },
  save_project_memory: {
    id: "save_project_memory",
    name: "Save Project Memory",
    category: "memory",
    description:
      "Menyimpan keputusan cerita, identitas karakter, atau aturan visual baru ke tabel memories.",
    runtime: "internal_db",
  },
  extract_story_beats: {
    id: "extract_story_beats",
    name: "Extract 3-Act Story Beats",
    category: "creative",
    description:
      "Menyusun struktur tiga babak dan pembagian adegan berdurasi total 60 detik.",
    runtime: "prompt_structurer",
  },
  validate_character_continuity: {
    id: "validate_character_continuity",
    name: "Validate Character Continuity",
    category: "memory",
    description:
      "Memverifikasi konsistensi wajah, kostum, properti kunci, dan ciri fisik karakter lintas klip.",
    runtime: "prompt_structurer",
  },
  build_visual_keyframes: {
    id: "build_visual_keyframes",
    name: "Build Visual Keyframes",
    category: "creative",
    description:
      "Menghasilkan arahan pencahayaan sinematik, komposisi kamera, dan prompt keyframe gambar.",
    runtime: "prompt_structurer",
  },
  split_clip_prompts_10_15s: {
    id: "split_clip_prompts_10_15s",
    name: "Split Clip Prompts (10-15s)",
    category: "creative",
    description:
      "Memecah storyboard menjadi prompt video per segmen 10–15 detik lengkap dengan gerakan kamera.",
    runtime: "prompt_structurer",
  },
  generate_social_caption_pack: {
    id: "generate_social_caption_pack",
    name: "Generate Social Caption Pack",
    category: "publishing",
    description:
      "Menyusun hook pembuka, caption multi-platform, tagar, dan rekomendasi jadwal unggah.",
    runtime: "prompt_structurer",
  },
  audit_continuity_checklist: {
    id: "audit_continuity_checklist",
    name: "Audit Continuity Checklist",
    category: "quality",
    description:
      "Mengaudit hasil seluruh agen terhadap system instructions dan memori proyek sebelum rilis.",
    runtime: "prompt_structurer",
  },
  prepare_facebook_page_payload: {
    id: "prepare_facebook_page_payload",
    name: "Prepare Facebook Page Payload",
    category: "publishing",
    description:
      "Memformat payload caption, metadata video, dan checklist siap kirim ke Meta Graph API.",
    runtime: "external_api_ready",
  },
};

export const MULTI_AGENT_SPECIALISTS: AgentSpecialistSpec[] = [
  {
    code: "orchestrator",
    name: "Master Orchestrator",
    title: "Koordinator Utama & Perencana",
    role: "Memecah instruksi, mengatur dependensi JSON DAG, dan memantau alur kerja lintas agen.",
    preferredTier: "Gemini / Groq",
    allowedTools: [
      "decompose_dag_plan",
      "read_project_memories",
      "save_project_memory",
    ],
    defaultPrompt:
      "Susun rencana produksi end-to-end 60 detik untuk proyek aktif lengkap dengan dependensi antar-agen.",
  },
  {
    code: "idea",
    name: "Idea Agent",
    title: "Konseptor Kreatif",
    role: "Mengembangkan premis cerita, sudut pandang unik, dan konsep kampanye.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: ["read_project_memories", "save_project_memory"],
    defaultPrompt:
      "Kembangkan 3 variasi premis dan hook pembuka 5 detik pertama untuk proyek aktif.",
  },
  {
    code: "research",
    name: "Research Agent",
    title: "Riset & Referensi",
    role: "Mengumpulkan referensi dunia, tren audiens, dan akurasi latar belakang.",
    preferredTier: "Llama 3.3 70B (Groq)",
    allowedTools: ["read_project_memories", "save_project_memory"],
    defaultPrompt:
      "Susun referensi atmosfer visual, gaya sinematografi, dan tren format pendek 60 detik untuk proyek aktif.",
  },
  {
    code: "story",
    name: "Story Agent",
    title: "Penulis Naskah & Narasi",
    role: "Menyusun struktur tiga babak, dialog singkat, dan alur emosional.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "extract_story_beats",
      "save_project_memory",
    ],
    defaultPrompt:
      "Susun sinopsis, struktur tiga babak, dan naskah dialog singkat terbagi menjadi 4-5 klip 10-15 detik.",
  },
  {
    code: "character",
    name: "Character Agent",
    title: "Desain & Kontinuitas Karakter",
    role: "Menjaga konsistensi profil karakter, kostum, dan ciri visual lintas adegan.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "validate_character_continuity",
      "save_project_memory",
    ],
    defaultPrompt:
      "Buat profil karakter lengkap dengan detail wajah, kostum, properti kunci, dan aturan kontinuitas visual.",
  },
  {
    code: "visual",
    name: "Visual Agent",
    title: "Pengarah Visual & Prompt Gambar",
    role: "Merancang komposisi sinematik, pencahayaan, dan prompt image generator.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "validate_character_continuity",
      "build_visual_keyframes",
    ],
    defaultPrompt:
      "Susun arahan pencahayaan sinematik, komposisi kamera, dan prompt keyframe untuk tiap adegan.",
  },
  {
    code: "video",
    name: "Video Agent",
    title: "Storyboard & Prompt Video",
    role: "Membagi adegan menjadi klip 10–15 detik lengkap dengan gerakan kamera dan transisi.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "build_visual_keyframes",
      "split_clip_prompts_10_15s",
    ],
    defaultPrompt:
      "Bagi storyboard menjadi prompt video per klip 10-15 detik lengkap dengan gerakan kamera, aksi, dan pencahayaan.",
  },
  {
    code: "marketing",
    name: "Marketing Agent",
    title: "Strategi Distribusi & Copywriting",
    role: "Menulis caption, tagar, hook pembuka, dan jadwal publikasi optimal.",
    preferredTier: "Llama 3.3 70B (Groq)",
    allowedTools: ["read_project_memories", "generate_social_caption_pack"],
    defaultPrompt:
      "Tulis caption media sosial, hook pembuka, tagar relevan, dan jadwal rilis optimal untuk proyek aktif.",
  },
  {
    code: "quality",
    name: "Quality Agent",
    title: "Audit Kualitas & Kontinuitas",
    role: "Mengevaluasi output terhadap memori proyek sebelum disetujui.",
    preferredTier: "Gemini 2.5 Flash (Free)",
    allowedTools: [
      "read_project_memories",
      "validate_character_continuity",
      "audit_continuity_checklist",
    ],
    defaultPrompt:
      "Lakukan audit kualitas dan kontinuitas kostum, karakter, serta durasi klip 10-15 detik sebelum rilis.",
  },
  {
    code: "publishing",
    name: "Publishing Agent",
    title: "Kesiapan Publikasi Resmi",
    role: "Memformat paket konten untuk Facebook Pages, Instagram Pro, & YouTube.",
    preferredTier: "Rule Engine + API",
    allowedTools: [
      "read_project_memories",
      "generate_social_caption_pack",
      "prepare_facebook_page_payload",
    ],
    defaultPrompt:
      "Siapkan paket final publikasi lengkap dengan metadata, caption Facebook Page, dan checklist rilis.",
  },
];

export function getAgentSpec(agentCode: string): AgentSpecialistSpec {
  const normalized = agentCode.toLowerCase().trim();
  return (
    MULTI_AGENT_SPECIALISTS.find((a) => a.code === normalized) ??
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

  return [
    `PERAN SPESIALIS: ${spec.name} (${spec.title})`,
    `TANGGUNG JAWAB: ${spec.role}`,
    `IZIN TOOLS AKTIF:`,
    toolsList,
    `INSTRUKSI EKSEKUSI: Gunakan kapabilitas dari izin tools di atas untuk menyusun keluaran terstruktur, spesifik, dan konsisten dengan memori proyek.`,
  ].join("\n");
}
