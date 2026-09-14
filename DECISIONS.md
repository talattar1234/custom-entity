# Design decisions

Why the design is what it is, including what was considered and rejected. Read
this before proposing a change to the mechanism — several of the obvious
simplifications were tried on paper and have specific failure modes.

`ARCHITECTURE.md` is the structural map. This file is the reasoning.

---

## 1. Not native HTML5 drag & drop

**Decision.** Pointer Events throughout. No `draggable`, no `dragstart`, no
`DataTransfer`.

**Why.** HTML5 DnD requires a real DOM element as the drag source. The premise
here is that the source may be a canvas or WebGL object with no DOM node — the
demo's Area is exactly that. You can hack around it by making the whole canvas
`draggable`, but then the drag image is wrong, every pixel of the canvas is a
drag handle, and you have no control over hit-testing. HTML5 DnD also does not
work on touch.

**Cost.** We implement the gesture ourselves, including the cancellation cases
the browser would otherwise handle.

---

## 2. Coordinate hit-testing, not `onPointerEnter` / `onPointerLeave`

**Decision.** On each `pointermove`, `document.elementFromPoint(x, y)` and test
`dropZone.contains(hit)`.

**Rejected: native enter/leave handlers on the chat element.** Simpler — about
two lines of JSX — and it genuinely does work for a mouse when the host takes no
pointer capture. There is no implicit pointer capture for mouse, so events
dispatch to whatever element is under the cursor.

It fails in two cases this component must support:

- **Touch and pen implicitly capture** the pointer to the element that received
  `pointerdown`. Every later move and up is delivered *there*, so the chat
  element never sees them. Touch support was a stated requirement, and this
  alone settles it.
- **`setPointerCapture`** does the same explicitly, and it is the normal way to
  drag a canvas object — you need it to keep receiving moves once the pointer
  leaves the canvas.

`elementFromPoint` is plain render-tree hit-testing and is unaffected by pointer
capture, which is exactly why it is the right tool.

**Rejected: `getBoundingClientRect()` point-in-rect.** Cheaper (no layout read
per move) but wrong: it reports "inside" even when a dialog, a toast, or the
drag ghost is painted on top of the chat. Kept in reserve as a fast-reject if
hit-testing ever shows up in a profile.

**Consequence.** The overlay and the host's drag ghost must be
`pointer-events: none`, or they become the answer to every hit test.

---

## 3. Document-level listeners, capture phase, only while armed

**Decision.** `pointermove` / `pointerup` / `pointercancel` / `keydown` on
`document` with `{ capture: true }`, plus `blur` on `window`. Attached only
while the latch is `armed`.

**Why document.** Element-level listeners cannot work for the reasons in §2, and
MagicChat needs to observe releases *outside* itself in order to reset its
overlay. The gesture also began somewhere else entirely.

**Why capture phase.** Nothing in the page can `stopPropagation` them away
before we see them.

**Why gated.** There are zero listeners at rest, which matters if this becomes a
package that ships in an app with many chats.

**Detail.** `pointerup` re-runs the hit test on its own coordinates rather than
trusting the last `pointermove`, so the drop decision can never be a frame
stale.

---

## 4. No `requestAnimationFrame` throttling

**Decision.** Hit-test on every `pointermove`; call `setState` only when the
answer changes.

**Rejected: coalescing moves into a rAF callback.** This was in the first draft
and was removed. `pointermove` is native and browsers already coalesce it to
roughly one per frame, so the rAF would only defer the `elementFromPoint` layout
read — buying speculative savings at the cost of a frame of latency and an extra
layer to read.

The cost that actually mattered was the React re-render per move, and comparing
against a local `over` mirror removes that without any throttling machinery.

---

## 5. The one-shot latch, instead of session ids

**Decision.** A three-state latch inside the hook:

```
idle ──(entities appear)──► armed ──(release/cancel)──► spent
  ▲                                                       │
  └──────────── (host clears the array) ──────────────────┘
```

