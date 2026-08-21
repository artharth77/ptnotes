# Plan: AI provider profiles

## Overview

Replace the single flat `AIProviderConfig` with a **profile set**: a list of named profiles (each
with baseUrl/apiKey/model) plus a persisted `activeProfileId`. `uploadPdfEnabled` is a **global**
toggle (not per-profile). Legacy single-config data migrates into **Profile 1** and becomes the
active profile. The Base URL field gets a dropdown of predefined endpoints. API keys stay **plain
text** with `chmod 600`, exactly as today — **no encryption**.

## 1. Types — `src/shared/types.ts`

- Add new types:
  ```ts
  export interface AIProfile {
    id: string              // auto slugified ("profile-1", "ollama-local")
    name: string            // editable display name
    baseUrl: string
    apiKey: string          // plain text, stored with chmod 600
    model: string
  }
  export interface AIConfig {
    profiles: AIProfile[]
    activeProfileId: string
    uploadPdfEnabled: boolean   // global, not per-profile
  }
  ```
- Keep `AIProviderConfig` unchanged so existing consumers (`chatSession`, `runner`, `runs`,
  `files`, `ChatDrawer`, title generation) keep working. The store's `load()` returns the
  **active** profile as an `AIProviderConfig` merged with the global `uploadPdfEnabled`.

## 2. Endpoint presets — `src/shared/aiEndpoints.ts` (new)

```ts
export const AI_ENDPOINTS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'Ollama Cloud', url: 'https://ollama.com/v1' },
  { name: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1' },
  { name: '9arm AI Passport', url: 'https://gateway.9arm.co/v1' },
]
```

Shared so both the main store (default baseUrl) and the renderer dropdown use the same list.

## 3. Config store — `src/main/ai/config.ts` (rewrite)

- New on-disk shape `{ version: 1, profiles: [...], activeProfileId, uploadPdfEnabled }`, still
  `userData/ai-provider.json`, `chmod 600`, plain-text keys.
- **Legacy migration:** on `load`, if the file is an old flat `AIProviderConfig` (has
  `baseUrl`/`apiKey`/`model` but no `profiles` array), wrap it into
  `profiles: [{ id: 'profile-1', name: 'Profile 1', ...legacy }]`, set
  `activeProfileId: 'profile-1'`, hoist the legacy `uploadPdfEnabled` into the global toggle, and
  rewrite once.
- API:
  - `load(): Promise<AIProviderConfig>` → active profile merged with the global `uploadPdfEnabled`.
    **Existing consumers unchanged.**
  - `getAll(): Promise<AIConfig>` → full set (profiles + global toggle) for the settings UI.
  - `saveAll(config): Promise<AIConfig>` → validates `activeProfileId`, writes file.

## 4. IPC — `src/main/ipc/ai.ts` + `src/preload/index.ts` + `index.d.ts`

- Keep `ai:getConfig` (returns active profile as `AIProviderConfig`).
- Add `ai:getProfiles` → `AIConfig` and `ai:saveProfiles(config)` → `AIConfig`; register in
  `registerAiIpc`.
- Preload: add `getProfiles` / `saveProfiles`; `ai:listModels` unchanged.

## 5. Settings UI — `src/renderer/src/components/SettingsDialog.tsx`

- Parent state changes from a single `AIProviderConfig` to `AIConfig`; load via `ai:getProfiles`,
  save via `ai:saveProfiles`.
- Rewrite `AiSettingsPane`:
  - **Profile selector** (list/dropdown) showing all profiles with an explicit **active**
    selector — separate from the edited profile (editing a profile does not change which is
    active).
  - **"＋ New profile"** → auto id `profile-N`, editable name, empty fields, not active.
  - **Base URL** field = editable input + preset dropdown from `AI_ENDPOINTS` (selecting fills the
    URL; free text allowed).
  - API key (password), Model combobox (`ai:listModels` uses the edited profile's baseUrl/apiKey) —
    scoped to the currently edited profile.
  - **PDF upload toggle** is global — rendered once, outside the per-profile fields, applying to
    `AIConfig.uploadPdfEnabled`.
  - **Save** persists the whole `AIConfig`.

## 6. ChatDrawer

Unchanged — `ai:getConfig` now returns the active profile's config, so `aiReady` / the
"AI not configured" banner correctly reflects the active profile.

## 7. Docs

- Update `docs/ARCHITECTURE.md` (AI Settings section + on-disk layout line 110) and `AGENTS.md`
  security invariant to describe the profile set (keys still plain text, chmod 600 — the existing
  invariant stands unchanged).

## 8. Verification

- `npm run typecheck`, `npm run lint`, `npm run test`.
- Add a config-store test: legacy flat config → migrates to "Profile 1" active with the global
  `uploadPdfEnabled` hoisted; `getAll`/`saveAll` round-trip with multiple profiles; active profile
  resolution.
- Manual: Settings → AI migration, profile create/switch/active, base URL dropdown, key stored
  plain with chmod 600, chat uses the active profile.

## Files touched

- `src/shared/types.ts` — types
- `src/shared/aiEndpoints.ts` — new endpoint constants
- `src/main/ai/config.ts` — rewrite (profiles + legacy migration)
- `src/main/ipc/ai.ts` — new IPC (getProfiles/saveProfiles)
- `src/preload/index.ts` + `index.d.ts` — preload methods
- `src/renderer/src/components/SettingsDialog.tsx` — profile UI + base URL dropdown
- `docs/ARCHITECTURE.md` — AI Settings + on-disk layout
- `AGENTS.md` — security invariant note