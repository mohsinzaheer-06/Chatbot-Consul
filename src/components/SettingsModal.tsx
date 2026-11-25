import {
  Activity,
  AlertTriangle,
  Download,
  FileText,
  Globe2,
  HardDrive,
  Languages,
  Moon,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { formatBytes } from '../lib/fileProcessor';
import {
  clearGeneratedImagesTx,
  getStorageUsageSummary,
  type StorageUsageSummary,
} from '../lib/indexedDb';
import { FREE_TEXT_MODELS } from '../lib/models';
import type {
  ApiStatusSnapshot,
  EligibleModel,
  PreferredLanguage,
  ResponseLength,
  ThemeMode,
  UserSettings,
} from '../types/chat';

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  conversationCount: number;
  apiStatus: ApiStatusSnapshot | null;
  detectedContext: {
    timezone: string;
    locationLabel?: string;
  };
  onClose: () => void;
  onRefreshApiStatus: () => Promise<ApiStatusSnapshot | null>;
  onUpdateTheme: (theme: ThemeMode) => void;
  onUpdateResponseLength: (length: ResponseLength) => void;
  onUpdatePreferredLanguage: (language: PreferredLanguage) => void;
  onUpdateModel: (model: EligibleModel) => void;
  onUpdateMaxUploadMb: (mb: number) => void;
  onExportJson: () => void;
  onExportTxt: () => void;
  onImportJson: (raw: string) => { ok: true; count: number } | { ok: false; error: string };
  onClearAllHistory: () => void;
}