One arming permits at most one drop. After a release MagicChat is inert
regardless of what the prop still holds.

**Problem being solved.** Double-consumption. React state updates are async, so
between MagicChat calling back and the host re-rendering with an empty array,
MagicChat still sees the old prop. A stale array plus a stray click on the chat
would re-attach the same entities.

**Rejected: a session object `{ id, entities, pointerId }` plus
`onDragSessionEnd({ consumed, reason })`.** This was the original proposal. It
works, but it adds an id the host has to generate and a wrapper object to the
API for something the component can solve internally.

**Rejected: comparing array object identity.** MagicChat remembers the array
reference it consumed and refuses it twice. No API change, but it needs an
"intervening empty" rule to handle a host that reuses one memoized array, and
the bookkeeping is harder to explain than the latch.

**Why the latch won.** It makes double-consumption *structurally* impossible
rather than defended against, needs nothing from the host, and is one enum.

**Accepted trade-off.** The host must clear the array before the next drag, or
the second drag silently does nothing. This is a deliberate choice of a loud,
easily-diagnosed failure ("my second drag stopped working") over a silent wrong
one (stale re-attachment). It is stated as a contract in the README.

---

## 6. A cancel callback, not just "consumed"

**Decision.** Two callbacks, exactly one of which fires per armed gesture:
`onDragCustomEntitiesConsumed` and `onCustomEntityDragCancelled(reason)`.

**Why.** With only a "consumed" event, a drag released outside the chat is never
reported, so the host never learns it should clear — and then, per §5, no future
drag can arm. The host cannot reliably substitute its own `pointerup` handler,
because `pointerup` may never arrive: `pointercancel` (common on touch when the
browser decides the gesture was a scroll), a release outside the browser window,
or an alt-tab. MagicChat is already listening for all of those, so it is the
right place to report them.

**Cancel sources:** `pointercancel`, `window` blur, `Escape`, and — for mouse
only — a `pointermove` with `buttons === 0`, which means the gesture ended
without us seeing the release.

---

## 7. Prop-driven, not a module-level drag manager

**Decision.** The host passes `dragCustomEntities` as a prop.

**Rejected: a singleton (`customEntityDrag.start(entities)`) imported by both
sides.** Genuinely attractive: no prop plumbing, no React render on drag start,
works across separate React roots, and scales to many drop targets without them
fighting over one array.

Rejected because shared mutable module state is harder to test and breaks if two
copies of the package end up bundled — a real hazard for a published component.
The prop flow is also more idiomatic and was what the API sketch asked for.

**Escape hatches if this becomes limiting.** The exported
`useCustomEntityDropTarget` hook and the imperative `attachEntities` handle
cover the common cases. If you reach several independent drop targets, revisit
this decision — see `ARCHITECTURE.md` §6.

---

## 8. Registry of components, keyed by `type`

**Decision.** `customEntityComponents: Record<string, { composer, message, label?, getId? }>`,
where `composer` and `message` are `ComponentType`s.

**Why components, not render functions returning JSX.** Both notations work —
`composer: ({ entity }) => <CarChip entity={entity} />` *is* a function
component — but typing them as `ComponentType` and rendering `<Composer …/>`
means hooks work inside renderers and React reconciles them properly instead of
treating each render as fresh output.

**Why `label` and `getId` are on the registry rather than inferred.** MagicChat
does not know the schema, so it cannot produce a display name or an identity.
Putting them on the type definition keeps the entity opaque while still letting
the overlay say "Drop Car 123 here" and letting the composer de-duplicate.
Both are optional; `label` falls back to `entity.type` and without `getId` there
is simply no de-duplication.

**Why the registry's generic is erased to `any`.** Definitions for different
entity types have to coexist in one object. Hosts keep their typing by writing
renderers as typed components (`CustomEntityComposerProps<CarEntity>`), which is
where the type safety actually matters. `never` would also type-check for
assignment but forces casts at every render site inside the component.

