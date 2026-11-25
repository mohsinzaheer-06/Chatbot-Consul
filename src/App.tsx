import {
  AlertCircle,
  CheckSquare,
  Menu,
  Moon,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  SquarePen,
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
    apiStatus,
    refreshApiStatus,
    updateTheme,
    updateResponseLength,
    updatePreferredLanguage,
    updateModel,
    updateMaxUploadMb,
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
    messagesEndRef.current?.scrollIntoView({
      behavior: isGenerating ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages.length, messages[messages.length - 1]?.content, isGenerating]);

  const toggleMessageSelection = (messageId: string) => {
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    );
  };

  const enterSelectionWith = (messageId: string) => {
    setIsSelectionMode(true);
    setSelectedMessageIds((prev) => (prev.includes(messageId) ? prev : [...prev, messageId]));
    setConfirmClearChat(false);
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#FAF9F6] text-[#18191B] dark:bg-[#131416] dark:text-[#ECECEF]">
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
        {/* Clean, Spacious Top Header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] bg-[#FAF9F6]/90 px-3.5 pt-[env(safe-area-inset-top)] backdrop-blur-xs sm:px-6 dark:border-white/[0.06] dark:bg-[#131416]/90">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open conversation sidebar"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] lg:hidden dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            {!isDesktopSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsDesktopSidebarOpen(true)}
                aria-label="Expand sidebar"
                title="Expand sidebar"
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] lg:inline-flex dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white"
              >
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <span className="font-display truncate text-[15px] font-semibold tracking-tight text-[#18191B] dark:text-[#ECECEF]">
              {activeConversation ? activeConversation.title : 'Consul AI'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {activeConversation && messages.length > 0 && !isGenerating && (
              <button
                type="button"
                onClick={() => {
                  setIsSelectionMode((prev) => !prev);
                  setSelectedMessageIds([]);
                  setConfirmClearChat(false);
                }}
                aria-label={isSelectionMode ? 'Exit message selection' : 'Select messages'}
                title={isSelectionMode ? 'Done selecting' : 'Select messages'}
                className={`hidden sm:inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelectionMode
                    ? 'bg-[#3D6B58]/12 text-[#3D6B58] dark:bg-[#6BA588]/18 dark:text-[#7CC0A3]'
                    : 'text-[#5C6066] hover:bg-black/[0.05] hover:text-[#18191B] dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white'
                }`}
              >
                <CheckSquare className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{isSelectionMode ? 'Done' : 'Select'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={createNewChat}
              aria-label="Start new chat"
              title="New chat"
              className={`${
                isDesktopSidebarOpen ? 'lg:hidden' : ''
              } inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] sm:h-9 sm:w-auto sm:gap-1.5 sm:px-2.5 dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white whitespace-nowrap shrink-0`}
            >
              <SquarePen className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              <span className="hidden text-xs font-medium sm:inline">New chat</span>
            </button>

            <button
              type="button"
              onClick={() => updateTheme(settings.theme === 'dark' ? 'light' : 'dark')}
              aria-label={
                settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              title={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] sm:h-9 sm:w-9 dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              {settings.theme === 'dark' ? (
                <Sun className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings & Status"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] sm:h-9 sm:w-9 dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white"
            >
              <Settings className="h-4.5 w-4.5 sm:h-4 sm:w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Bulk message selection toolbar */}
        {isSelectionMode && activeConversation && messages.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.07] bg-[#F3F2EE] px-4 py-2 text-xs sm:px-6 dark:border-white/[0.08] dark:bg-[#1B1C1F]">
            <span className="font-medium text-[#3F4349] dark:text-[#D5D8DD]">
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
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Delete selected</span>
              </button>

              {!confirmClearChat ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearChat(true)}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-1 font-medium text-rose-700 hover:bg-rose-500/15 dark:text-rose-300"
                >
                  <span>Clear chat</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1">
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
                    className="text-[#5C6066] hover:underline dark:text-[#9CA1A8]"
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5C6066] hover:bg-black/[0.05] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Main Scrollable Chat Canvas */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          {storageWarning && (
            <div className="mx-auto mt-3 w-full max-w-[760px] px-5 sm:px-8">
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{storageWarning}</span>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <WelcomeScreen detectedContext={detectedContext} onSelectPrompt={sendMessage} />
          ) : (
            <div className="mx-auto w-full max-w-[760px] flex-1 space-y-7 px-5 pt-6 pb-8 sm:space-y-8 sm:px-8 sm:pt-8 sm:pb-10">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLatestAssistant={msg.id === lastAssistantId}
                  isGenerating={isGenerating}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedMessageIds.includes(msg.id)}
                  onToggleSelect={() => toggleMessageSelection(msg.id)}
                  onEnterSelectionMode={() => enterSelectionWith(msg.id)}
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
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
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearError}
                      className="min-h-[34px] rounded-xl px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-300 whitespace-nowrap"
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
          maxUploadMb={settings.maxUploadMb}
          onSend={sendMessage}
          onStop={stopGeneration}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        conversationCount={conversations.length}
        apiStatus={apiStatus}
        detectedContext={detectedContext}
        onClose={() => setIsSettingsOpen(false)}
        onRefreshApiStatus={refreshApiStatus}
        onUpdateTheme={updateTheme}
        onUpdateResponseLength={updateResponseLength}
        onUpdatePreferredLanguage={updatePreferredLanguage}
        onUpdateModel={updateModel}
        onUpdateMaxUploadMb={updateMaxUploadMb}
        onExportJson={exportJson}
        onExportTxt={exportTxt}
        onImportJson={importJson}
        onClearAllHistory={clearAllHistory}
      />
    </div>
  );
}
