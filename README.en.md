<div align="center">

<img src="apps/desktop/src-tauri/icons/icon.png" width="104" alt="StoryForge" />

# StoryForge

**An AI writing IDE for long-form fiction**

Open your novel project locally and work with an agent that has read the whole book: review, revise, draft.<br />
Every change the AI proposes arrives as a word-level diff, and nothing touches your manuscript until you accept it.

[![Release](https://img.shields.io/github/v/release/XZZKANY/StoryForge?display_name=tag&sort=semver&color=4f46e5)](https://github.com/XZZKANY/StoryForge/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/XZZKANY/StoryForge/total?color=16a34a)](https://github.com/XZZKANY/StoryForge/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078d4)](#download)
[![License](https://img.shields.io/github/license/XZZKANY/StoryForge?color=0ea5e9)](LICENSE)
[![Stars](https://img.shields.io/github/stars/XZZKANY/StoryForge?style=flat&color=f59e0b)](https://github.com/XZZKANY/StoryForge/stargazers)

[**Download**](#download) · [**Quick start**](#quick-start) · [**Features**](#features) · [**FAQ**](#faq) · [**Contributing**](#contributing)

[简体中文](README.md) · **English**

</div>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/hero-dark.webp" />
  <img alt="The StoryForge writing desk: the project tree on the left, chapter 5 in the editor, and the agent's review of that chapter on the right" src="docs/assets/readme/hero-light.webp" />
</picture>

<p align="center"><sub>The interface is in Simplified Chinese. The sample novel and the AI replies in these screenshots are demo content.</sub></p>

## Why StoryForge

The hard part of a long novel is rarely writing one beautiful paragraph. It is remembering, eighty chapters in, what you planted in chapter three, who is where, and who is holding the key.

A general chat assistant cannot see your whole book, so you keep pasting the backstory again. One-click generation pushes the author out of the work. StoryForge takes a third path:

- **You are the author; the AI is your editor and assistant.** It reads, finds problems, suggests fixes and drafts, but you decide what goes into the text.
- **The whole book is context.** The agent browses folders, reads chapters and searches the manuscript on its own, and answers with your outline, characters and fact ledger in mind.
- **Every change is visible and reversible.** Edits arrive as patches: word-level diffs, a snapshot before writing, one-click undo after.

## Features

### A conversational agent that has read the whole book

<img src="docs/assets/readme/demo-chat.gif" alt="Asking the agent to review chapter 5: it reads the chapter first, then streams three issues and suggested fixes" width="760" />

- Ask in plain language: "Review the pacing of chapter 5", "Does chapter 12 contradict chapter 3?", "Draft chapter 7".
- The agent decides which files to read (list, read, search across the book) and shows every step in the conversation.
- Multi-perspective review, targeted revision, drafting new chapters, cross-chapter and deep consistency checks, all in one conversation.
- When drafting a new chapter it shows you a chapter brief first, then writes, self-checks, and hands the result over as a patch.

### Word-level diffs: nothing is written until you say so

<img src="docs/assets/readme/patch-review.webp" alt="An AI revision shown as a patch in the editor, with deletions in red and additions in green; each hunk can be accepted separately" />

- Every AI edit is a patch. Accept all of it, accept it hunk by hunk, reject it, or reject it and tell the AI what to do instead.
- A snapshot is taken before writing, and an undo button appears afterwards. If the manuscript changed while you were reviewing, the write is refused rather than overwriting your work.
- Permissions are set per project: **Read-only** (answers only), **Ask** (you accept every patch) or **Auto** (writes without a click, still snapshotted and undoable).

### Inline help: Ctrl+K to rewrite, Ctrl+Shift+K to continue

<img src="docs/assets/readme/demo-inline.gif" alt="Select a paragraph, press Ctrl+K, type an instruction, and the rewrite appears below the original; Alt+Enter accepts it" width="760" />

- Select a passage, press **Ctrl+K** and say "make it more restrained". The rewrite appears right below the original: **Alt+Enter** accepts, **Esc** discards.
- Press **Ctrl+Shift+K** at the cursor to continue the scene in the same voice, optionally with a direction such as "move to the conflict".

### The worldline observatory: keep the story straight

<img src="docs/assets/readme/observatory.webp" alt="The observatory panel: a fact ledger with one disputed fact (the crew count is eleven in chapter 2 but twelve in chapter 4), a list of open plot threads, and characters with their aliases" />

- **Fact ledger**: chapter checks record facts such as identities, who holds what and how many people were on the ship, each with its source. Contradictions are flagged for you to decide which chapter wins.
- **Plot threads**: what was planted, in which chapter, and how long it has gone untouched.
- **Characters and entities**: canonical names, aliases, and where they appear.
- All of this is computed deterministically by rules, with no model calls and no cost. Ask the AI to dig deeper when something looks off.

### Book overview: know what to write today

<img src="docs/assets/readme/overview.webp" alt="The book overview: cover, synopsis, where the last chapter stopped, open plot threads, progress, and buttons to continue chapter 6 or draft chapter 7" />

Cover, synopsis, progress, where the last chapter stopped and which threads are still open, all on one page. Continue the current chapter or have the AI draft the next one from here.

### Version history and undo

<img src="docs/assets/readme/versions.webp" alt="The version history panel: every AI write leaves a checkpoint that can be compared with the current text or restored" />

Every AI write leaves a checkpoint you can compare or restore. Snapshots live in a separate shadow repository and never touch your own git.

### And more

| Feature | What it does |
| --- | --- |
| Idea notes | Jot down an idea from the sidebar; it is saved to `灵感.md` in the project root |
| Serial plan | Chapter goals and progress live in `.storyforge/serial-plan.json` and inform drafting |
| Knowledge inbox | Setting entries proposed by the agent wait in an inbox until you approve them |
| Book breakdown | Break a reference novel down into a structure report, exported as Markdown or JSON |
| Custom agent | Describe tone, review standards and style taboos in `.storyforge/agent-instructions.md` |
| Editor | Command palette, full-text search, tabs, three layouts (Ctrl+1/2/3), light and dark themes |

## Download

| Platform | Installer | Notes |
| --- | --- | --- |
| Windows 10 / 11 (64-bit) | [**Latest release**](https://github.com/XZZKANY/StoryForge/releases/latest) | NSIS installer, about 33 MB |

- Requires Microsoft Edge WebView2, which ships with Windows 11 and is usually present on Windows 10.
- The installer is not code-signed yet. If Windows SmartScreen appears, click "More info" and then "Run anyway".
- Only Windows is supported for now.

## Quick start

1. **Install and open** StoryForge.
2. **Set up a model**: in Settings → Model service, pick a provider, paste your API key and save. The key is encrypted on your machine.
3. **Open a project**: open a local folder from the library, or click "Create sample project" to try it out.
4. **Start working**: describe what you need in the chat on the right, or select a passage in the editor and press **Ctrl+K**.
5. **Review the patch**: accept it if you like it; otherwise reject it and say what is wrong.

New projects get a recommended folder layout of plain Markdown files: `正文/` (chapters), `大纲/` (outline), `人物/` (characters), `设定/` (settings), `世界观/`, `时间线/`, `伏笔/`, plus `灵感.md` for notes and `.storyforge/`, which StoryForge maintains.

## Supported models

Bring your own key. Requests go straight to your provider at their prices; StoryForge never proxies them.

OpenAI · Anthropic (Claude) · Google Gemini · DeepSeek · Qwen · Kimi · SiliconFlow · Ollama (local models) · any OpenAI-compatible API

You can also configure a separate model for polishing.

## Privacy and security

- **Local only**: no server, no account, no telemetry. StoryForge makes no network requests except to the model service you configure.
- **Your manuscript stays yours**: it is plain Markdown in your own folder. Content is sent to your chosen model only when you make a request, and only what that request needs.
- **Keys stay in the host**: API keys are encrypted with Windows DPAPI and decrypted only inside the Rust host process. The UI, logs and database only ever see placeholders.
- **The AI only proposes**: at every permission level the AI produces patches; writes always go through snapshot, atomic write and version record.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Inline rewrite (the selection, or the current line) |
| `Ctrl+Shift+K` | Continue writing at the cursor |
| `Alt+Enter` / `Esc` | Accept / discard an inline suggestion |
| `Ctrl+P` | Quick open |
| `Ctrl+Shift+F` | Full-text search |
| `Ctrl+Shift+O` | Worldline observatory |
| `Ctrl+Shift+H` | Version history |
| `Ctrl+1` / `2` / `3` | Editor / balanced / chat layout |

## Architecture

```mermaid
flowchart LR
  subgraph App["StoryForge desktop app"]
    direction LR
    UI["UI<br/>React + Monaco"] --> Engine["TS engine<br/>agent loop · revise / continue · checks · consistency"]
    Engine <--> Host["Rust host<br/>file I/O · SQLite · shadow git · model calls"]
  end
  Host <--> Book[("Your project folder<br/>Markdown")]
  Host <--> LLM(("Your model provider"))
```

- **TS engine** (`packages/engine`): the agent tool loop, revision and continuation, chapter checks, the fact ledger, cross-chapter consistency and model protocols, running in-process inside the app window.
- **Rust host** (`apps/desktop/src-tauri`): only local side effects: file I/O within the project boundary with atomic writes, the engine database (SQLite), model requests (the only place keys exist), and shadow-git snapshots.
- **UI** (`apps/desktop/frontend`): Tauri 2, React 18, Vite and Monaco Editor.

## Project status

StoryForge is in an **author-dogfooding stage** and is not yet a mature commercial product:

- Since 0.2 all business logic runs in the TS engine; the installer contains no background service and is about 33 MB.
- Small real-model runs of 1, 3 and 10 chapters have succeeded, and the 10-chapter sample was read through by a human. Longer serial quality has not been validated, so **reliable long-form output is not claimed**.
- Current verification records and capability boundaries are in [`docs/internal/current-phase.md`](docs/internal/current-phase.md) (Chinese).

## Roadmap

- [x] A safe daily-writing editor: patch review, pre-write snapshots, undo
- [x] Move the backend into the TS engine and shrink the installer from 81 MB to 33 MB (0.2.0)
- [x] Fact ledger, plot-thread ledger and the worldline observatory
- [ ] Polish it through real serial writing (in progress)
- [ ] Publishing and reader feedback: turn reader signals into writing preferences for the agent

## FAQ

<details>
<summary><b>Will it write the whole book for me?</b></summary>

No, and that is not the goal. StoryForge is a tool for authors: it can draft a chapter, but every write goes through you.
</details>

<details>
<summary><b>Is my manuscript uploaded anywhere?</b></summary>

There is no StoryForge server to upload to. Only when you make a request are the chapters and notes that request needs sent to the model service you configured.
</details>

<details>
<summary><b>How much does it cost?</b></summary>

The software is free and open source (MIT). Model usage is billed by your provider; local models via Ollama have no API cost.
</details>

<details>
<summary><b>Does it run on macOS or Linux?</b></summary>

Not yet. Key storage uses Windows DPAPI, and other platforms have not been adapted or tested.
</details>

<details>
<summary><b>I already keep my manuscript in git. Will it conflict?</b></summary>

No. StoryForge keeps its snapshots in a separate shadow repository and never changes your own repository or index.
</details>

## Contributing

You need Node.js 22, pnpm 9.15.4, a Rust toolchain and the Tauri 2 build prerequisites for Windows.

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
npm --prefix apps/desktop/frontend install
pnpm dev               # run the desktop app (Vite + Tauri window)
```

```powershell
pnpm verify            # pre-commit gate: lint, type checks, engine and UI tests, three browser regressions
pnpm test              # plus Rust tests and the Tauri smoke test
pnpm desktop:build     # build the NSIS installer
```

If PowerShell blocks `pnpm.ps1`, use `pnpm.cmd`. See [local development](docs/operations/local-start.md), [troubleshooting](docs/operations/troubleshooting.md) and the [release checklist](docs/operations/release-checklist.md) (in Chinese).

Issues and pull requests are welcome. Run `pnpm verify` before submitting, and never commit real API keys or unredacted run logs. Engineering conventions are in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Star history

<a href="https://star-history.com/#XZZKANY/StoryForge&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=XZZKANY/StoryForge&type=Date&theme=dark" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=XZZKANY/StoryForge&type=Date" width="600" />
  </picture>
</a>

## License

[MIT](LICENSE) © XZZKANY
