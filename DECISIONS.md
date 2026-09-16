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

**Why gated.** The *gesture* listeners cost nothing at rest, which matters if
this becomes a package that ships in an app with many chats.

**Amendment (see §15).** "Zero listeners at rest" no longer holds. Four cheap
ones — `pointerdown` / `pointerup` / `pointercancel` on `document`, `blur` on
`window` — are now always attached, tracking whether a button is held. They are
what lets `startCustomEntityDrag` refuse a call made outside a real press, which
is the guard the whole imperative design rests on. The five listeners in this
section are still gated; only the tracker is permanent.

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

**Decision.** A latch inside the hook, which §15 has since reduced to two states:

```
idle ──(startCustomEntityDrag, button held)──► armed
  ▲                                              │
  └──────────── (release / cancel) ──────────────┘
```

One arming permits at most one drop, and the gesture returns itself to `idle`.

**Historical note.** As originally built there was a third state, `spent`, and
the host had to clear `dragCustomEntities` to get back to `idle`. That existed
solely because the arming signal was a prop that outlived the gesture. §15
replaced the prop with a call, and `spent` went with it — the reasoning below is
still why there is a latch at all, and it is still worth reading before
proposing a session id.

**Problem being solved.** Double-consumption. React state updates are async, so
between MagicChat calling back and the host re-rendering with an empty array,
MagicChat still saw the old prop. A stale array plus a stray click on the chat
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

**The trade-off, and how it was retired.** The original bargain was: the host
must clear the array before the next drag, or the second drag silently does
nothing — a loud, easily-diagnosed failure ("my second drag stopped working")
preferred over a silent wrong one (stale re-attachment).

§15 removed the need to choose. With the arming signal as a call, there is no
stale prop for a stray click to re-consume, so idempotency no longer depends on
remembering anything: `armed → idle` happens inside `finish()`, before the
host's callback even runs. The host has nothing to clear and no contract to
forget. Double-consumption within one gesture is still blocked structurally, by
the `gesture.finished` flag.

---

## 6. A cancel callback, not just "consumed"

**Decision.** Two callbacks, exactly one of which fires per armed gesture:
`onDragCustomEntitiesConsumed` and `onCustomEntityDragCancelled(reason)`.

**Why.** With only a "consumed" event, a drag released outside the chat is never
reported, so the host never learns the gesture is over — and then its drag ghost
is stranded on screen. (Before §15 the consequence was worse: the host also
never learned it should clear the array, and per §5 no future drag could arm.)
The host cannot reliably substitute its own `pointerup` handler, because
`pointerup` may never arrive: `pointercancel` (common on touch when the browser
decides the gesture was a scroll), a release outside the browser window, or an
alt-tab. MagicChat is already listening for all of those, so it is the right
place to report them.

**Since §15 these are informational.** Neither callback is load-bearing for the
mechanism any more — the drop target disarms itself either way, so a host that
ignores both still works, and only its own chrome suffers. Exactly one still
fires per armed gesture, and that guarantee is still worth having.

**Cancel sources:** `pointercancel`, `window` blur, `Escape`, and — for mouse
only — a `pointermove` with `buttons === 0`, which means the gesture ended
without us seeing the release.

---

## 7. Not a module-level drag manager

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

**Amendment (see §15).** The prop is gone; the host now calls
`chatRef.current.startCustomEntityDrag(entities)`. That is *not* the singleton
rejected above and none of the objections transfer: the handle belongs to one
mounted component, so there is no shared mutable module state, nothing to test
around, and no failure if two copies of the package end up bundled — each copy's
instances simply address their own. It also improves on the prop for the
multi-target case, which §7 named as the point at which to revisit: a call has an
addressee, so the host arms the target it means instead of publishing one array
that every target reads.

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
the overlay say "Release to attach Car 123" and letting the composer de-duplicate.
Both are optional; `label` falls back to `entity.type` and without `getId` there
is simply no de-duplication.

**Why `getId` is not mandatory.** Tempting, because a host that forgets it gets
two identical chips from two drags of the same object, which reads as a bug. It
is still the wrong trade. A required field must be one the host can always answer
honestly, and for an entity with no identity — a scratch note, a snapshot of a
free-drawn shape — there is no answer. The workarounds a mandatory field would
force are worse than its absence: `getId: () => crypto.randomUUID()` claims an
identity while disabling the de-duplication it was made mandatory for, and
`getId: JSON.stringify` silently merges attachments that are deliberately
distinct (§9). Note also which way each failure points. No `getId` attaches a
second chip — visible, and the user removes it with the chip's × (§16). A wrong
`getId` makes a drop do nothing at all, with no feedback anywhere. The optional
field fails in the safe direction, so the floor for a minimal registry stays at
two renderers and `label`/`getId` are consistently "supply it when you can".

