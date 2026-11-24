import {
  AlertCircle,
  CheckSquare,
  Menu,
  Moon,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ChatInput } from './components/ChatInput';
import { MessageBubble } from './components/MessageBubble';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useChatStore } from './hooks/useChatStore';

export default function App() {
  const {
    conversations,
    filteredConversations,
    activeConversation,
    activeConversationId,
    settings,
    searchQuery,
    setSearchQuery,
    isGenerating,
    errorState,
    clearError,
    storageWarning,
    updateTheme,
    updateResponseLength,
    updateModel,
    createNewChat,
    selectConversation,
    renameConversation,
    deleteConversation,
    clearAllHistory,
    deleteMessage,
    deleteSelectedMessages,
    clearConversationMessages,
    editUserMessage,
    sendMessage,
    stopGeneration,
    regenerateLastResponse,
    retryLastError,
    exportJson,
    exportTxt,
    importJson,
    focusInputSignal,
    detectedContext,
  } = useChatStore();

  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [confirmClearChat, setConfirmClearChat] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation?.messages ?? [];
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  })();

  useEffect(() => {
    setIsSelectionMode(false);
    setSelectedMessageIds([]);
    setConfirmClearChat(false);
  }, [activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const toggleMessageSelection = (messageId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    );
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#F5F4EE] text-zinc-950 dark:bg-[#09090E] dark:text-zinc-100">
      <Sidebar
        conversations={filteredConversations}
        activeConversationId={activeConversationId}
        searchQuery={searchQuery}
        isDesktopOpen={isDesktopSidebarOpen}
        isMobileOpen={isMobileSidebarOpen}
        onSearchChange={setSearchQuery}
        onNewChat={createNewChat}
        onSelectConversation={selectConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onCloseDesktop={() => setIsDesktopSidebarOpen(false)}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean single-row header */}
        <header className="flex h-13 shrink-0 items-center justify-between gap-4 border-b-2 border-emerald-600/20 bg-[#F2FBF6]/95 px-3 backdrop-blur-xs sm:px-5 dark:border-emerald-400/20 dark:bg-[#0D1617]/95">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open conversation sidebar"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-blue-600 lg:hidden dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            {!isDesktopSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsDesktopSidebarOpen(true)}
                aria-label="Expand sidebar"
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-blue-600 lg:inline-flex dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <span className="font-display truncate text-sm font-bold tracking-tight text-zinc-950 dark:text-white">
              {activeConversation ? activeConversation.title : 'Consul AI'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {activeConversation && messages.length > 0 && !isGenerating && (
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode((prev) => !prev);
                  setSelectedMessageIds([]);
                  setConfirmClearChat(false);
                }}
                aria-label={isSelectionMode ? 'Exit message selection' : 'Select messages'}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelectionMode
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'border-zinc-900/12 bg-[#FAF9F5] text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:border-white/12 dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:bg-white/10'
                }`}
              >
                <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{isSelectionMode ? 'Done' : 'Select'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={createNewChat}
              aria-label="Start new chat"
              className={`${
                isDesktopSidebarOpen ? 'lg:hidden' : ''
              } inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-900/12 bg-[#FAF9F5] px-2.5 text-xs font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-white/12 dark:bg-white/[0.06] dark:text-zinc-100 dark:hover:bg-white/10 whitespace-nowrap shrink-0`}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New chat</span>
            </button>

            <button
              type="button"
              onClick={() => updateTheme(settings.theme === 'dark' ? 'light' : 'dark')}
              aria-label={
                settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              {settings.theme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Bulk message management toolbar when Select mode is active */}
        {isSelectionMode && activeConversation && messages.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900/10 bg-[#FAF9F5] px-4 py-2 text-xs dark:border-white/10 dark:bg-[#12121B]">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {selectedMessageIds.length} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={selectedMessageIds.length === 0}
                onClick={() => {
                  deleteSelectedMessages(activeConversation.id, selectedMessageIds);
                  setSelectedMessageIds([]);
                  setIsSelectionMode(false);
                }}
                className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Delete selected</span>
              </button>

              {!confirmClearChat ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearChat(true)}
                  className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  <span>Clear chat</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2 py-0.5 dark:border-rose-900/60 dark:bg-rose-950/50">
                  <button
                    type="button"
                    onClick={() => {
                      clearConversationMessages(activeConversation.id);
                      setConfirmClearChat(false);
                      setIsSelectionMode(false);
                      setSelectedMessageIds([]);
                    }}
                    className="font-semibold text-rose-700 hover:underline dark:text-rose-300"
                  >
                    Confirm clear all
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearChat(false)}
                    className="text-zinc-600 hover:underline dark:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedMessageIds([]);
                  setConfirmClearChat(false);
                }}
                aria-label="Close selection toolbar"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Main Scrollable Chat Viewport */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          {storageWarning && (
            <div className="mx-auto mt-3 w-full max-w-3xl px-4">
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{storageWarning}</span>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <WelcomeScreen detectedContext={detectedContext} onSelectPrompt={sendMessage} />
          ) : (
            <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-3 py-6 sm:px-6">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLatestAssistant={msg.id === lastAssistantId}
                  isGenerating={isGenerating}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedMessageIds.includes(msg.id)}
                  onToggleSelect={() => toggleMessageSelection(msg.id)}
                  onSelectFollowUp={sendMessage}
                  onRegenerate={regenerateLastResponse}
                  onEditUserMessage={
                    activeConversation && msg.role === 'user'
                      ? (nextContent) => editUserMessage(activeConversation.id, msg.id, nextContent)
                      : undefined
                  }
                  onDeleteMessage={
                    activeConversation
                      ? () => deleteMessage(activeConversation.id, msg.id)
                      : undefined
                  }
                />
              ))}

              {errorState && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{errorState.message}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {errorState.retryable && (
                      <button
                        type="button"
                        onClick={retryLastError}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1 text-xs font-medium text-white hover:bg-rose-800 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearError}
                      className="min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/50 whitespace-nowrap"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-2" />
            </div>
          )}
        </main>

        <ChatInput
          isGenerating={isGenerating}
          focusSignal={focusInputSignal}
          onSend={sendMessage}
          onStop={stopGeneration}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        conversationCount={conversations.length}
        detectedContext={detectedContext}
        onClose={() => setIsSettingsOpen(false)}
        onUpdateTheme={updateTheme}
        onUpdateResponseLength={updateResponseLength}
        onUpdateModel={updateModel}
        onExportJson={exportJson}
        onExportTxt={exportTxt}
        onImportJson={importJson}
        onClearAllHistory={clearAllHistory}
      />
    </div>
  );
}
