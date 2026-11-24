# Consul AI — Multilingual Personal Assistant

A private, modern personal AI assistant built with React, TypeScript, Tailwind CSS, Express, Vercel Serverless Functions, and the official `@google/genai` SDK. Supports **English**, **Urdu (اردو)** with automatic RTL rendering, and **Roman Urdu**, detects live location/timezone context with web search grounding, generates **3 contextual follow-up questions** after every reply, and persists conversations and messages locally in **IndexedDB**.

---

## Features

- **Professional Consultant Persona**: Direct, clear, polite, and simple explanations structured with headings, bullet points, and practical examples.
- **Multilingual & RTL Intelligence**: Automatically detects English, Urdu script (`اردو`), Roman Urdu, and mixed-language messages, replying in the user's language with proper RTL/LTR layout.
- **Live Context & Web Grounding**: Automatically uses client timezone + IP geolocation context (`ipwho.is` / Open-Meteo / Google Search grounding) for time-sensitive and location-aware answers with clickable sources.
- **Smart Follow-Up Suggestions**: Automatically generates 3 relevant, non-repetitive follow-up questions after every response in the exact same language and script.
- **IndexedDB Persistence & Full CRUD**:
  - Dedicated `consul_ai_db` IndexedDB database with `conversations` and `messages` stores (automatic one-time migration from legacy `localStorage`).
  - Create, search (titles + content), rename, and delete conversations (with inline confirmation), plus clear all history.
  - Edit previous user messages (truncates outdated subsequent replies and regenerates), delete individual messages, multi-select & delete messages, clear a conversation's messages, copy, and regenerate.
  - JSON/TXT export and validated JSON import.
- **Light & Dark Modes**: Dual-theme UI with animated thinking screen and responsive mobile drawer navigation.

---

## Project Structure

- `api/chat.ts`, `api/health.ts`, `api/tsconfig.json` — Self-contained Vercel Node Serverless Functions (`NodeNext` ESM) supporting SSE streaming, automatic fallback, and runtime error handling.
- `vercel.json` — Vercel function duration (`maxDuration: 60`) and SPA rewrite config excluding `/api/*`.
- `server.ts` & `server/` — Express server and helper modules (`gemini.ts`, `location.ts`, `webFallback.ts`) for local and Node server deployments.
- `src/App.tsx` — Main workspace layout, bulk selection toolbar, header controls, and modal wiring.
- `src/hooks/useChatStore.ts` — Conversation & message CRUD state, IndexedDB transaction sync, SSE stream reader, theme toggling, and export/import handlers.
- `src/lib/indexedDb.ts` & `src/lib/storage.ts` — IndexedDB (`conversations` & `messages` stores), `localStorage` settings/migration, and export/import utilities.
- `src/components/` — Modular UI components (`Sidebar.tsx`, `WelcomeScreen.tsx`, `MessageBubble.tsx`, `ThinkingLoader.tsx`, `MarkdownContent.tsx`, `CodeBlock.tsx`, `ChatInput.tsx`, `SettingsModal.tsx`).
- `src/lib/core.test.ts` — Unit tests covering language detection, SSE marker accumulator, request validation, storage/preview logic, IP checks, and grounding sources.

---

## Deploying to Vercel

1. Push this repository to GitHub and import it in **Vercel** (Framework Preset: **Vite**).
2. In **Vercel Project Settings → Environment Variables**, add:
   - `GEMINI_API_KEY` = your Google AI Studio API key (required, server-side only)
   - `GEMINI_MODEL` = `gemini-3.8-flash` (optional; automatically falls back to `gemini-3.1-flash-lite` / `gemini-4-hydrogen` if unavailable for your key)
3. Verify **Output Directory** is `dist` and **Install Command** is `npm install`.
4. **Redeploy** from Vercel Deployments after updating environment variables so serverless functions pick up changes, then check `/api/health` to confirm `apiKeyConfigured: true`.

---

## Local Setup & Running

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`:
   ```env
   GEMINI_API_KEY="your_actual_gemini_api_key"
   GEMINI_MODEL="gemini-3.8-flash"
   APP_URL="http://localhost:3000"
   ```

3. **Run in development**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

4. **Run unit tests, type-check, and production build**:
   ```bash
   npx tsx --test src/lib/core.test.ts
   npm run lint
   npm run build
   npm start
   ```

---

## Privacy Note on Local Browser Storage

Conversations and messages are stored locally in your browser's **IndexedDB** (`consul_ai_db`), and lightweight UI preferences are stored in `localStorage`. Browser storage is **not encrypted** and is tied to your current browser/device—clearing browser site data removes saved history. Avoid storing confidential passwords, financial credentials, or sensitive private records in browser-local chat history.
