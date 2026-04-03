# gemini-plugin-cc

> Use Gemini where it shines — right from Claude Code.

A [Claude Code](https://claude.ai/code) plugin that delegates to [Gemini CLI](https://github.com/google-gemini/gemini-cli) for tasks where Gemini outperforms Claude: **visual analysis** and **design/styling**.

**Status:** WIP

---

## Why

Claude is exceptional at reasoning and code, but its vision is limited — it can confuse a kettle with a coffee maker. Gemini sees better. Gemini also has a stronger sense of aesthetics: colors, modern frontend, creative UI work.

This plugin gives you the best of both worlds without leaving Claude Code.

### Use cases

| | Claude Code | + Gemini |
|---|---|---|
| **Screenshots & mockups** | Struggles with visual details | Accurate visual analysis |
| **UI review** | Misses design inconsistencies | Catches color, spacing, layout issues |
| **Frontend styling** | Functional but plain | Modern, aesthetically-aware suggestions |
| **Design-to-code** | Gets the structure right | Gets the *feel* right |

## Commands

| Command | Description |
|---|---|
| `/gemini:review` | Code review through Gemini's eyes |
| `/gemini:adversarial-review` | Challenge design choices and assumptions |
| `/gemini:rescue` | Delegate visual/design tasks to Gemini |
| `/gemini:status` | Check background job status |
| `/gemini:result` | Get finished job output |
| `/gemini:cancel` | Cancel a running job |
| `/gemini:setup` | Verify Gemini CLI is installed and ready |

## Requirements

- [Claude Code](https://claude.ai/code)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`npm i -g @google/gemini-cli`)
- `GEMINI_API_KEY` env var or OAuth login (`gemini auth login`)

## Install

```bash
# From Claude Code
/plugin install gemini@markbrutx-gemini-plugin-cc

# Or point to local directory
claude --plugin-dir ./path/to/gemini-plugin-cc
```

## Inspired by

Built on the architecture of [**codex-plugin-cc**](https://github.com/openai/codex-plugin-cc) by OpenAI — adapted to use [**Gemini CLI**](https://github.com/google-gemini/gemini-cli) by Google as the backend.

The core insight: keep Claude Code as the orchestrator, but delegate to Gemini for what it does best.

## License

Apache-2.0