Content-equality as an implicit default (deep-compare `properties` when no
`getId`) was considered and rejected for the same reason as `JSON.stringify`
above: it is schema-agnostic enough to implement, but it decides a policy
question the host owns, and §9 says attaching the same entity twice is allowed.

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

## 14. Overlay visibility follows the drag, not internal bookkeeping

> **Status after §15.** The tension this section was written to resolve no longer
> exists. The prop and the latch were two sources of truth that had to agree;
> the mechanism now owns the payload, so `isDragActive`
> (`dragCustomEntities.length > 0`, where that array is hook state) and "the
> latch is armed" are *the same fact* and cannot diverge. Everything below about
> the two overlay tiers and their wording still holds and is still load-bearing.
> The parts about stranding and about the one-commit gap are marked where they
> have been overtaken.

**Decision.** `isDragActive` is `dragCustomEntities.length > 0`. The overlay is
painted for exactly as long as a drag is in flight.

**Why.** The latch is an *event* concern — it exists to make consumption
idempotent (§5). Rendering from it made the view a function of internal
bookkeeping rather than of props. The host was already doing it the other way:
`HostApp` mounts its drag ghost on `dragOrigin && dragCustomEntities.length > 0`,
so the two halves of one visual gesture were triggered by two different sources
of truth. Now they agree.

Prop-driven visibility also removes a frame of lag — the latch arms in an effect,
so the overlay used to appear one commit after the prop changed.

**Consequence of removing that lag — since closed.** The overlay was then
painted *during* the one-commit window before the latch armed and the document
listeners attached. The window was not new — the latch had always armed a commit
after the prop — but it used to be invisible, because nothing was on screen
during it either. A pointer move landing inside that window was not seen:
verified with synthetic events, where two moves dispatched back-to-back after
`pointerdown` produced a `pointermove` fired count of 1 in the debug bar.

It was judged harmless, and it was: a human's first real move arrives a frame or
more after the press; a missed move is corrected by the next one; and
`pointerup` re-hit-tests its own coordinates rather than trusting the last move
(§3), so the drop decision was never the casualty. The advice at the time was
*not* to fix it by arming synchronously during render — a side effect in a render
body, to close a gap nobody could see.

§15 closed it anyway, and without that hazard: arming is now a function call, so
the listeners attach inside the call itself rather than in an effect a commit
later. There is no render involved to be late. `DragGesture` pins this by
dispatching a single `pointermove` immediately after `pointerdown`, with no
`waitFor` in between, and expecting it to be seen.

**What keeps the overlay honest.** Two tiers, and only the weak one moved:

| Tier | Driven by | Claim |
| --- | --- | --- |
| "Drop custom entity here" | the prop | "a drag is in flight, and this is a drop zone" — true regardless of the latch |
| "Release to attach `<label>`" + `-over` classes | `isPointerOver` | "release now and it lands here" |

`isPointerOver` is only ever set inside the armed effect and is reset in its
cleanup, so it is already an armed-*and*-over signal. The specific promise is
therefore still latch-gated, for free, with no new state.

**Amendment: the two tiers must differ in *wording*, not just in styling.** As
first written the second tier read "Drop `<label>` here" for a single entity and
fell back to "Drop N custom entities here" for more than one. Against a base tier
of "Drop custom entity here", that multi-entity string differs only in the
middle — same opening word, same shape, same length. Read peripherally, mid-drag,
with a drag ghost under the cursor, it is indistinguishable, and every
multi-entity drag therefore looked like the over state was broken. It was
reported as exactly that.

So the second tier now leads with a different verb and always names its payload:
"Release to attach Car 123 and Area A". "Release" is also the affordance the user
is looking for, which the previous wording never stated. Do not collapse the
multi-entity case back to a count — the chips underneath already carry the full
list; the headline's only job is to be unmistakable. The CSS delta was widened
for the same reason (2px→4px ring, inverted card): a hue shift and one pixel is
not a state change anyone can see while concentrating on a drag.

`DragGesture` in `MagicChat.stories.tsx` pins this. It drives a real held gesture
and asserts the exact headline for one- and two-entity payloads, so a regression
fails `npm test` rather than waiting to be noticed by eye.

**Rejected: a distinct "disarmed" overlay variant** — dimmed, no `＋`, text like
"drag already released" — shown when the prop was non-empty but the latch was
`spent`. Strictly more honest, but it promoted a host contract violation to a
first-class UI state with its own styling, and spent design vocabulary on a
situation that should not exist. Moot under §15: that combination of states is no
longer representable.