**Why `CustomEntity<P = object>` and not `Record<string, unknown>`.** A plain
interface like `CarProperties` has no index signature, so it is not assignable
to `Record<string, unknown>`. `object` accepts it and still excludes primitives.

---

## 9. MagicChat generates `instanceId`

**Decision.** On attach, MagicChat assigns its own `instanceId` and keys
composer chips on it.

**Why.** React needs stable keys, and the obvious source — `properties.id` —
would require knowing the schema. It is also legitimate to attach the same
entity twice when no `getId` is supplied, which a content-derived key could not
express.

---

## 10. Vanilla Leaflet, not react-leaflet

**Decision.** Leaflet built imperatively inside one `useEffect` in `MapPanel`.

**Why.** The stated goal was code another programmer understands immediately.
A reader sees `L.map(...)`, `L.marker(...).addTo(map)` — the actual Leaflet API,
with no wrapper's conventions to learn first. It also avoids react-leaflet's
peer-dependency churn. Leaflet over OpenLayers simply because it is the smaller,
simpler API for this.

**Cost.** Manual cleanup (`map.remove()`), which is also what makes StrictMode's
double-mount safe.

---

## 11. The Area is canvas-rendered on purpose

**Decision.** Car and Aircraft are `L.divIcon` markers (real DOM elements); the
Area is an `L.polygon` with `renderer: L.canvas()` and is hit-tested by the host
with point-in-polygon in container coordinates.

**Why.** The whole premise is that a drag source may have no DOM node. If every
demo entity were a marker, the architecture would only be *claimed* to support
canvas sources. Verified: `document.querySelector('[data-entity-id="area-a"]')`
returns `null`, and dragging it still works.

`findEntityAt` in `MapPanel.tsx` shows both paths in one function, deliberately,
so the difference is visible side by side.

**Also rejected: Leaflet's own layer `mousedown` event for the polygon.** Leaflet
does dispatch layer events from its canvas renderer, which would have been less
code. Doing the hit test by hand is more faithful to what a WebGL host must do,
and keeps the whole gesture on pointer events rather than mixing in Leaflet's
mouse-event compatibility layer, whose touch behaviour is less predictable.

---

## 12. `useEntityDragSource.ts` was folded into `HostApp`

**Decision.** No separate host drag hook, contrary to the original plan.

**Why.** It amounted to two `useState` calls and two setters. Inlining puts the
host's entire side of the contract — start the drag, clear it on either outcome
— visible in one file, which serves the clarity goal better than an extra
indirection to chase.

---

## 13. Debug instrumentation is a callback, not a built-in panel

**Decision.** MagicChat reports a `CustomEntityDropDebug` snapshot through an
optional `onDebugChange` prop; the host renders it (`host/DebugBar.tsx`).

**Why not render the panel inside MagicChat behind a `debug` flag.** The panel
belongs in host chrome — an app bar — not floating inside a chat. Reporting a
snapshot also keeps the component free of debug UI and styling, and lets a host
send the data anywhere: a bar, a console, a test assertion.

**Why the values are read out of the mechanism, not re-derived.** A debug panel
that recomputes what it displays can agree with itself while disagreeing with
reality. `listening`, `hit`, `isPointerOver` and the listener counters all come
from the same variables the drop logic uses, so the panel cannot drift from the
behaviour it describes.

**Rejected: coalescing emission into `requestAnimationFrame`.** This was the
first implementation, for the same reason rAF is tempting elsewhere — one update
per frame instead of one per event. It is wrong here: **rAF is suspended in
background tabs**, so the panel silently froze and reported a stale `idle` state
while a drag was actually armed. A diagnostic that stops without saying so is
worse than one that costs a render.

