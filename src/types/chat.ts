export type ThemeMode = 'light' | 'dark';

export type ResponseLength = 'quick' | 'balanced' | 'detailed' | 'concise';

export type PreferredLanguage = 'auto' | 'en' | 'ur' | 'roman-ur';

export type EligibleModel =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.8-flash'
  | 'gemini-4-hydrogen'
  | (string & {});

export type LiveVoiceName = 'Zephyr' | 'Kore';

export type MessageRole = 'user' | 'assistant';

export type TextDirection = 'ltr' | 'rtl';

export type AttachmentKind = 'document' | 'spreadsheet' | 'presentation' | 'image' | 'text';

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  summaryLabel?: string;
  extractedText?: string;
  previewDataUrl?: string;
  inlineImageBase64?: string;
  pageCount?: number;
  sheetNames?: string[];
  slideCount?: number;
  truncated?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ClientContext {
  timezone?: string;
  localTimeIso?: string;
  locale?: string;
}

export interface UserLocationContext {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  localTimeFormatted: string;
  source: 'ip+browser' | 'ip' | 'browser';
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  attachments?: MessageAttachment[];
  followUpQuestions?: string[];
  sources?: GroundingSource[];
  isError?: boolean;
  stopped?: boolean;
  model?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  messages: ChatMessage[];
}

export interface UserSettings {
  theme: ThemeMode;
  responseLength: ResponseLength;
  model: EligibleModel;
  preferredLanguage: PreferredLanguage;
  liveVoiceName?: LiveVoiceName;
  maxUploadMb?: number;
}

export interface ChatHistoryTurn {
  role: 'user' | 'model';
  content: string;
}

export interface ChatRequestPayload {
  message: string;
  history: ChatHistoryTurn[];
  attachments?: MessageAttachment[];
  responseLength: ResponseLength;
  preferredLanguage?: PreferredLanguage;
  model?: EligibleModel;
  clientContext?: ClientContext;
}

export interface ExportPayload {
  app: string;
  version: number;
  exportedAt: string;
  conversations: Conversation[];
}

export type ImageStylePreset =
  | 'none'
  | 'product-photography'
  | 'lifestyle-photography'
  | 'commercial-advertising'
  | 'illustration'
  | 'anime'
  | 'photorealism'
  | 'digital-artwork'
  | '3d-artwork';

export type ImageAspectRatio = '1:1' | '4:3' | '16:9' | '3:4' | '9:16';

export interface GeneratedImageRecord {
  id: string;
  prompt: string;
  style: ImageStylePreset;
  aspectRatio: ImageAspectRatio;
  dataUrl: string;
  mimeType: string;
  provider: string;
  model: string;
  createdAt: number;
  batchId: string;
  variantIndex: number;
}

export interface ApiStatusSnapshot {
  ok: boolean;
  configured: boolean;
  defaultModel: string;
  eligibleModels: string[];
  liveModel: string;
  liveAvailable: boolean;
  liveTransport: 'ws-bridge+ephemeral' | 'ephemeral-only' | 'unavailable';
  liveUnavailableReason?: string;
  imageModel?: string;
  imageProvider: 'none' | 'gemini' | 'huggingface' | 'aihorde';
  imageAvailable: boolean;
  imageUnavailableReason?: string;
  freeOnlyPolicy: boolean;
  rateLimit: {
    windowSec: number;
    maxRequests: number;
  };
  nodeVersion?: string;
}
