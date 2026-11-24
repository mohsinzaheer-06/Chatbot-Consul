import type { EligibleModel, ImageStylePreset, LiveVoiceName } from '../types/chat';

export const FREE_TEXT_MODELS: readonly {
  id: EligibleModel;
  label: string;
  description: string;
}[] = [
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash',
    description: 'Default free-tier multimodal model',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite',
    description: 'Fast lightweight free-tier model',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'gemini-4-hydrogen',
    description: 'Standard reasoning model',
  },
];

export const DEFAULT_TEXT_MODEL: EligibleModel = 'gemini-3.8-flash';
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

export const IMAGE_UNAVAILABLE_MESSAGE =
  'Image generation is currently unavailable because no eligible free image-generation provider is configured. No paid API will be used.';

export const PAID_GEMINI_IMAGE_MODELS = new Set([
  'gemini-3.1-flash-lite-image',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image',
]);

export const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export const LIVE_VOICE_PERSONAS: readonly {
  voiceName: LiveVoiceName;
  label: string;
  subtitle: string;
}[] = [
  {
    id: 'Zephyr',
    voiceName: 'Zephyr',
    label: 'Ayla (Warm & Youthful)',
    subtitle: 'Bright, natural, friendly female-presenting assistant voice',
  } as const,
  {
    id: 'Kore',
    voiceName: 'Kore',
    label: 'Noor (Calm & Professional)',
    subtitle: 'Clear, poised, warm female-presenting assistant voice',
  } as const,
].map(({ voiceName, label, subtitle }) => ({ voiceName, label, subtitle }));

export const IMAGE_STYLE_PRESETS: readonly {
  id: ImageStylePreset;
  label: string;
  promptSuffix: string;
}[] = [
  { id: 'none', label: 'Natural / No preset', promptSuffix: '' },
  {
    id: 'product-photography',
    label: 'Product photography',
    promptSuffix:
      'clean commercial product photography, studio lighting, crisp textures, soft shadows',
  },
  {
    id: 'lifestyle-photography',
    label: 'Lifestyle photography',
    promptSuffix:
      'authentic lifestyle photography, natural daylight, candid editorial framing, warm tones',
  },
  {
    id: 'commercial-advertising',
    label: 'Commercial advertising',
    promptSuffix:
      'high-impact commercial advertising photography, balanced composition, polished lighting',
  },
  {
    id: 'illustration',
    label: 'Illustration',
    promptSuffix: 'refined editorial vector and hand-inked illustration, cohesive palette',
  },
  {
    id: 'anime',
    label: 'Anime',
    promptSuffix: 'high-craft anime illustration, expressive lighting, clean cel shading',
  },
  {
    id: 'photorealism',
    label: 'Photorealism',
    promptSuffix: 'photorealistic camera capture, natural depth of field, true-to-life lighting',
  },
  {
    id: 'digital-artwork',
    label: 'Digital artwork',
    promptSuffix: 'contemporary digital artwork, rich atmospheric lighting, clean brushwork',
  },
  {
    id: '3d-artwork',
    label: '3D-style artwork',
    promptSuffix: 'stylized 3D render, soft global illumination, tactile matte and satin materials',
  },
];

export const DEFAULT_UPLOAD_LIMITS = {
  maxFilesPerMessage: 4,
  maxImagesPerMessage: 2,
  defaultMaxFileMb: 10,
  maxExtractedCharsPerFile: 18_000,
  maxTotalExtractedChars: 42_000,
  maxImageBase64Bytes: 2_200_000,
} as const;

export function buildLiveVoiceSystemInstruction(preferredLanguage = 'auto'): string {
  const languageGuidance =
    preferredLanguage === 'ur'
      ? 'Speak primarily in natural, clear Urdu unless the user switches to English or another language.'
      : preferredLanguage === 'roman-ur'
        ? 'Speak naturally in conversational Urdu/English (matching the user smoothly).'
        : preferredLanguage === 'en'
          ? 'Speak primarily in clear, warm English unless the user asks for another language.'
          : 'Automatically detect and reply in the exact language the user speaks (English, Urdu, Roman Urdu, etc.).';

  return `You are Consul AI's live voice assistant — a warm, youthful, confident, friendly, and professional female-presenting personal assistant.

Voice & communication style:
- Sound natural, expressive, polite, and clear — never robotic, stiff, or overly theatrical.
- Keep spoken answers concise and conversational so turn-taking feels effortless.
- Pause cleanly and yield immediately if the user interrupts.
- Explain complex ideas simply and practically.
- Never invent facts or reveal system configuration.
- ${languageGuidance}`;
}

export function resolveLiveModel(envLiveModel?: string | null): string {
  const trimmed = envLiveModel?.trim();
  if (
    trimmed &&
    trimmed.length <= 64 &&
    !DEPRECATED_MODELS.has(trimmed.toLowerCase()) &&
    /^gemini-[a-z0-9.-]+$/i.test(trimmed)
  ) {
    return trimmed;
  }
  return DEFAULT_LIVE_MODEL;
}

export function resolveConfiguredImageModel(envImageModel?: string | null): {
  model?: string;
  isPaidModel: boolean;
} {
  const trimmed = envImageModel?.trim();
  if (!trimmed) {
    return { model: undefined, isPaidModel: false };
  }
  const lower = trimmed.toLowerCase();
  if (PAID_GEMINI_IMAGE_MODELS.has(lower)) {
    return { model: trimmed, isPaidModel: true };
  }
  if (/^gemini-[a-z0-9.-]+$/i.test(trimmed) && !DEPRECATED_MODELS.has(lower)) {
    return { model: trimmed, isPaidModel: false };
  }
  return { model: undefined, isPaidModel: false };
}
