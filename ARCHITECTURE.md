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
  │  • owns its own drag ghost           │
  └───────────────┬──────────────────────┘
                  │  props, plus one call:
                  │  startCustomEntityDrag(entities)
                  ▼
  ┌──────────────────────────────────────┐
  │  MAGICCHAT  (src/magic-chat/)        │
  │                                      │
  │  • owns the drag payload             │
  │  • detects the drop                  │
  │  • shows the overlay                 │
  │  • holds composer + message state    │
  │  • calls host renderers by type      │
  └──────────────────────────────────────┘
```

The one upward edge is that call, made through the `MagicChatHandle` ref while
the pointer is still held. It carries JSON in and a boolean back ("did it arm?")
and nothing else — see `DECISIONS.md` §15 for why a call rather than a prop.

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
| `magic-chat/useCustomEntityDropTarget.ts` | **The mechanism.** All pointer handling, the held-pointer tracker, the drag payload and the latch. Chat-agnostic. | Changing drag/drop behaviour. Read this first. |
| `magic-chat/types.ts` | Every public type. The contract. | Changing the API surface. |
| `magic-chat/MagicChat.tsx` | Composition root: wires hook → drop zone, owns messages/composer/attachments state, renders the overlay, exposes the ref handle. | Changing chat behaviour or the overlay. |
| `magic-chat/EntityRenderer.tsx` | Registry lookup for both surfaces + unknown-type fallback + `entityLabel` + the composer chip shell and its ×. | Changing how renderers are resolved, or the chip chrome. |
| `magic-chat/Composer.tsx` | Chip bar, textarea, Send. Presentational. | Changing the pre-send UI. |
| `magic-chat/MessageList.tsx` | Message bubbles + attachment rendering + autoscroll. Presentational. | Changing message display. |
| `magic-chat/index.ts` | Public barrel. Anything not exported here is internal. | Adding to the public API. |
| `host/HostApp.tsx` | Calls `startCustomEntityDrag`, owns the drag ghost's state, builds the registry, wires `zoomTo`, layout. | Changing the host side of the contract. |
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
  └─ chatRef.current.startCustomEntityDrag([entity])
                              │
                              └──────►  is a button held? (the always-on tracker)
                                          no  → refuse: return false,
                                                refusedStarts++, change nothing
                                          yes → latch: idle → armed, and
                                                SYNCHRONOUSLY, inside the call:
                                          attach on document (capture):
                                            pointermove, pointerup,
                                            pointercancel, keydown
                                          attach on window: blur
                                          lock to the tracker's pointerId
                              ◄──────┘  returns true
  │
  └─ show the drag ghost

                                        pointermove
                                          ├─ other pointerId → ignore
                                          ├─ mouse && buttons === 0 → cancel
                                          └─ elementFromPoint → contains?
                                               setState only on change

                                        pointerup
                                          └─ re-hit-test THIS event's coords
                                               ├─ inside  → attach + consumed
                                               └─ outside → cancelled

                                        pointercancel / blur / Escape
                                          └─ cancelled

                                        latch: armed → idle
                                        listeners detached
                                        payload cleared
                              ┌──────────┘
                              ▼
onDragCustomEntitiesConsumed(entities)
       or
onCustomEntityDragCancelled(reason)
  │
  └─ hide the drag ghost      ← host chrome only; the chat already reset itself
```

Note the shape of it: the chat is fully back at rest *before* either callback
runs, so the host has nothing to reset on its side of the mechanism and a host
that ignores both callbacks still works — only its ghost misbehaves.

### The latch

```
idle  ──(startCustomEntityDrag, button held)──►  armed
  ▲                                                │
  └──────────────── (release / cancel) ────────────┘
```

Two states, self-clearing. Idempotency comes from the arming signal being a call
that cannot be left set, plus a per-gesture `finished` flag that absorbs a
`pointerup` immediately followed by a `blur`. Verified with three synchronous
`pointerup`s producing exactly one attachment.

There used to be a third state, `spent`, and the host had to clear a prop to
leave it — see `DECISIONS.md` §5 and §15 for why that is gone.

### Invariants