**Accepted trade-off — since retired.** A host that never cleared was left with
the overlay stranded over an inert drop target. The drop was already dead in that
case, so this was the same §5 bargain taken one step further: the failure made
impossible to miss rather than merely diagnosable.

It had an ugly shape, and that is worth keeping on the record because it is what
motivated §15. Forgetting `onCustomEntityDragCancelled` was a *common* mistake —
`USAGE.md` listed it as one of three that will bite you — and the degraded state
was "a blue overlay permanently covering the chat": better for the developer, who
sees it at once, and worse for end users if it ever shipped, since a dead feature
is less damaging than a panel that cannot be dismissed. Accepting that was
defensible for a POC and uncomfortable for anything else.

Under §15 neither half can happen. The overlay is painted from state the
mechanism owns and clears itself, so it cannot outlive the gesture, and there is
no clearing obligation left to forget.

**Consequence for the stories.** The old `DragCustomEntities` story set
`dragCustomEntities` as static story data and never cleared it, so it displayed
the stranded overlay permanently — the contract on display rather than a broken
story, but confusing either way, and it could never reach the second tier because
no button was ever held. §15 makes that story impossible to write: a drag
announced without a press is refused. It is replaced by
`StartCustomEntityDrag`, which you drive by hand, and `DragGesture`, which
drives itself.

---

## 15. The arming signal is a call, not a prop

**Decision.** The host announces a drag by calling
`chatRef.current.startCustomEntityDrag(entities)` — from the imperative handle,
inside the held gesture. The `dragCustomEntities` prop is gone, as is the
requirement to clear it.

```tsx
onPointerDown={(event) => {
  event.preventDefault();
  chatRef.current?.startCustomEntityDrag([carEntity]);   // the entire handshake
}}
```

**Why.** `dragCustomEntities` encoded an *event* as *state*. "A button is
physically down on one of the host's objects right now" is a fact with a lifetime
of one press; a prop is a value that persists until somebody changes it. Every
sharp edge this file documented came from that mismatch, and they all resolve at
once:

| Documented problem | Was caused by |
| --- | --- |
| §5 — host must clear the array or the next drag silently dies | state outliving the event |
| §14 — overlay stranded over an inert target | the same |
| `ARCHITECTURE-for-dummies.md` — a whole numbered warning about "set the array *while the button is down*" | a prop can be set from a click or an effect; a guarded call cannot |
| §14 — the verified one-commit window where the first `pointermove` is missed | arming had to travel through a render |
| `ARCHITECTURE.md` §6 — two drop targets both watch one array and both fire | one value, no addressee |

The latch also drops from three states to two (§5), because there is no longer a
stale prop for a stray click to re-consume.

**The guard is the point.** `startCustomEntityDrag` refuses unless a button is
actually held, returning `false` and changing nothing. That is what makes
"armed" mean what it says, and it is why the old failure mode cannot be
reproduced: a drag cannot be announced from a click, an effect, or a Storybook
arg. Refusals are counted in `CustomEntityDropDebug.refusedStarts` and the
tracker's own view is in `pointerDown`, so "why was my drag refused?" is
answerable from the debug bar.

**Rejected: taking the triggering event, `startCustomEntityDrag(entities, event)`.**
The natural-looking option, and wrong. A `PointerEvent` is a frozen snapshot, so
a host arming from a long-press timer or a drag-threshold check hands over a
stale `buttons: 1` and the guard approves a gesture that has already ended —
precisely the failure the guard exists to catch. The DOM offers no way to *ask*
whether a button is down, so the hook watches instead (see the tracker, and the
§3 amendment).

That tracker pays for itself twice. The guard becomes exact, and the pointer id
is known at *arm* time rather than inferred from the first `pointermove` we
happen to see — so multi-touch is filtered correctly from the very first event
instead of the second.

**Rejected: a `dragging` boolean prop plus a payload ref.** Half the plumbing,
all of the original problem: a boolean prop persists exactly like an array does,
so the clearing obligation survives intact.

**Rejected: one setter, `setCustomEntitiesDrag(entities)`, with `[]` as the
abort.** Two objections, one of them concrete. `start` while already armed means
*replace the payload*, so `[]` would collide two intents — a host passing a
computed selection that happens to be empty would silently abort a live drag
instead of being refused — and the boolean return would invert with the argument,
since "armed now" is permanently `false` for the empty case. The naming is the
softer objection but still real: `set*` is the state vocabulary this decision
exists to remove, and it invites "I'll just clear it in a cleanup", which is the
old footgun in a new costume. A verb that *announces* keeps the guard honest.

