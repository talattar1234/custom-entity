# CLAUDE.md

MagicChat — a POC for dragging host-application objects (Leaflet map markers, a
canvas-drawn polygon) into a chat component, attaching them to a message, and
letting the host render them. `src/magic-chat/` is the reusable part; `src/host/`
is the demo application. The component imports nothing from the host.

## Read these before changing anything

Don't re-derive the design from the code — it is documented, and several obvious
simplifications have specific, known failure modes.

| Document | Read it when |
| --- | --- |
| [`DOCS.md`](./DOCS.md) | You don't know which of these to open — it is the one-line index of every document here. |
| [`ARCHITECTURE-for-dummies.md`](./ARCHITECTURE-for-dummies.md) | You want the plain-English version first: what this is, the one core idea, a runnable minimal example, and the four things that bite. |
| [`README.md`](./README.md) | Orienting: what the component does, the entity model, the drag/drop mechanism end to end, the edge-case table. Start here. |
| [`USAGE.md`](./USAGE.md) | Wiring MagicChat into a host — a complete minimal example plus the three things that will bite you. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Before editing the code: module map (§2, says which file to touch for which change), drag lifecycle (§3), public API (§4), state ownership (§5), extension recipes (§6), pitfalls (§7), verification checklist (§9). |
| [`DECISIONS.md`](./DECISIONS.md) | Before changing the *mechanism*: 15 numbered decisions with what was rejected and why. Check here before "simplifying" anything in `useCustomEntityDropTarget.ts` — §15 covers the drag API itself. |
| [`IMPLEMENTATION-SPEC.md`](./IMPLEMENTATION-SPEC.md) | You are adding this drag & drop to a *different*, already-existing chat component: a standalone blueprint of the mechanism, the ref API, the integration points, the invariants and the CSS. Needs no source reading. |

Keep those files current when behaviour changes — they are the spec, not notes.

## Commands

```
npm run dev              # Vite dev server on http://localhost:5173
npm run build            # tsc --noEmit (strict) + vite build — the typecheck gate
npm test                 # vitest run: Storybook stories as browser tests (Playwright/chromium)
npm run storybook        # Storybook on :6006
npm run build-storybook
```

There are no unit tests outside the stories. `src/magic-chat/MagicChat.stories.tsx`
plays the host role and is the executable spec; `ARCHITECTURE.md` §9 is the manual
checklist for anything the stories don't cover (real pointer drags, map panning).

## Hard rules

These are the failures that are silent and confusing. Full list in `ARCHITECTURE.md` §7.

- **Never give the overlay or a drag ghost pointer events.** Detection is
  `document.elementFromPoint`; anything painted under the cursor becomes the
  answer to every hit test. Both are commented as such in the CSS.
- **The registry (`customEntityComponents`) must be referentially stable** — `useMemo`
  over `useCallback`-stable callbacks. An inline arrow is a new component type
  every render, so React remounts every renderer.
- **A drag is announced by a call, not a prop.**
  `chatRef.current.startCustomEntityDrag(entities)`, and only while a button is
  physically held — the call refuses otherwise and returns `false`. There is no
  `dragCustomEntities` prop and nothing for the host to clear: the gesture
  disarms itself on release. See `DECISIONS.md` §15, which also lists the five
  failure modes this replaced. Both resolve callbacks are informational; a host
  that ignores them still drags correctly.
- **An empty payload is refused before the already-armed branch** in
  `startCustomEntityDrag`. The other order lets `start([])` empty a live
  gesture while the latch stays armed, which breaks
  "`isDragActive` ⟺ armed" (`ARCHITECTURE.md` §3, invariant 7).
- **MagicChat treats `entity.properties` as opaque.** It reads `entity.type` to
  look up renderers and nothing else. Don't add schema knowledge to
  `src/magic-chat/`, and don't import from `src/host/` there.
- **`src/magic-chat/index.ts` is the public API.** Anything not exported there is
  internal; adding to it is an API decision.

## Conventions

- TypeScript `strict`, `noUnusedLocals`, `noUnusedParameters`. React 18, function
  components, no class components.
- Plain CSS, split by boundary: `magic-chat/magic-chat.css` vs `host/host.css`.
  No CSS framework.
- Vanilla Leaflet (not react-leaflet) — see `DECISIONS.md` §10.
- Comments explain *why*, at the line where the non-obvious thing happens. The
  existing code is densely commented in this style; match it.
