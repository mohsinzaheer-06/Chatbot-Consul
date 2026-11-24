import type { ChatMessage, Conversation } from '../types/chat';
import { computeLastMessagePreview, loadConversations, sanitizeConversations } from './storage';

const DB_NAME = 'consul_ai_db';
const DB_VERSION = 1;
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';
const MIGRATION_FLAG_KEY = 'consul_ai_idb_migrated_v1';

interface StoredConversationRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

interface StoredMessageRow extends ChatMessage {
  conversationId: string;
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available in this browser context.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        const convStore = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
        msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('conversationCreated', ['conversationId', 'createdAt'], {
          unique: false,
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
  });
}

function toConversationRow(conv: Conversation): StoredConversationRow {
  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    lastMessagePreview: conv.lastMessagePreview ?? computeLastMessagePreview(conv.messages),
  };
}

function toMessageRow(conversationId: string, msg: ChatMessage): StoredMessageRow {
  return {
    id: msg.id,
    conversationId,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    followUpQuestions: msg.followUpQuestions,
    sources: msg.sources,
    isError: msg.isError,
    stopped: msg.stopped,
    model: msg.model,
  };
}

function stripMessageRow(row: StoredMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    followUpQuestions: row.followUpQuestions,
    sources: row.sources,
    isError: row.isError,
    stopped: row.stopped,
    model: row.model,
  };
}

export async function initAndLoadConversations(): Promise<{
  usingIndexedDb: boolean;
  conversations: Conversation[];
}> {
  if (!isIndexedDbAvailable()) {
    return { usingIndexedDb: false, conversations: loadConversations() };
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();

    // Check existing records in IndexedDB
    const readTx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readonly');
    const [convRows, msgRows] = await Promise.all([
      reqPromise<StoredConversationRow[]>(readTx.objectStore(CONVERSATIONS_STORE).getAll()),
      reqPromise<StoredMessageRow[]>(readTx.objectStore(MESSAGES_STORE).getAll()),
    ]);

    // One-time migration from legacy localStorage if IndexedDB is empty
    const alreadyMigrated =
      typeof window !== 'undefined' && window.localStorage.getItem(MIGRATION_FLAG_KEY) === '1';

    if (convRows.length === 0 && !alreadyMigrated) {
      const legacy = loadConversations();
      if (legacy.length > 0) {
        const writeTx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
        const cStore = writeTx.objectStore(CONVERSATIONS_STORE);
        const mStore = writeTx.objectStore(MESSAGES_STORE);

        for (const conv of legacy) {
          cStore.put(toConversationRow(conv));
          for (const msg of conv.messages) {
            mStore.put(toMessageRow(conv.id, msg));
          }
        }
        await txDone(writeTx);
        try {
          window.localStorage.setItem(MIGRATION_FLAG_KEY, '1');
        } catch {
          // Ignore flag write errors
        }
        return { usingIndexedDb: true, conversations: legacy };
      }
      try {
        window.localStorage.setItem(MIGRATION_FLAG_KEY, '1');
      } catch {
        // Ignore flag write errors
      }
    }

    const messagesByConv = new Map<string, ChatMessage[]>();
    for (const row of msgRows) {
      const list = messagesByConv.get(row.conversationId) ?? [];
      list.push(stripMessageRow(row));
      messagesByConv.set(row.conversationId, list);
    }

    const assembled: Conversation[] = convRows.map((row) => {
      const msgs = (messagesByConv.get(row.id) ?? []).sort((a, b) => a.createdAt - b.createdAt);
      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastMessagePreview: row.lastMessagePreview ?? computeLastMessagePreview(msgs),
        messages: msgs,
      };
    });

    return {
      usingIndexedDb: true,
      conversations: sanitizeConversations(assembled),
    };
  } catch {
    return { usingIndexedDb: false, conversations: loadConversations() };
  } finally {
    db?.close();
  }
}

export async function syncConversationTx(conv: Conversation): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
    const cStore = tx.objectStore(CONVERSATIONS_STORE);
    const mStore = tx.objectStore(MESSAGES_STORE);

    cStore.put(toConversationRow(conv));

    // Delete any messages in this conversation that are no longer in conv.messages
    const keepIds = new Set(conv.messages.map((m) => m.id));
    const idx = mStore.index('conversationId');
    const cursorReq = idx.openCursor(IDBKeyRange.only(conv.id));
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        const row = cursor.value as StoredMessageRow;
        if (!keepIds.has(row.id)) {
          cursor.delete();
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    for (const msg of conv.messages) {
      mStore.put(toMessageRow(conv.id, msg));
    }

    await txDone(tx);
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function upsertManyConversationsTx(conversations: Conversation[]): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
    const cStore = tx.objectStore(CONVERSATIONS_STORE);
    const mStore = tx.objectStore(MESSAGES_STORE);

    for (const conv of conversations) {
      cStore.put(toConversationRow(conv));
      for (const msg of conv.messages) {
        mStore.put(toMessageRow(conv.id, msg));
      }
    }

    await txDone(tx);
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function deleteConversationTx(conversationId: string): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
    const cStore = tx.objectStore(CONVERSATIONS_STORE);
    const mStore = tx.objectStore(MESSAGES_STORE);

    cStore.delete(conversationId);

    const idx = mStore.index('conversationId');
    const cursorReq = idx.openCursor(IDBKeyRange.only(conversationId));
    await new Promise<void>((resolve, reject) => {
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function clearAllDbTx(): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
    const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
    tx.objectStore(CONVERSATIONS_STORE).clear();
    tx.objectStore(MESSAGES_STORE).clear();
    await txDone(tx);
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