An empty payload is therefore refused unconditionally, checked *before* the
already-armed branch. That ordering is load-bearing: the other way round,
`start([])` on a live gesture would empty the payload while the latch stayed
armed and listening, so `isDragActive` would go false with the target still live
and a release inside the zone would report "consumed" with nothing to consume.

**Kept, though currently unused: `cancelCustomEntityDrag()`.** A silent abort —
neither resolve callback fires, because the host asked for it and therefore
already knows. Honesty about its status: nothing in the demo or the stories calls
it, and every reason to abort mid-gesture is already covered.

| Reason to abort mid-gesture | Already handled by |
| --- | --- |
| Pointer released, anywhere | `pointerup` → `dropped` / `released-outside` |
| Touch became a scroll | `pointercancel` → `cancelled` |
| Released outside the window, alt-tab | `window` `blur` → `cancelled` |
| User pressed Escape | `keydown` → `cancelled` |
| "This turned out to be a pan" | don't call `start` yet — calling it late in the held gesture, past a drag threshold, is explicitly legal |
| Chat unmounted mid-drag | the hook's unmount cleanup detaches |
| Selection changed | `startCustomEntityDrag(newSelection)` replaces the payload |

It is kept as a deliberate escape hatch for a host we have not written, on the
grounds that it is a few lines that cannot misfire: a no-op when idle, silent
when it acts. Do not reach for it as part of a normal gesture — if you find
yourself needing it, check the table first, because the mechanism has probably
already done the job.

**Accepted costs.**

- **Four listeners at rest**, where §3 previously boasted zero. Cheap, and the
  exactness they buy is the foundation of the guard.
- **The overlay can no longer be painted declaratively.** A Storybook story
  cannot show it from static args, because static args are exactly what the
  guard rejects. Not really a loss — the old `DragCustomEntities` story
  displayed a *stranded, inert* overlay and could never reach the second tier
  (§14) — but it does mean the only way to see the overlay is to perform a drag.
  `StartCustomEntityDrag` is driven by hand and `DragGesture` drives itself.
- **The host needs a ref.** One `useRef` against the `useState` and two
  clearing callbacks it replaces, so the host gets smaller, not larger.
- **A drag ghost can still be stranded.** The failure mode did not vanish
  entirely; it moved somewhere harmless. A host that ignores both resolve
  callbacks leaves its *own* ghost on screen, and MagicChat keeps working. The
  degraded state is now the host's chrome misbehaving rather than the component
  being wedged.

---

## 16. The chip and its × belong to MagicChat, the contents to the host

**Decision.** `ComposerEntity` renders a `.mc-chip` shell with a `.mc-chip-remove`
button and puts the host's `composer` renderer *inside* it. The renderer draws
contents only — icon, name, whatever — and does not draw a ×.

```tsx
composer: ({ entity }) => <span>🚗 {entity.properties.name}</span>   // that is all
```

**Why.** Ownership of the control should follow ownership of the state. The
attachment list is MagicChat's (`ARCHITECTURE.md` §5), so "take this back off the
message" is MagicChat's affordance to offer. Delegating it to the host made a
guaranteed capability optional:

- A renderer that drew no ×, or drew one and forgot to wire `remove`, stranded an
  entity in the composer with no way out. The chat looked broken; the bug was in
  host code MagicChat never sees.
- The fallback chip for an unregistered type had **no** × at all — nothing was
  there to draw one. An entity whose renderer was missing was also unremovable,
  which is exactly the case where you most want to get rid of it.
- Every host paid for the same button, and it looked slightly different in each
  entity type. Placement, hit area and the `aria-label` are now uniform for free.

**What was rejected.**

- *Drop `remove` from `CustomEntityComposerProps` entirely.* It is a two-word
  prop with a real use — a host whose chip is a wider card may want its own
  "clear" inside that chrome — and removing it would be an API break that buys
  nothing. It stays, documented as the escape hatch rather than the primary
  affordance; a host that ignores it (the common case) still gets a working ×.
- *Make the shell opt-out (`chrome: false`).* A flag whose only job is to switch
  off the guarantee this decision exists to make. The escape hatch above covers
  the real need without letting a host reach the unremovable state again.
- *Leave the shell to the host but default `remove` to a no-op.* Same stranding,
  now silent rather than a type error.

**Cost.** Hosts lose control of the pill itself — padding, radius, background
come from `magic-chat.css`, not `host.css`. That is the intended trade: the chip
is chat chrome, and the host's `.entity-chip` is now content-only styling. A host
that wants a fundamentally different chip shape has to restyle `.mc-chip`.
