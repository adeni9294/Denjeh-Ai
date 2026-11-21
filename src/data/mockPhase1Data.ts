import {
  AgentProfile,
  CommandMessage,
  StudioProject,
  StudioTask,
} from "@/types/studio";

/**
 * CATATAN FASE 1:
 * Data di bawah ini adalah data sampel UI untuk memvalidasi tata letak responsif
 * dan alur interaksi sebelum koneksi database Supabase & Cloudflare Workers aktif di Fase 2+.
 */

export const PHASE1_STATS = [
  { label: "Total Proyek", value: "4", subtext: "2 aktif minggu ini", tone: "blue" as const },
  { label: "Workflow Aktif", value: "3", subtext: "1 terjadwal (Asia/Jakarta)", tone: "purple" as const },
  { label: "Tugas Berjalan", value: "2 / 2", subtext: "Batas konkurensi aman", tone: "emerald" as const },
  { label: "Estimasi Biaya API", value: "$0.00", subtext: "100% Free Tier (Gemini/Groq)", tone: "amber" as const },
];

export const INITIAL_AGENTS: AgentProfile[] = [
  {
    id: "agt-orchestrator",
    name: "Master Orchestrator",
    role: "Koordinator Utama & Perencana",
    description: "Memecah instruksi, mengatur dependensi JSON, dan memantau alur kerja.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "active",
    completedTasks: 48,
  },
  {
    id: "agt-idea",
    name: "Idea Agent",
    role: "Konseptor Kreatif",
    description: "Mengembangkan premis cerita, sudut pandang unik, dan konsep kampanye.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "idle",
    completedTasks: 19,
  },
  {
    id: "agt-research",
    name: "Research Agent",
    role: "Riset & Referensi",
    description: "Mengumpulkan referensi dunia, tren audiens, dan akurasi latar belakang.",
    assignedModel: "Llama 3.3 70B (Groq)",
    status: "idle",
    completedTasks: 14,
  },
  {
    id: "agt-story",
    name: "Story Agent",
    role: "Penulis Naskah & Narasi",
    description: "Menyusun struktur tiga babak, dialog, dan alur emosional.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "busy",
    completedTasks: 22,
  },
  {
    id: "agt-character",
    name: "Character Agent",
    role: "Desain & Kontinuitas Karakter",
    description: "Menjaga konsistensi profil karakter, kostum, dan ciri visual lintas adegan.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "idle",
    completedTasks: 16,
  },
  {
    id: "agt-visual",
    name: "Visual Agent",
    role: "Pengarah Visual & Prompt Gambar",
    description: "Merancang komposisi sinematik, pencahayaan, dan prompt image generator.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "busy",
    completedTasks: 27,
  },
  {
    id: "agt-video",
    name: "Video Agent",
    role: "Storyboard & Prompt Video",
    description: "Membagi adegan menjadi klip 10–15 detik lengkap dengan gerakan kamera.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "idle",
    completedTasks: 15,
  },
  {
    id: "agt-marketing",
    name: "Marketing Agent",
    role: "Strategi Distribusi & Copywriting",
    description: "Menulis caption, tagar, hook pembuka, dan jadwal publikasi optimal.",
    assignedModel: "Llama 3.3 70B (Groq)",
    status: "idle",
    completedTasks: 21,
  },
  {
    id: "agt-quality",
    name: "Quality Agent",
    role: "Audit Kualitas & Kontinuitas",
    description: "Mengevaluasi output terhadap memori proyek sebelum disetujui.",
    assignedModel: "Gemini 2.5 Flash (Free)",
    status: "active",
    completedTasks: 31,
  },
  {
    id: "agt-publishing",
    name: "Publishing Agent",
    role: "Kesiapan Publikasi Resmi",
    description: "Memformat paket konten untuk Facebook Pages, Instagram Pro, & YouTube.",
    assignedModel: "Rule Engine + API",
    status: "idle",
    completedTasks: 9,
  },
];

export const INITIAL_TASKS: StudioTask[] = [
  {
    id: "tsk-101",
    title: "Penyusunan Naskah Adegan Pembuka (00:00 - 00:15)",
    projectName: "DNAverse — The Awakening",
    agentName: "Story Agent",
    status: "running",
    progress: 68,
    priority: "high",
    updatedAt: "Baru saja",
  },
  {
    id: "tsk-102",
    title: "Arahan Pencahayaan & Prompt Keyframe Karakter Utama",
    projectName: "DNAverse — The Awakening",
    agentName: "Visual Agent",
    status: "running",
    progress: 42,
    priority: "high",
    updatedAt: "1 mnt lalu",
  },
  {
    id: "tsk-103",
    title: "Verifikasi Kontinuitas Kostum & Lore DNAverse",
    projectName: "DNAverse — The Awakening",
    agentName: "Quality Agent",
    status: "awaiting_approval",
    progress: 100,
    priority: "medium",
    updatedAt: "5 mnt lalu",
  },
  {
    id: "tsk-104",
    title: "Draf Jadwal Rilis Teaser Shorts & Reels",
    projectName: "DNAverse — The Awakening",
    agentName: "Marketing Agent",
    status: "queued",
    progress: 0,
    priority: "low",
    updatedAt: "8 mnt lalu",
  },
];

