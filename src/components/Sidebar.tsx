import {
  Check,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { detectTextDirection } from '../lib/language';
import type { Conversation } from '../types/chat';
import { ConsulLogo } from './ConsulLogo';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  searchQuery: string;
  isDesktopOpen: boolean;
  isMobileOpen: boolean;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onCloseDesktop: () => void;
  onCloseMobile: () => void;
}

type DateGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Earlier';

function getDateGroup(timestamp: number, now: number): DateGroup {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 86_400_000;
  const sevenDaysMs = todayMs - 7 * 86_400_000;

  if (timestamp >= todayMs) return 'Today';
  if (timestamp >= yesterdayMs) return 'Yesterday';
  if (timestamp >= sevenDaysMs) return 'Previous 7 days';
  return 'Earlier';
}

const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier'];

export function Sidebar({
  conversations,
  activeConversationId,
  searchQuery,
  isDesktopOpen,
  isMobileOpen,
  onSearchChange,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  onCloseDesktop,
  onCloseMobile,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLLIElement>(null);

  // Lock body scroll when mobile drawer is open & close on Escape
  useEffect(() => {
    if (!isMobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileOpen, onCloseMobile]);

  // Close conversation context menu on outside click or Escape
  useEffect(() => {
    if (!openMenuId) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const groupedConversations = useMemo(() => {
    const now = Date.now();
    const groups = new Map<DateGroup, Conversation[]>();
    for (const key of GROUP_ORDER) groups.set(key, []);

    for (const conv of conversations) {
      const group = getDateGroup(conv.updatedAt, now);
      groups.get(group)?.push(conv);
    }

    return GROUP_ORDER.map((label) => ({
      label,
      items: groups.get(label) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [conversations]);

  const startRename = (conv: Conversation) => {
    setOpenMenuId(null);
    setConfirmDeleteId(null);
    setEditingId(conv.id);
    setDraftTitle(conv.title);
  };

  const commitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onRenameConversation(id, trimmed);
    }
    setEditingId(null);
    setDraftTitle('');
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setDraftTitle('');
    }
  };

  const renderPanel = (isMobile: boolean) => (
    <div className="flex h-full w-[268px] max-w-[84vw] flex-col border-e border-black/[0.08] bg-[#F3F2EE] text-[#18191B] dark:border-white/[0.08] dark:bg-[#1B1C1F] dark:text-[#ECECEF]">
      {/* Top Brand & Collapse Row */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3.5 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            if (isMobile) onCloseMobile();
          }}
          className="flex min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-start transition-colors hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:hover:bg-white/[0.06]"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#3D6B58]/12 text-[#3D6B58] dark:bg-[#6BA588]/15 dark:text-[#7CC0A3]">
            <ConsulLogo className="h-4 w-4" />
          </span>
          <span className="font-display truncate text-[15px] font-semibold tracking-tight whitespace-nowrap">
            Consul AI
          </span>
        </button>

        <button
          type="button"
          onClick={isMobile ? onCloseMobile : onCloseDesktop}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#5C6066] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] sm:h-9 sm:w-9 dark:text-[#9CA1A8] dark:hover:bg-white/[0.07] dark:hover:text-white"
        >
          {isMobile ? (
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Primary Action: New Chat */}
      <div className="px-3 pt-1 pb-2">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            if (isMobile) onCloseMobile();
          }}
          className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl border border-black/[0.08] bg-white/80 px-3 py-2 text-[13.5px] font-medium text-[#18191B] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-[#ECECEF] dark:hover:bg-white/[0.09] whitespace-nowrap"
        >
          <SquarePen className="h-4 w-4 shrink-0 text-[#3D6B58] dark:text-[#7CC0A3]" aria-hidden="true" />
          <span>New chat</span>
        </button>
      </div>

      {/* Search Conversations */}
      <div className="px-3 pb-2.5">
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute start-3 h-3.5 w-3.5 text-[#757A82] dark:text-[#868B93]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search conversations"
            className="h-9 w-full rounded-xl border border-transparent bg-black/[0.045] ps-8.5 pe-7 text-[13px] text-[#18191B] placeholder:text-[#757A82] transition-colors focus:border-black/15 focus:bg-white focus:outline-none dark:bg-white/[0.05] dark:text-[#ECECEF] dark:placeholder:text-[#868B93] dark:focus:border-white/15 dark:focus:bg-[#24262B]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute end-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-[#757A82] hover:text-[#18191B] dark:text-[#868B93] dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Grouped Recent Conversations */}
      <nav aria-label="Conversation history" className="flex-1 overflow-y-auto px-2.5 py-1">
        {conversations.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs leading-relaxed text-[#757A82] dark:text-[#868B93]">
            {searchQuery.trim()
              ? 'No matching conversations found.'
              : 'Your recent chats will appear here.'}
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {groupedConversations.map((group) => (
              <section key={group.label}>
                <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-[#757A82] dark:text-[#868B93]">
                  {group.label}
                </h2>
                <ul className="space-y-0.5">
                  {group.items.map((conv) => {
                    const isActive = conv.id === activeConversationId;
                    const isEditing = editingId === conv.id;
                    const isConfirmingDelete = confirmDeleteId === conv.id;
                    const isMenuOpen = openMenuId === conv.id;
                    const titleDir = detectTextDirection(conv.title);

                    return (
                      <li
                        key={conv.id}
                        className="group relative"
                        ref={isMenuOpen ? menuContainerRef : undefined}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 rounded-xl border border-[#3D6B58] bg-white px-2.5 py-1.5 dark:border-[#6BA588] dark:bg-[#24262B]">
                            <input
                              type="text"
                              value={draftTitle}
                              onChange={(e) => setDraftTitle(e.target.value)}
                              onKeyDown={(e) => handleRenameKeyDown(e, conv.id)}
                              aria-label={`Rename conversation ${conv.title}`}
                              autoFocus
                              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[#18191B] focus:outline-none dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => commitRename(conv.id)}
                              aria-label="Save conversation title"
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#3D6B58] hover:bg-black/[0.05] dark:text-[#7CC0A3] dark:hover:bg-white/[0.08]"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ) : isConfirmingDelete ? (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/8 px-2.5 py-2">
                            <span className="truncate text-xs font-medium text-rose-700 dark:text-rose-300">
                              Delete chat?
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteConversation(conv.id);
                                  setConfirmDeleteId(null);
                                }}
                                aria-label={`Confirm delete "${conv.title}"`}
                                className="inline-flex h-7 items-center rounded-lg bg-rose-600 px-2.5 text-[11px] font-medium text-white hover:bg-rose-700"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                aria-label="Cancel delete"
                                className="inline-flex h-7 items-center rounded-lg px-2 text-[11px] font-medium text-[#5C6066] hover:bg-black/[0.05] dark:text-[#9CA1A8] dark:hover:bg-white/[0.08]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`flex items-center gap-1 rounded-xl px-1.5 py-0.5 transition-colors ${
                              isActive
                                ? 'bg-black/[0.07] text-[#18191B] dark:bg-white/[0.09] dark:text-white'
                                : 'text-[#3F4349] hover:bg-black/[0.04] dark:text-[#C8CCD2] dark:hover:bg-white/[0.05]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuId(null);
                                setConfirmDeleteId(null);
                                onSelectConversation(conv.id);
                                if (isMobile) onCloseMobile();
                              }}
                              className="min-h-[38px] min-w-0 flex-1 rounded-lg px-2 py-1.5 text-start focus-visible:outline-2 focus-visible:outline-[#3D6B58]"
                            >
                              <p
                                dir={titleDir}
                                className={`truncate text-[13.5px] leading-snug ${
                                  isActive ? 'font-medium' : 'font-normal'
                                }`}
                              >
                                {conv.title}
                              </p>
                            </button>

                            <div
                              className={`relative shrink-0 transition-opacity ${
                                isMenuOpen || isActive
                                  ? 'opacity-100'
                                  : 'opacity-75 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(null);
                                  setOpenMenuId((prev) => (prev === conv.id ? null : conv.id));
                                }}
                                aria-label={`Conversation options for "${conv.title}"`}
                                aria-expanded={isMenuOpen}
                                aria-haspopup="menu"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6A6E75] transition-colors hover:bg-black/[0.06] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#9CA1A8] dark:hover:bg-white/[0.1] dark:hover:text-white"
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </button>

                              {isMenuOpen && (
                                <div
                                  role="menu"
                                  className="absolute end-0 top-9 z-30 w-36 overflow-hidden rounded-xl border border-black/[0.1] bg-white p-1 shadow-lg dark:border-white/[0.1] dark:bg-[#24262B]"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => startRename(conv)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-[#18191B] transition-colors hover:bg-black/[0.05] dark:text-[#ECECEF] dark:hover:bg-white/[0.07]"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-[#5C6066] dark:text-[#9CA1A8]" aria-hidden="true" />
                                    <span>Rename</span>
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      setConfirmDeleteId(conv.id);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom Settings Entry */}
      <div className="border-t border-black/[0.07] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            onOpenSettings();
            if (isMobile) onCloseMobile();
          }}
          className="flex min-h-[42px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] font-medium text-[#3F4349] transition-colors hover:bg-black/[0.05] hover:text-[#18191B] focus-visible:outline-2 focus-visible:outline-[#3D6B58] dark:text-[#C8CCD2] dark:hover:bg-white/[0.06] dark:hover:text-white whitespace-nowrap"
        >
          <Settings className="h-4 w-4 shrink-0 text-[#5C6066] dark:text-[#9CA1A8]" aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {isDesktopOpen && (
        <aside className="hidden h-full shrink-0 lg:block">{renderPanel(false)}</aside>
      )}

      <AnimatePresence>
        {isMobileOpen && (
          <div
            className="fixed inset-0 z-40 flex lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Conversation navigation"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-50 h-full shadow-2xl"
            >
              {renderPanel(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
