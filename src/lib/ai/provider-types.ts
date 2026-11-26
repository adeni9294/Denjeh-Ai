export interface ProviderPreset {
  providerKey: "gemini" | "groq" | "custom";
  displayName: string;
  baseUrl: string;
  isFreeTier: boolean;
  defaultRpm: number;
  defaultPriority: number;
  suggestedModels: {
    modelIdentifier: string;
    displayName: string;
    capability: string;
  }[];
  helperNote: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    providerKey: "gemini",
    displayName: "Google Gemini API (Free Tier Candidate)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    isFreeTier: true,
    defaultRpm: 15,
    defaultPriority: 1,
    suggestedModels: [
      {
        modelIdentifier: "gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        capability: "text, vision, structured_json",
      },
      {
        modelIdentifier: "gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        capability: "text, fast_draft, structured_json",
      },
      {
        modelIdentifier: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        capability: "text, vision, structured_json",
      },
      {
        modelIdentifier: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        capability: "text, vision, structured_json",
      },
    ],
    helperNote:
      "Gunakan API key gratis dari Google AI Studio dan pantau batas RPM/RPD free tier.",
  },
  {
    providerKey: "groq",
    displayName: "Groq Cloud API (Free Tier Alternative)",
    baseUrl: "https://api.groq.com/openai/v1",
    isFreeTier: true,
    defaultRpm: 30,
    defaultPriority: 2,
    suggestedModels: [
      {
        modelIdentifier: "llama-3.3-70b-versatile",
        displayName: "Llama 3.3 70B Versatile",
        capability: "text, structured_json",
      },
      {
        modelIdentifier: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B Instant",
        capability: "text, fast_draft",
      },
    ],
    helperNote:
      "Cocok sebagai provider alternatif berkecepatan tinggi atau cadangan fallback.",
  },
  {
    providerKey: "custom",
    displayName: "Custom / Additional Provider",
    baseUrl: "",
    isFreeTier: false,
    defaultRpm: 10,
    defaultPriority: 3,
    suggestedModels: [
      {
        modelIdentifier: "custom-model",
        displayName: "Custom Model",
        capability: "text",
      },
    ],
    helperNote:
      "Tambahkan endpoint dan model tambahan tanpa mengubah arsitektur inti DENJEH AI.",
  },
];