export const INITIAL_PROJECTS: StudioProject[] = [
  {
    id: "prj-dnaverse",
    name: "DNAverse — The Awakening",
    tagline: "Film pendek live-action fantasy action 60 detik dengan kontinuitas lintas klip.",
    status: "active",
    artifactsCount: 18,
    activeAgents: 5,
    lastActivity: "2 menit lalu",
    memoryKeys: ["Gaya Visual: Neo-Mythic Realism", "Rasio: 16:9 & 9:16", "Karakter: Arka & Lyra"],
  },
  {
    id: "prj-nusantara",
    name: "Kronik Nusantara AI",
    tagline: "Seri edukasi visual sejarah & mitologi dengan narasi sinematik.",
    status: "active",
    artifactsCount: 11,
    activeAgents: 2,
    lastActivity: "3 jam lalu",
    memoryKeys: ["Tone: Edukatif Sinematik", "Target: YouTube & Instagram"],
  },
  {
    id: "prj-saas-launch",
    name: "Peluncuran Produk Mikro-SaaS",
    tagline: "Kampanye konten tutorial, copywriting, dan jadwal rilis 14 hari.",
    status: "draft",
    artifactsCount: 6,
    activeAgents: 0,
    lastActivity: "Kemarin",
    memoryKeys: ["Bahasa: Indonesia Profesional", "CTA: Daftar Waitlist"],
  },
];

export const INITIAL_COMMAND_HISTORY: CommandMessage[] = [
  {
    id: "msg-1",
    sender: "user",
    timestamp: "10:05 WIB",
    mode: "manual",
    content:
      "Buat film pendek live-action fantasy action berdurasi 60 detik untuk DNAverse. Kembangkan cerita, profil karakter, storyboard, arahan visual, prompt video yang dibagi menjadi klip 10-15 detik, caption media sosial, serta saran jadwal publikasi.",
  },
  {
    id: "msg-2",
    sender: "orchestrator",
    timestamp: "10:05 WIB",
    mode: "manual",
    content:
      "Instruksi dipahami. Memori proyek 'DNAverse — The Awakening' berhasil dimuat. Berikut rencana eksekusi terstruktur lintas 6 agen spesialis dengan batas konkurensi maksimal 2 agen secara paralel:",
    requiresApproval: true,
    approved: false,
    plan: [
      {
        stepNumber: 1,
        agentName: "Story Agent",
        action: "Menyusun sinopsis & naskah 4 babak berdurasi total 60 detik.",
        dependsOn: "Project Memory (DNAverse)",
        estimatedOutput: "Naskah 60 detik + struktur ritme aksi",
      },
      {
        stepNumber: 2,
        agentName: "Character Agent",
        action: "Menetapkan profil visual & konsistensi kostum karakter utama.",
        dependsOn: "Step 1 (Story Agent)",
        estimatedOutput: "Character Sheet & Continuity Lock",
      },
      {
        stepNumber: 3,
        agentName: "Visual Agent",
        action: "Merancang palet warna, pencahayaan, dan keyframe visual.",
        dependsOn: "Step 2 (Character Agent)",
        estimatedOutput: "Visual Direction & Image Prompts",
      },
      {
        stepNumber: 4,
        agentName: "Video Agent",
        action: "Memecah naskah menjadi 4–5 klip (10–15 detik/klip) + storyboard.",
        dependsOn: "Step 3 (Visual Agent)",
        estimatedOutput: "Shot List & Clip-by-Clip Video Prompts",
      },
      {
        stepNumber: 5,
        agentName: "Quality Agent",
        action: "Memeriksa konsistensi karakter, durasi klip, dan kesesuaian lore.",
        dependsOn: "Step 4 (Video Agent)",
        estimatedOutput: "Laporan Audit Kualitas",
      },
      {
        stepNumber: 6,
        agentName: "Marketing Agent",
        action: "Menyusun caption lintas platform, tagar, dan jadwal rilis optimal.",
        dependsOn: "Step 5 (Quality Agent)",
        estimatedOutput: "Paket Distribusi & Jadwal Publikasi",
      },
    ],
  },
];