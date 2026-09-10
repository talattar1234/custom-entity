# Architecture

Working reference for this codebase. `README.md` is the introduction and the
usage guide; this file is the map you need before changing anything.
`DECISIONS.md` records *why* the design is what it is.

---

## 1. The boundary

There are exactly two parties, and one dependency direction.

```
  ┌──────────────────────────────────────┐
  │  HOST  (src/host/)                   │
  │                                      │
  │  • owns the map and its objects      │
  │  • detects what the user pressed     │
  │  • owns entity schemas               │
  │  • owns entity appearance + actions  │
  │  • owns the drag payload state       │
  └───────────────┬──────────────────────┘
                  │  props only
                  ▼
  ┌──────────────────────────────────────┐
  │  MAGICCHAT  (src/magic-chat/)        │
  │                                      │
  │  • detects the drop                  │
  │  • shows the overlay                 │
  │  • holds composer + message state    │
  │  • calls host renderers by type      │
  └──────────────────────────────────────┘
```

**The dependency rule:** `src/magic-chat/` must never import from `src/host/`.
It is the extractable package. If you find yourself needing host knowledge
inside it, the design has gone wrong — pass a renderer or a callback instead.

**The opacity rule:** MagicChat reads `entity.type` and nothing else. It never
reads `entity.properties`. Not for labels, not for ids, not for keys. Anything
that needs the schema is delegated to the registry (`label`, `getId`) or to a
renderer.

Two consequences that look like quirks but are load-bearing:

- Composer React keys come from an `instanceId` MagicChat generates, not from
  `properties.id` — it cannot assume such a field exists.
- De-duplication is opt-in via `getId`, because only the host can say what makes
  two entities "the same".

---

## 2. Module map

| File | Role | Touch it when |
| --- | --- | --- |
| `magic-chat/useCustomEntityDropTarget.ts` | **The mechanism.** All pointer handling and the latch. Chat-agnostic. | Changing drag/drop behaviour. Read this first. |
| `magic-chat/types.ts` | Every public type. The contract. | Changing the API surface. |
| `magic-chat/MagicChat.tsx` | Composition root: wires hook → drop zone, owns messages/composer/attachments state, renders the overlay, exposes the ref handle. | Changing chat behaviour or the overlay. |
| `magic-chat/EntityRenderer.tsx` | Registry lookup for both surfaces + unknown-type fallback + `entityLabel`. | Changing how renderers are resolved. |
| `magic-chat/Composer.tsx` | Chip bar, textarea, Send. Presentational. | Changing the pre-send UI. |
| `magic-chat/MessageList.tsx` | Message bubbles + attachment rendering + autoscroll. Presentational. | Changing message display. |
| `magic-chat/index.ts` | Public barrel. Anything not exported here is internal. | Adding to the public API. |
| `host/HostApp.tsx` | Owns `dragCustomEntities`, builds the registry, wires `zoomTo`, layout. | Changing the host side of the contract. |
| `host/MapPanel.tsx` | Leaflet map, the two hit-test paths, drag initiation, `MapApi`. | Changing the map or how drags start. |
| `host/entityRenderers.tsx` | All six renderers (chip + card × 3 types). | Adding or restyling an entity type. |
| `host/entities.ts` | Host schemas and seed data. | Adding or changing entity shapes. |
| `host/DragGhost.tsx` | Cursor-following ghost. Positions itself via `style.transform`. | Changing drag feedback. |

CSS is split the same way: `magic-chat/magic-chat.css` (component) and
`host/host.css` (host shell, map, ghost, entity renderers).

---

## 3. The drag lifecycle

