# AI-Writer Assistant (Obsidian plugin)

Chat with Claude or ChatGPT about your notes, limited to the current **file**, **folder**, or **whole vault**.

## Requirements and costs
You need your own Anthropic or OpenAI account and API key. Requests use the selected provider's API and may incur charges under that provider's pricing.

## Privacy and data
- Your API keys are stored in the plugin's `data.json` inside your vault. Don't sync that file publicly.
- When you send a message, your chat messages and the note context in the selected scope (file, folder or vault) are sent to Anthropic or OpenAI using your API key. Refreshing the model list also contacts that provider. There is no telemetry.
- Folder and vault context require enumerating Markdown note paths in your vault. File scope starts with the active note. With note tools enabled, the assistant can request additional notes by vault-relative path; write approval does not restrict those reads. Turn off **Let the AI modify notes** to disable note tools.
- History search sends a digest of up to 200 saved conversations (up to 2,500 characters per conversation), plus your search query, to the selected provider. History is stored in `history.json` in the plugin folder, which can be included in vault backups or sync.
- The assistant can create and edit notes. By default every change needs your approval; this can be changed in settings.

## Install
1. In Obsidian, open **Settings → Community plugins → Browse** and search for **AI-Writer Assistant**, or [open its community listing](https://community.obsidian.md/plugins/ai-writer-assistant).
2. Install and enable the plugin.
3. Add your Anthropic and/or OpenAI API key in the plugin settings.

For a manual installation, download `main.js`, `manifest.json`, and `styles.css` from a [GitHub release](https://github.com/gmaggess/ai-assitant-obsidian-plugin/releases) and copy them into `<vault>/.obsidian/plugins/ai-writer-assistant/`. Developers can run `npm ci && npm run verify` to build from source.

## Use
Click the chat icon in the left ribbon (or run "Open chat panel"). In the panel choose provider, model, effort and scope.
Use **Refresh list** in settings to load every model your key can access.

Settings support Obsidian 1.7.2 and later. On Obsidian 1.13.0 and later they are also indexed by the built-in settings search.

Keys are stored in the vault's plugin `data.json` — don't sync it publicly.

## Testing
Run the test suite without Obsidian (Vitest with a mocked Obsidian API):

- `npm test` — run all tests once
- `npm run test:watch` — re-run on every save
- `npm run lint` — type-aware TypeScript and Obsidian review checks, with zero warnings allowed
- `npm run verify` — lint + typecheck + production build + tests

Tests cover API payload building (both providers, effort modes, retries), context
building (scopes, truncation, active-file priority), history persistence and the
natural-language search digest/parsing.

## Search past conversations
Every chat is saved in the plugin folder (`history.json`). Click **Search history** in the chat panel
(or run "Search past conversations"), ask in plain language, and the selected model picks the relevant chats and
summarizes what they said. Click a result to resume that chat. Clear history in settings.