Break one of these and the drag breaks. They are asserted only by the code's
structure, so keep them in mind when editing:

1. `magic-chat/` never imports from `host/`.
2. MagicChat never reads `entity.properties`.
3. The overlay and the host's drag ghost are `pointer-events: none`.
4. Exactly one of `onDragCustomEntitiesConsumed` / `onCustomEntityDragCancelled`
   fires per armed gesture — never both, never neither. (A host-initiated
   `cancelCustomEntityDrag()` is the one silent exit, and it is silent because
   the host asked for it.)
5. `startCustomEntityDrag` is only ever called inside a held gesture. Not an
   obligation so much as a fact the mechanism enforces: it refuses otherwise.
6. The five gesture listeners exist only while the latch is `armed`. The
   held-pointer tracker's four are always attached.
7. `isDragActive` is true for exactly as long as the latch is `armed`.

On 7: the payload lives in the hook now, so **overlay visibility and the latch
are the same fact** and cannot disagree — which is what makes a stranded overlay
impossible (`DECISIONS.md` §14). It is also why an empty payload is refused
before the already-armed branch in `startCustomEntityDrag`: `start([])` on a
live gesture would otherwise break this invariant directly. The named
"Release to attach `<label>`" tier is driven by `isPointerOver`, a strictly
narrower signal, so the specific promise is never made when a drop would not land.
8. The registry object identity is stable across renders (see §6, pitfall 2).

---

## 4. Public API

Everything below is exported from `src/magic-chat/index.ts`.

### `<MagicChat>` props

| Prop | Type | Notes |
| --- | --- | --- |
| `customEntityComponents` | `CustomEntityComponentRegistry` | Required. One `{ composer, message }` pair per entity type, keyed by `entity.type`. |
| `onDragCustomEntitiesConsumed` | `(entities) => void` | Dropped on the chat. Informational. |
| `onCustomEntityDragCancelled` | `(reason) => void` | `'released-outside' \| 'cancelled'`. Informational. |
| `initialMessages` | `ChatMessage[]` | Seed only; messages are internal state. |
| `onSendMessage` | `(message) => void` | Notification, not control. |
| `renderUnknownEntity` | `ComponentType<UnknownEntityProps>` | Replaces the fallback chip's contents. On the composer surface it too is wrapped in MagicChat's chip shell, so an unregistered type is still removable. |
| `onDebugChange` | `(debug: CustomEntityDropDebug) => void` | Diagnostics. See §4.1. |

### Registry entry

```ts
interface CustomEntityComponentDefinition<E extends CustomEntity> {
  composer: ComponentType<CustomEntityComposerProps<E>>;  // { entity, instanceId, remove }
                                                         // renders the chip's CONTENTS only;
                                                         // MagicChat owns the shell and the ×
  message:  ComponentType<CustomEntityMessageProps<E>>;   // { entity, message }
  label?:   (entity: E) => string;   // overlay + ghost text; falls back to entity.type
  getId?:   (entity: E) => string;   // opt-in composer de-duplication
}
```

### `MagicChatHandle` (via `ref`)

```ts
startCustomEntityDrag(entities: CustomEntity[]): boolean   // announce a drag
cancelCustomEntityDrag(): void                             // abandon one, silently
attachEntities(entities: CustomEntity[]): void             // the non-drag path
clearComposer(): void
focus(): void
```

`startCustomEntityDrag` **is** the drag contract; there is no prop. It must be
called while a button is physically held — from `pointerdown`, or later inside
the same held gesture, so a long-press or a drag-threshold delay is fine. With no
button down it refuses: returns `false`, changes nothing, ticks `refusedStarts`.
Called again while armed it replaces the payload without re-arming, letting a
selection grow mid-drag. An empty array is always refused.

`cancelCustomEntityDrag` abandons an armed gesture with *neither* resolve
callback firing, on the grounds that the host asked for it. Kept as an escape
hatch; you will almost certainly not need it, because every ordinary reason to
abort is already handled by the mechanism (`DECISIONS.md` §15 has the table).

`attachEntities` is the non-drag path, for a "Send to chat" button or keyboard
accessibility.