```
HOST                                    MAGICCHAT
────                                    ─────────
pointerdown on map container (capture)
  │
  ├─ findEntityAt(event)
  │    ├─ DOM path: target.closest('[data-entity-id]')
  │    └─ canvas path: point-in-polygon on container coords
  │
  ├─ preventDefault()   ← don't let a touch become a scroll
  ├─ stopPropagation()  ← don't let Leaflet start panning
  ├─ map.dragging.disable()
  │
  └─ setDragCustomEntities([entity])
                              │
                              └──────►  array non-empty → latch: idle → armed
                                          attach on document (capture):
                                            pointermove, pointerup,
                                            pointercancel, keydown
                                          attach on window: blur

                                        pointermove
                                          ├─ latch pointerId (first seen)
                                          ├─ mouse && buttons === 0 → cancel
                                          └─ elementFromPoint → contains?
                                               setState only on change

                                        pointerup
                                          └─ re-hit-test THIS event's coords
                                               ├─ inside  → attach + consumed
                                               └─ outside → cancelled

                                        pointercancel / blur / Escape
                                          └─ cancelled

                                        latch: armed → spent
                                        listeners detached
                              ┌──────────┘
                              ▼
onDragCustomEntitiesConsumed(entities)
       or
onCustomEntityDragCancelled(reason)
  │
  └─ setDragCustomEntities([])  → latch: spent → idle   (re-armable)
```

### The latch

```
idle  ──(entities appear)──►  armed  ──(release/cancel)──►  spent
  ▲                                                           │
  └──────────────── (host clears the array) ──────────────────┘
```

`spent` is the whole idempotency story. Once the pointer is released MagicChat
is inert regardless of what the prop still holds, so no session id or reference
tracking is needed. Verified with three synchronous `pointerup`s producing
exactly one attachment.

### Invariants

Break one of these and the drag breaks. They are asserted only by the code's
structure, so keep them in mind when editing:

1. `magic-chat/` never imports from `host/`.
2. MagicChat never reads `entity.properties`.
3. The overlay and the host's drag ghost are `pointer-events: none`.
4. Exactly one of `onDragCustomEntitiesConsumed` / `onCustomEntityDragCancelled`
   fires per armed gesture — never both, never neither.
5. The host clears `dragCustomEntities` before the next drag begins.
6. Document listeners exist only while the latch is `armed`.
7. The registry object identity is stable across renders (see §6, pitfall 2).

---

## 4. Public API

Everything below is exported from `src/magic-chat/index.ts`.

### `<MagicChat>` props

| Prop | Type | Notes |
| --- | --- | --- |
| `customEntityTypes` | `CustomEntityTypeRegistry` | Required. Keyed by `entity.type`. |
| `dragCustomEntities` | `CustomEntity[]` | Non-empty = drag in flight. |
| `onDragCustomEntitiesConsumed` | `(entities) => void` | Dropped on the chat. |
| `onCustomEntityDragCancelled` | `(reason) => void` | `'released-outside' \| 'cancelled'`. |
| `initialMessages` | `ChatMessage[]` | Seed only; messages are internal state. |
| `onSendMessage` | `(message) => void` | Notification, not control. |
| `renderUnknownEntity` | `ComponentType<UnknownEntityProps>` | Replaces the fallback chip. |
| `onDebugChange` | `(debug: CustomEntityDropDebug) => void` | Diagnostics. See §4.1. |

### Registry entry

```ts
interface CustomEntityTypeDefinition<E extends CustomEntity> {
  composer: ComponentType<CustomEntityComposerProps<E>>;  // { entity, instanceId, remove }
  message:  ComponentType<CustomEntityMessageProps<E>>;   // { entity, message }
  label?:   (entity: E) => string;   // overlay + ghost text; falls back to entity.type
  getId?:   (entity: E) => string;   // opt-in composer de-duplication
}
```

### `MagicChatHandle` (via `ref`)

`attachEntities(entities)` · `clearComposer()` · `focus()` — the non-drag path,
for a "Send to chat" button or keyboard accessibility.

### `useCustomEntityDropTarget`

```ts
const { dropZoneRef, isDragActive, isPointerOver } = useCustomEntityDropTarget({
  dragCustomEntities,
  onDrop,     // (entities) => void
  onCancel,   // (reason) => void
});
```

Knows nothing about chat. Use it to make any element a drop target for
host-driven pointer drags.

### 4.1 Debug instrumentation

`onDebugChange` reports a `CustomEntityDropDebug` snapshot of the drop target's
internals. `host/DebugBar.tsx` renders it as the dark bar under the toolbar —
every value there is read out of the mechanism, not re-derived by the host.