export function SettingsModal({
  isOpen,
  settings,
  conversationCount,
  apiStatus,
  detectedContext,
  onClose,
  onRefreshApiStatus,
  onUpdateTheme,
  onUpdateResponseLength,
  onUpdatePreferredLanguage,
  onUpdateModel,
  onUpdateMaxUploadMb,
  onExportJson,
  onExportTxt,
  onImportJson,
  onClearAllHistory,
}: SettingsModalProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [storageSummary, setStorageSummary] = useState<StorageUsageSummary | null>(null);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStorageInfo = async () => {
    const summary = await getStorageUsageSummary();
    setStorageSummary(summary);
  };

  useEffect(() => {
    if (!isOpen) {
      setConfirmClear(false);
      setImportStatus(null);
      return;
    }

    void loadStorageInfo();
    void onRefreshApiStatus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, onRefreshApiStatus]);

  if (!isOpen) return null;

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = onImportJson(text);
      if (result.ok) {
        setImportStatus({
          type: 'success',
          text: `Imported ${result.count} conversation${result.count === 1 ? '' : 's'}.`,
        });
        void loadStorageInfo();
      } else {
        setImportStatus({ type: 'error', text: result.error });
      }
    } catch {
      setImportStatus({
        type: 'error',
        text: 'Unable to read the selected file.',
      });
    }
  };

  const handleRefreshStatus = async () => {
    setIsRefreshingStatus(true);
    await Promise.all([onRefreshApiStatus(), loadStorageInfo()]);
    setIsRefreshingStatus(false);
  };

  const handleClearImages = async () => {
    await clearGeneratedImagesTx();
    await loadStorageInfo();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-black/[0.1] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-6 dark:border-white/[0.1] dark:bg-[#1B1C1F]">
        <div className="flex items-center justify-between gap-4 border-b border-black/[0.08] pb-4 dark:border-white/[0.08]">
          <h2
            id="settings-modal-title"
            className="font-display text-lg font-semibold tracking-tight text-[#18191B] dark:text-[#ECECEF]"
          >
            Settings &amp; Status
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {/* Appearance */}
          <section>
            <h3 className="text-sm font-medium text-[#18191B] dark:text-[#ECECEF]">
              Appearance
            </h3>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl bg-[#F3F2EE] p-1 dark:bg-[#131416]">
              <button
                type="button"
                onClick={() => onUpdateTheme('light')}
                className={`flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  settings.theme === 'light'
                    ? 'bg-white text-[#18191B] shadow-xs dark:bg-[#24262B] dark:text-white'
                    : 'text-[#5C6066] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:text-white'
                }`}
              >
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateTheme('dark')}
                className={`flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  settings.theme === 'dark'
                    ? 'bg-white text-[#18191B] shadow-xs dark:bg-[#24262B] dark:text-white'
                    : 'text-[#5C6066] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:text-white'
                }`}
              >
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Dark</span>
              </button>
            </div>
          </section>

          {/* Response Preferences */}
          <section>
            <h3 className="text-sm font-medium text-[#18191B] dark:text-[#ECECEF]">
              Response preference
            </h3>
            <p className="mt-0.5 text-xs text-[#6E737B] dark:text-[#8E939C]">
              Balance speed, clarity, and depth for AI responses.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    id: 'quick',
                    label: 'Quick',
                    desc: 'Prioritize response speed & short answers.',
                  },
                  {
                    id: 'balanced',
                    label: 'Balanced (Default)',
                    desc: 'Fast, clear and useful answers with enough detail when needed.',
                  },
                  {
                    id: 'detailed',
                    label: 'Detailed',
                    desc: 'Comprehensive explanations with context and examples.',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdateResponseLength(opt.id)}
                  className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                    settings.responseLength === opt.id || (settings.responseLength === 'concise' && opt.id === 'quick')
                      ? 'border-[#3D6B58] bg-white shadow-xs dark:border-[#6BA588] dark:bg-[#24262B]'
                      : 'border-black/[0.08] bg-[#FAF9F6] hover:bg-black/[0.03] dark:border-white/[0.08] dark:bg-[#131416] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="font-medium text-xs text-[#18191B] dark:text-white">
                    {opt.label}
                  </span>
                  <span className="mt-1 text-[11px] text-[#5C6066] dark:text-[#9CA1A8] leading-tight">
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Language Preferences */}
          <section>
            <label
              htmlFor="preferred-language-select"
              className="flex items-center gap-1.5 text-sm font-medium text-[#18191B] dark:text-[#ECECEF]"
            >
              <Languages className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
              <span>Language preference</span>
            </label>
            <p className="mt-0.5 text-xs text-[#6E737B] dark:text-[#8E939C]">
              Auto-detect matches each message&apos;s language, or set a default reply language.
            </p>
            <select
              id="preferred-language-select"
              value={settings.preferredLanguage}
              onChange={(e) => onUpdatePreferredLanguage(e.target.value as PreferredLanguage)}
              className="mt-2.5 h-10 w-full rounded-xl border border-black/[0.12] bg-white px-3 text-sm text-[#18191B] focus:border-[#3D6B58] focus:outline-none dark:border-white/[0.12] dark:bg-[#24262B] dark:text-[#ECECEF] dark:focus:border-[#6BA588]"
            >
              <option value="auto">Auto-detect (Recommended)</option>
              <option value="en">English</option>
              <option value="ur">اردو (Urdu script)</option>
              <option value="roman-ur">Roman Urdu</option>
            </select>
          </section>

          {/* Model Configuration */}
          <section>
            <label
              htmlFor="gemini-model-select"
              className="block text-sm font-medium text-[#18191B] dark:text-[#ECECEF]"
            >
              Text &amp; document model
            </label>
            <select
              id="gemini-model-select"
              value={settings.model}
              onChange={(e) => onUpdateModel(e.target.value as EligibleModel)}
              className="mt-2 h-10 w-full rounded-xl border border-black/[0.12] bg-white px-3 text-xs text-[#18191B] focus:border-[#3D6B58] focus:outline-none dark:border-white/[0.12] dark:bg-[#24262B] dark:text-[#ECECEF] dark:focus:border-[#6BA588]"
            >
              {FREE_TEXT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.description})
                </option>
              ))}
            </select>
          </section>

          {/* Local Upload Size Cap */}
          <section>
            <div className="flex items-center justify-between">
              <label
                htmlFor="max-upload-mb"
                className="text-sm font-medium text-[#18191B] dark:text-[#ECECEF]"
              >
                Max file upload limit
              </label>
              <span className="font-mono-code text-xs text-[#5C6066] dark:text-[#9CA1A8]">
                {settings.maxUploadMb ?? 10} MB
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[#6E737B] dark:text-[#8E939C]">
              Files are parsed locally in your browser before sending bounded context.
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-xl bg-[#F3F2EE] p-1 dark:bg-[#131416]">
              {[5, 10, 15].map((mb) => (
                <button
                  key={mb}
                  type="button"
                  onClick={() => onUpdateMaxUploadMb(mb)}
                  className={`min-h-[34px] rounded-lg text-xs font-medium transition-colors ${
                    (settings.maxUploadMb ?? 10) === mb
                      ? 'bg-white text-[#18191B] shadow-xs dark:bg-[#24262B] dark:text-white'
                      : 'text-[#5C6066] dark:text-[#9CA1A8]'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>
          </section>

          {/* API Status & Free-Tier Quota */}
          <section
            data-testid="api-status-panel"
            className="rounded-xl border border-black/[0.08] bg-[#FAF9F6] p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#131416]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-[#18191B] dark:text-[#ECECEF]">
                <Activity className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
                <span>API status &amp; free-tier availability</span>
              </div>
              <button
                type="button"
                onClick={() => void handleRefreshStatus()}
                aria-label="Refresh API status"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#3D6B58] hover:bg-black/[0.04] dark:text-[#7CC0A3] dark:hover:bg-white/[0.06]"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <dl className="mt-2.5 space-y-1.5 text-[#5C6066] dark:text-[#9CA1A8]">
              <div className="flex items-center justify-between gap-2">
                <dt>Server API key:</dt>
                <dd className="font-mono-code font-medium text-[#18191B] dark:text-[#ECECEF]">
                  {apiStatus ? (apiStatus.configured ? 'Configured' : 'Missing') : 'Checking…'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Active text model:</dt>
                <dd className="font-mono-code font-medium text-[#18191B] dark:text-[#ECECEF]">
                  {settings.model || apiStatus?.defaultModel || 'gemini-3.8-flash'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Image generation:</dt>
                <dd className="font-mono-code font-medium text-[#18191B] dark:text-[#ECECEF]">
                  {apiStatus?.imageAvailable
                    ? `${apiStatus.imageProvider} (${apiStatus.imageModel})`
                    : 'Disabled (free-only policy)'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt>Rate-limit guard:</dt>
                <dd className="font-mono-code">
                  {apiStatus?.rateLimit
                    ? `${apiStatus.rateLimit.maxRequests} req / ${apiStatus.rateLimit.windowSec}s`
                    : '25 req / 60s'}
                </dd>
              </div>
            </dl>
          </section>

          {/* Detected Location & Timezone Context */}
          <section className="rounded-xl border border-black/[0.08] bg-[#FAF9F6] p-3.5 text-xs dark:border-white/[0.08] dark:bg-[#131416]">
            <div className="flex items-center gap-2 font-medium text-[#18191B] dark:text-[#ECECEF]">
              <Globe2 className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
              <span>Detected context</span>
            </div>
            <p className="mt-1 leading-relaxed text-[#5C6066] dark:text-[#9CA1A8]">
              Timezone: <span className="font-mono-code font-medium">{detectedContext.timezone}</span>
              {detectedContext.locationLabel ? ` · Location: ${detectedContext.locationLabel}` : ''}
            </p>
          </section>

          {/* Conversation & Image Storage Management */}
          <section className="border-t border-black/[0.08] pt-5 dark:border-white/[0.08]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#18191B] dark:text-[#ECECEF]">
                Conversation &amp; local data
              </h3>
              <span className="font-mono-code text-xs text-[#6E737B] tabular-nums dark:text-[#8E939C]">
                {conversationCount} chats · {storageSummary?.generatedImageCount ?? 0} images
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onExportJson}
                disabled={conversationCount === 0}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#18191B] transition-colors hover:bg-black/[0.03] disabled:opacity-45 dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#ECECEF] dark:hover:bg-white/[0.08] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export JSON</span>
              </button>

              <button
                type="button"
                onClick={onExportTxt}
                disabled={conversationCount === 0}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#18191B] transition-colors hover:bg-black/[0.03] disabled:opacity-45 dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#ECECEF] dark:hover:bg-white/[0.08] whitespace-nowrap"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export TXT</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#18191B] transition-colors hover:bg-black/[0.03] dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#ECECEF] dark:hover:bg-white/[0.08] whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Import JSON</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelected}
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>

            {importStatus && (
              <p
                role="status"
                className={`mt-2.5 text-xs font-medium ${
                  importStatus.type === 'success'
                    ? 'text-[#3D6B58] dark:text-[#7CC0A3]'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {importStatus.text}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {(storageSummary?.generatedImageCount ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void handleClearImages()}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#18191B] hover:bg-black/[0.03] dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#ECECEF]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear saved images</span>
                </button>
              )}

              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  disabled={conversationCount === 0}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-rose-500/25 bg-rose-500/6 px-3.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-500/12 disabled:opacity-45 dark:text-rose-300 dark:hover:bg-rose-500/15 whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Clear all chats</span>
                </button>
              ) : (
                <div className="w-full rounded-xl border border-rose-500/25 bg-rose-500/8 p-3.5">
                  <div className="flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>
                      Delete all {conversationCount} locally saved conversations? This cannot be undone.
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClearAllHistory();
                        setConfirmClear(false);
                        void loadStorageInfo();
                      }}
                      className="min-h-[34px] rounded-lg bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 whitespace-nowrap"
                    >
                      Confirm clear all
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="min-h-[34px] rounded-lg border border-black/[0.1] bg-white px-3 py-1 text-xs font-medium text-[#18191B] hover:bg-black/[0.03] dark:border-white/[0.1] dark:bg-[#24262B] dark:text-[#ECECEF] whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Local Storage & Privacy Notice */}
          <section className="rounded-xl border border-black/[0.07] bg-[#FAF9F6] p-3.5 text-xs leading-relaxed text-[#5C6066] dark:border-white/[0.07] dark:bg-[#131416] dark:text-[#9CA1A8]">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 font-medium text-[#18191B] dark:text-[#ECECEF]">
                <HardDrive className="h-3.5 w-3.5 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
                <span>Local browser storage &amp; privacy</span>
              </p>
              {typeof storageSummary?.usageBytes === 'number' && (
                <span className="font-mono-code text-[11px]">
                  {formatBytes(storageSummary.usageBytes)} used
                </span>
              )}
            </div>
            <p className="mt-1.5">
              Conversations, parsed attachment previews, and generated images are stored locally in this browser&apos;s IndexedDB. Stored data is browser-specific, unencrypted at rest, and not backed up to any cloud server. Export JSON backups regularly.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