### `useCustomEntityDropTarget`

```ts
const {
  dropZoneRef,
  startCustomEntityDrag,   // (entities) => boolean
  cancelCustomEntityDrag,  // () => void
  dragCustomEntities,      // the armed payload, or []
  isDragActive,
  isPointerOver,
} = useCustomEntityDropTarget({
  onDrop,     // (entities) => void
  onCancel,   // (reason) => void
  onDebug,    // (debug) => void
});
```

Knows nothing about chat. Use it to make any element a drop target for
host-driven pointer drags. `MagicChat` is a thin wrapper over it: it forwards
`startCustomEntityDrag` onto its ref handle and renders `dragCustomEntities` as
overlay labels.

The two flags differ in how narrow they are, which matters when you style a
target:

- `isDragActive` is `dragCustomEntities.length > 0`, which is now the same fact
  as "the latch is armed" — the hook owns the payload, so the two cannot
  disagree. Use it for "a drag is in flight" affordances.
- `isPointerOver` is strictly narrower: armed *and* hit-testing inside the zone.
  Use it for anything that promises the drop will actually land.

### 4.1 Debug instrumentation

`onDebugChange` reports a `CustomEntityDropDebug` snapshot of the drop target's
internals. `host/DebugBar.tsx` renders it as the dark bar under the toolbar —
every value there is read out of the mechanism, not re-derived by the host.

| Field | Meaning |
| --- | --- |
| `latch` | `idle` / `armed`. |
| `listening` | Gesture listeners currently attached — true only while armed. |
| `listeners[name]` | `{ attached, fired }` per listener, counts reset each arming. |
| `entityCount` | Size of the armed payload. |
| `pointerDown` | What the always-on tracker sees held, or `null`. This is the state `startCustomEntityDrag` consults, so it answers "why was my drag refused?". |
| `refusedStarts` | Cumulative refused `startCustomEntityDrag` calls. Non-zero means a host is announcing drags outside a real press. |
| `pointerId` / `pointerType` / `buttons` | The pointer the gesture is locked to. |
| `pointer` | Last hit-tested coordinates. |
| `hit` | `{ element, insideDropZone }` — the actual `elementFromPoint` result. |
| `isPointerOver` | The value driving the overlay. |
| `lastOutcome` | `dropped` / `released-outside` / `cancelled`. |
| `recentEvents` | Last 8 discrete events, newest first. Moves are counted, not logged. |

The bar also shows two host-side facts it owns itself: whether the ghost is
mounted, and whether Leaflet panning is suppressed (`MapPanel`'s
`onDragLockChange`). The payload count moved to the MagicChat side, because the
mechanism owns it now.

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
| Drag payload (`dragCustomEntities`) | **Hook** | Moved here from the host. The host announces it in a call and never holds it, which is what removes the clearing contract. |
| Latch (`idle`/`armed`) | Hook | Set synchronously by `startCustomEntityDrag`; cleared by the gesture resolving. |
| Held pointer (the tracker) | Hook | Always-on, so `startCustomEntityDrag` can refuse a call made outside a press. |
| `isPointerOver` | Hook | Derived from hit-testing. |
| Pointer id, `over` mirror, `finished` | Hook `gestureRef` | Per-gesture, must be readable synchronously from a listener, must not trigger renders. |
| Drag ghost labels + origin | Host (`HostApp`) | Host chrome. MagicChat has never known the ghost exists. |
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
3. `host/HostApp.tsx` — add a `Foo:` entry to the `customEntityComponents` memo.
4. `host/MapPanel.tsx` — only if it needs to be draggable from the map: add a
   marker (DOM path) or extend `findEntityAt` (canvas path).

Nothing in `src/magic-chat/` changes. If it does, something is wrong.

### Add a second drop target

Use the hook directly; do not extend MagicChat.

```tsx
const { dropZoneRef, startCustomEntityDrag, isDragActive, isPointerOver } =
  useCustomEntityDropTarget({
    onDrop: (entities) => addToReport(entities),
  });
```

This got *better* with `DECISIONS.md` §15, and it is the recipe most changed by
it. A call has an addressee, so the host arms the targets it means:

```tsx
onPointerDown={(event) => {
  event.preventDefault();
  chatRef.current?.startCustomEntityDrag([entity]);   // just the chat
  reportRef.current?.startCustomEntityDrag([entity]); // ...or both, explicitly
}}
```

The old caveat — every target watching one shared array, all of them firing, and
a fight over who clears it — is gone. Arm one target and only that one responds;
arm several and each resolves independently, each with its own latch. The
module-level drag manager §7 once pointed at for this case is no longer the
better design.

### Drag several entities from the map (multi-select)

The payload is an array end to end — the toolbar's "Drag group" source proves
it. Add selection state to `MapPanel`, and on `pointerdown` over a selected
object pass the whole selection to `startDrag`.

You can also grow the payload *during* the gesture: calling
`startCustomEntityDrag` again while armed replaces it without re-arming or
disturbing the pointer lock, so a shift-click that extends a selection mid-drag
works with no extra machinery. An empty selection is refused rather than
emptying a live drag — see invariant 7.

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

2. **Registry identity must be stable.** `customEntityComponents` is built with
   `useMemo` over a `useCallback`-stable `zoomTo`. An inline arrow recreated per
   render is a *new component type* each time, so React unmounts and remounts
   every renderer instead of updating it — you lose focus, animation and local
   state in the cards, and it looks like a rendering bug.

3. **`startCustomEntityDrag` must be called inside a held gesture.** Call it
   from a click, an effect, a `setTimeout` after the release, or a Storybook
   arg, and it refuses — returns `false`, arms nothing. That is the designed
   behaviour, not a bug (`DECISIONS.md` §15); the diagnosis is `refusedStarts`
   climbing in the debug bar while `pointerDown` reads `null`.

   The symptom is "nothing happens when I drag". Check the return value: the
   demo's `startDrag` in `HostApp.tsx` bails on `false` and reports it, which
   is the pattern to copy.

   Note what is *no longer* a pitfall: there is nothing to clear, so a host that
   ignores both resolve callbacks still drags correctly, for ever. The only
   casualty is the host's own drag ghost, which stays on screen — bad, but local
   to the host and impossible to mistake for the chat being broken.

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

7. **A `composer` renderer must not draw its own ×.** MagicChat wraps it in a
   chip shell that already carries one (`DECISIONS.md` §16), so a host-drawn
   remove button is the second in the same chip — visually wrong rather than
   broken, but the `remove` prop is an escape hatch for extra chrome, not the
   affordance you are expected to build.

8. **StrictMode double-mounts the map effect.** `MapPanel`'s cleanup calls
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
| The × on a chip | detaches it, for every type — including one with no renderer |
| Press a marker, before moving | overlay already painted — the call arms synchronously |
| Mid-drag, pointer over chat | overlay reads `Release to attach <label>`, `mc-chat-drag-over` class |
| Mid-drag, pointer outside | overlay reads `Drop custom entity here`, no `-over` class |
| Two drags in a row, host doing nothing between them | both work — the chat disarms itself |
| `startCustomEntityDrag` from a click or the console | returns `false`, `refusedStarts` ticks, no overlay |
| `cancelCustomEntityDrag()` mid-drag | overlay clears, latch `idle`, **neither** callback fires |
| Release outside the chat | `released-outside`, nothing attached |
| Escape with pointer inside | `cancelled`, nothing attached |
| Three synchronous `pointerup`s | exactly **one** attachment |
| Toolbar "Drag group" | `consumed 2 entities`, two chips |
| Drag the amber Area | works, and `[data-entity-id="area-a"]` is `null` in the DOM |
| Send | card renders via the host's `message` renderer, composer clears |
| "Zoom to" in a sent card | map flies and the object flashes |
| Map panning during a drag | must not happen |
| Console | no errors or warnings |

The first four rows are now covered by the `DragGesture` story, which drives a
real held gesture with `PointerEvent`s and runs under `npm test`. The rest still
need a human — `elementFromPoint` against a live Leaflet map, and map panning,
have no meaningful synthetic equivalent.
