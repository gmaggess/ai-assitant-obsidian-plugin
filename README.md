# AI-Writer Assistant (Obsidian plugin)

Chat with Claude or ChatGPT about your notes, limited to the current **file**, **folder**, or **whole vault**.

## Privacy and data
- Your API keys are stored in the plugin's `data.json` inside your vault. Don't sync that file publicly.
- When you send a message, the notes in the selected scope (file, folder or vault) are sent to the provider you chose (Anthropic or OpenAI). Nothing else leaves your vault, and there is no telemetry.
- The assistant can create and edit notes. By default every change needs your approval; this can be changed in settings.

## Install
1. `npm install && npm run build` (creates `main.js`)
2. Copy `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/ai-writer-assistant/`
3. Obsidian → Settings → Community plugins → enable **AI-Writer Assistant**
4. Add your Anthropic and/or OpenAI API key in the plugin settings.

## Use
Click the chat icon in the left ribbon (or run "Open chat panel"). In the panel choose provider, model, effort and scope.
Use **Refresh list** in settings to load every model your key can access.

Keys are stored in the vault's plugin `data.json` — don't sync it publicly.

## Testing
Run the test suite without Obsidian (Vitest with a mocked Obsidian API):

- `npm test` — run all tests once
- `npm run test:watch` — re-run on every save
- `npm run verify` — typecheck + production build + tests

Tests cover API payload building (both providers, effort modes, retries), context
building (scopes, truncation, active-file priority), history persistence and the
natural-language search digest/parsing.

## Search past conversations
Every chat is saved privately in the plugin folder (`history.json`). Click **Search history** in the chat panel
(or run "Search past conversations"), ask in plain language, and the selected model picks the relevant chats and
summarizes what they said. Click a result to resume that chat. Clear history in settings.