Emission is therefore synchronous and unthrottled. The cost — one consumer
render per `pointermove` — is bounded by being opt-in: with no callback
attached, nothing is computed, no events are logged, and the detection path is
byte-for-byte what it was before. Note this is a *display* concern and is
unrelated to decision §4, which is about the detection path itself.

**Side benefit, worth recording.** The panel immediately paid for itself: it
revealed that capturing a screenshot blurs the window and therefore cancels an
in-flight drag via the `blur` handler, and its `ignored other pointer` entries
confirmed the pointer-id lock discards the real mouse while a synthetic gesture
holds the latch. Neither was visible before.

---

## 14. Overlay visibility follows the prop, not the latch

**Decision.** `isDragActive` is `dragCustomEntities.length > 0`. The overlay is
painted for exactly as long as the host says a drag is in flight. The latch no
longer drives any pixels.

**Why.** The latch is an *event* concern — it exists to make consumption
idempotent (§5). Rendering from it made the view a function of internal
bookkeeping rather than of props. The host was already doing it the other way:
`HostApp` mounts its drag ghost on `dragOrigin && dragCustomEntities.length > 0`,
so the two halves of one visual gesture were triggered by two different sources
of truth. Now they agree.

Prop-driven visibility also removes a frame of lag — the latch arms in an effect,
so the overlay used to appear one commit after the prop changed.

**Consequence of removing that lag.** The overlay is now painted *during* the
one-commit window before the latch arms and the document listeners attach. The
window is not new — the latch has always armed a commit after the prop — but it
used to be invisible, because nothing was on screen during it either. A pointer
move landing inside that window is not seen: verified with synthetic events,
where two moves dispatched back-to-back after `pointerdown` produced a
`pointermove` fired count of 1 in the debug bar.

Harmless in practice, and deliberately so. A human's first real move arrives a
frame or more after the press, by which time the latch is armed; a missed move is
corrected by the next one; and `pointerup` re-hit-tests its own coordinates
rather than trusting the last move (§3), so the drop decision is never the
casualty. Do not "fix" this by arming synchronously during render — that is a
side effect in a render body, and the gap it closes is invisible.

**What keeps the overlay honest.** Two tiers, and only the weak one moved:

| Tier | Driven by | Claim |
| --- | --- | --- |
| "Drop custom entity here" | the prop | "a drag is in flight, and this is a drop zone" — true regardless of the latch |
| "Drop `<label>` here" + `-over` classes | `isPointerOver` | "release now and it lands here" |

`isPointerOver` is only ever set inside the armed effect and is reset in its
cleanup, so it is already an armed-*and*-over signal. The specific promise is
therefore still latch-gated, for free, with no new state.

**Rejected: a distinct "disarmed" overlay variant** — dimmed, no `＋`, text like
"drag already released" — shown when the prop is non-empty but the latch is
`spent`. Strictly more honest, but it promotes a host contract violation to a
first-class UI state with its own styling, and spends design vocabulary on a
situation that should not exist.

**Accepted trade-off.** A host that never clears now leaves the overlay stranded
over an inert drop target. The drop was already dead in that case — before this
it just failed invisibly — so this is the same §5 bargain, taken one step
further: the failure is now impossible to miss rather than merely diagnosable.

Note the full shape of it, though. Forgetting `onCustomEntityDragCancelled` is a
*common* mistake (`USAGE.md` lists it as one of three that will bite you), and
the degraded state changes from "drag works once, then stops" to "a blue overlay
permanently covering the chat". That is better for the developer, who sees it
immediately, and worse for end users if it ever ships, because a dead feature is
less damaging than a panel that cannot be dismissed. Accepted for a POC; a host
with a real release process should treat a stuck overlay as the loud signal it
is meant to be.

**Consequence for the stories.** `MagicChat.stories.tsx` sets
`dragCustomEntities` as static story data and never clears it, so
`DragCustomEntities` now shows the stranded overlay permanently. That is the
contract on display rather than a broken story — and the story previously needed
a footnote explaining why the overlay vanished on the first mouse move.
