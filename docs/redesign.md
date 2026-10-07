# UI / UX Redesign

This is a visual + experience redesign of the LifeOps web dashboard. The product
aim, data flow, MCP server, BFF orchestration and all 7 tools are **unchanged** —
only the presentation layer (`apps/web/src`) was reworked.

## What changed

- **New shell layout.** Moved from a single centered column to a persistent
  left sidebar (Today / Calendar / Tasks / Reminders / Insights) + sticky topbar
  with a greeting, live `Connected` status, and `Demo Mode` chip. This reads as a
  real “command center” rather than a form.
- **Dark, ambient visual system.** Deep indigo/violet gradient background, glass
  cards (`backdrop-filter`), a violet→blue brand gradient, teal accent for
  Bedrock/AI states. New design tokens live at the top of `index.css` as CSS
  variables, so re-theming is a one-stop edit.
- **Hero command box.** The natural-language prompt is now the visual focal point
  with gradient framing, example-prompt chips, a gradient Run button with a
  working spinner, and the `⌘/Ctrl+Enter` hint.
- **Richer plan timeline.** A proper vertical rail with color-coded Event / Task /
  Break blocks, per-block reason text, a Bedrock-vs-Deterministic badge, and a
  dedicated amber Notes panel for warnings.
- **Activity feed.** Animated, connected-rail list of the actual tool
  orchestration (`{tool, ok, ms, message}`) — still the real tool calls, not
  chain-of-thought.
- **At-a-glance rail.** Four stat tiles plus a day-completion progress bar.
- **Interactive tasks.** Checkbox-style completion with priority chips and a
  live done/total counter.
- **Micro-interactions.** Pulse on the connection dot, slide-in feed items,
  hover lifts, focus rings, and a toast on task completion (preview build).

## Files touched

| File | Change |
|---|---|
| `apps/web/src/App.tsx` | Full component rewrite against the same `api.ts` contract |
| `apps/web/src/index.css` | New token-driven stylesheet (fonts, layout, components) |
| `apps/web/tailwind.config.js` | Unchanged — Tailwind base kept; styling is now token-driven CSS |

The BFF (`apps/web/server/index.ts`), MCP server, and `api.ts` types are untouched,
so the redesigned SPA drops straight into the existing `npm run dev` workflow.

## Standalone preview

`lifeops-redesign-preview.html` is a single self-contained file (no build step)
that demonstrates the new look with mock data mirroring `seed.ts` and a
miniature of the deterministic planner. Open it in any browser to try
“Plan my afternoon”, “Summarize my day”, and the reminder flow.