| Field | Meaning |
| --- | --- |
| `latch` | `idle` / `armed` / `spent`. |
| `listening` | Listeners currently attached — true only while armed. |
| `listeners[name]` | `{ attached, fired }` per listener, counts reset each arming. |
| `pointerId` / `pointerType` / `buttons` | The pointer the gesture is locked to. |
| `pointer` | Last hit-tested coordinates. |
| `hit` | `{ element, insideDropZone }` — the actual `elementFromPoint` result. |
| `isPointerOver` | The value driving the overlay. |
| `lastOutcome` | `dropped` / `released-outside` / `cancelled`. |
| `recentEvents` | Last 8 discrete events, newest first. Moves are counted, not logged. |

The bar also shows three host-side facts it owns itself: `dragCustomEntities`
length, whether the ghost is mounted, and whether Leaflet panning is suppressed
(`MapPanel`'s `onDragLockChange`).

Three things to know:

- **Emission is synchronous and unthrottled**, so attaching the callback costs
  one consumer render per `pointermove`. Accepted because it is opt-in: omit
  `onDebugChange` and none of it runs. An earlier rAF-coalesced version was
  removed — rAF is suspended in background tabs, so the panel froze silently.
- **Two `latch → idle` entries at startup are normal** — StrictMode invokes the
  effect twice on mount.
- It is genuinely useful for diagnosis: it caught a `window` `blur` cancelling a
  drag during screenshot capture, and `ignored other pointer` entries proving
  the pointer-id lock works.

### `entityLabel(registry, entity)`

The label resolution MagicChat uses internally, exported because hosts need the
same text for their drag ghost.

---

## 5. State ownership

Knowing who owns what prevents most bugs here.

| State | Owner | Why there |
| --- | --- | --- |
| `dragCustomEntities` | Host (`HostApp`) | The host detects the gesture; the array is the wire format. |
| Latch (`idle`/`armed`/`spent`) | Hook | Must survive a stale prop; MagicChat's own concern. |
| `isPointerOver` | Hook | Derived from hit-testing, not from props. |
| Pointer id, `over` mirror, `finished` | Hook effect locals | Per-gesture, must not trigger renders. |
| Composer attachments (`AttachedEntity[]`) | MagicChat | Post-drop; the host is done at that point. |
| Messages | MagicChat | Mock chat. Move to the host for a real backend (§6). |
| Map camera, flash | `MapPanel` (via `MapApi` ref) | Imperative Leaflet state. |

Note the ghost's *position* is owned by nobody in React — `DragGhost` writes
`style.transform` from its own listener so a drag does not re-render the host on
every frame.

---

## 6. Extension recipes

### Add an entity type

1. `host/entities.ts` — add a `FooProperties` interface, `FooEntity` alias, and
   a seed constant. Add it to `mapEntities` if it belongs on the map.
2. `host/entityRenderers.tsx` — add `FooChip` and `FooCard`. Copy `CarChip` /
   `CarCard`; they are deliberately parallel. Give the card its own actions.
3. `host/HostApp.tsx` — add a `Foo:` entry to the `customEntityTypes` memo.
4. `host/MapPanel.tsx` — only if it needs to be draggable from the map: add a
   marker (DOM path) or extend `findEntityAt` (canvas path).

Nothing in `src/magic-chat/` changes. If it does, something is wrong.

### Add a second drop target

Use the hook directly; do not extend MagicChat.

```tsx
const { dropZoneRef, isDragActive, isPointerOver } = useCustomEntityDropTarget({
  dragCustomEntities,
  onDrop: (entities) => addToReport(entities),
  onCancel: () => setDragCustomEntities([]),
});
```

Caveat: two active targets both watch the same array, and both will fire. Either
give each its own array, or have the first consumer clear it. If you need many
targets, this is the point where the module-level drag manager in
`DECISIONS.md` §7 becomes the better design.

### Drag several entities from the map (multi-select)

`dragCustomEntities` is already an array end to end — the toolbar's "Drag group"
source proves it. Add selection state to `MapPanel`, and on `pointerdown` over a
selected object pass the whole selection to `startDrag`.

### Host that uses `setPointerCapture`

Already supported, no changes needed — that is precisely why detection is
coordinate-based. If you add capture in `MapPanel`, release it on `pointerup`;
it does not interact with MagicChat at all.

### Real chat backend

Messages are internal state in `MagicChat.tsx`. Two options:

- **Small change:** keep it internal and treat `onSendMessage` as the write
  path, letting the server echo be ignored.
- **Proper change:** make messages controlled — add a `messages` prop, drop
  `initialMessages` and the internal `setMessages`, and let the host own the
  list. `MessageList` needs no change; it is already presentational.

Do not add fetching inside `magic-chat/`. That would break invariant 1.

### Extract as an npm package

`src/magic-chat/` is already self-contained. You would need to: add a
`package.json` with `react` as a peer dependency, decide whether
`magic-chat.css` ships as a file import or as CSS-in-JS, and re-export from
`index.ts` (already the single entry point). No source changes.

---

## 7. Pitfalls

These are the things that will actually bite. Each has a comment at the relevant
line in the code, but they are collected here because the failures are silent
and confusing.

1. **`pointer-events: none` on the overlay and the ghost.** Detection is
   `document.elementFromPoint`. Anything painted under the cursor without this
   becomes the answer to every hit test. The ghost is the sneaky one: it follows
   the cursor, so it would break detection *always*, not intermittently.

2. **Registry identity must be stable.** `customEntityTypes` is built with
   `useMemo` over a `useCallback`-stable `zoomTo`. An inline arrow recreated per
   render is a *new component type* each time, so React unmounts and remounts
   every renderer instead of updating it — you lose focus, animation and local
   state in the cards, and it looks like a rendering bug.

3. **The host must clear the array.** If it does not, the latch stays `spent`
   and the next drag silently does nothing. This is intentional (loud failure
   beats stale re-consumption), but it is the first thing to check when "drag
   stopped working after one use".

4. **`stopPropagation()` in the map's capture-phase handler is what stops
   Leaflet panning.** Remove it and the map pans while you drag. It works
   because a capture listener on the container runs before the target and bubble
   phases, so Leaflet's own bubble-phase handler on the same element is skipped.

5. **`touch-action: none`** on `.leaflet-container`, `.host-marker` and
   `.host-group-source`. Without it the browser claims a touch-drag as a scroll
   and fires `pointercancel` — the drag aborts mid-gesture, only on touch.

6. **Screenshot coordinates are not client coordinates.** When driving this with
   browser automation, the screenshot is scaled (1568px wide for a 1920px
   viewport here). Synthetic events dispatched at screenshot coordinates land in
   the wrong place. Measure with `getBoundingClientRect()` first.

7. **StrictMode double-mounts the map effect.** `MapPanel`'s cleanup calls
   `map.remove()`, which is what keeps Leaflet from throwing "Map container is
   already initialized". Keep that cleanup if you touch the effect.

---

## 8. Not implemented

Deliberate scope limits, in rough order of how likely you are to want them:

- **No chat backend.** Send appends to local state.
- **No auto-scroll while dragging.** Dropping onto a long message list does not
  scroll the list.
- **No keyboard-initiated drag.** The imperative `attachEntities` handle is the
  accessible path, but nothing in the demo wires it to a key.
- **No drop rejection by type.** MagicChat accepts every entity; there is no
  `canDrop` predicate. The registry lookup happens at render, so an
  unregistered type lands in the composer as a fallback chip rather than being
  refused at the drop.
- **No tests.** Verified manually and via browser automation; see §9.
- **No entity updates after send.** A sent message holds a snapshot of the JSON.
  Live-updating cards would need the host to look entities up by id at render.

---

## 9. Verification checklist

`npm run build` typechecks under `strict` and bundles. For behaviour, this is
the list that was actually exercised — re-run it after touching the mechanism:

| Check | Expected |
| --- | --- |
| Drag a marker onto the chat | `consumed 1 entity`, chip appears |
| Mid-drag, pointer over chat | overlay reads `Drop <label> here`, `mc-chat-drag-over` class |
| Mid-drag, pointer outside | overlay reads `Drop custom entity here`, no `-over` class |
| Release outside the chat | `released-outside`, nothing attached |
| Escape with pointer inside | `cancelled`, nothing attached |
| Three synchronous `pointerup`s | exactly **one** attachment |
| Toolbar "Drag group" | `consumed 2 entities`, two chips |
| Drag the amber Area | works, and `[data-entity-id="area-a"]` is `null` in the DOM |
| Send | card renders via the host's `message` renderer, composer clears |
| "Zoom to" in a sent card | map flies and the object flashes |
| Map panning during a drag | must not happen |
| Console | no errors or warnings |
