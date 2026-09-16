# Custom-entity drag & drop — implementation specification

How to add **"drag an object out of the host application and drop it into the
chat"** to a chat component that already exists.

**Audience: an agent or developer bolting this capability onto their own chat.**
This document is self-contained — it references no other file and needs no
source reading. It specifies the drop mechanism, the imperative ref API, the
host's side of the contract, the CSS that the detection depends on, and the
invariants that must hold.

**It does not specify a chat.** Your message list, composer, text input, send
button, transport, styling and message model stay exactly as they are. What is
added is a drop target, a small ref API, one new piece of state (pending
attachments), and a registry so your chat can draw objects whose schema it does
not know.

Where a rule looks over-engineered, the paragraph under it says what breaks
without it. Those explanations are the load-bearing part of this spec; the
simplifications they warn about are the ones an implementer reaches for first.

---

## 0. TL;DR of the mechanism

1. A **custom entity** is `{ type: string, properties: object }` — opaque JSON.
2. Your chat knows **only** `type`. It looks up a host-supplied renderer in a
   registry keyed by `type`, and never inspects `properties`.
3. The host announces a drag by **calling a method on your chat's ref** —
   `chatRef.current.startCustomEntityDrag(entities)` — **while a pointer button
   is physically held**. There is no drag prop.
4. Your chat then attaches `pointermove` / `pointerup` listeners on `document`
   (capture phase), hit-tests pointer coordinates with
   `document.elementFromPoint`, and on release decides drop vs. cancel.
5. The gesture **disarms itself**. The host has nothing to clear.

Everything below is detail in service of those five points.

---

## 1. Scope

### What this adds to your chat

| Added | Where it lives |
| --- | --- |
| `useCustomEntityDropTarget` — the whole detection mechanism | One new file. Generic; knows nothing about chat. |
| An imperative handle on your chat (`startCustomEntityDrag`, …) | `forwardRef` + `useImperativeHandle` on your existing component. |
| `attachments` state — entities dropped but not yet sent | Your chat component. |
| A registry prop — how to render each entity `type` | Your chat's props. |
| A drop overlay | Inside your chat's root element. |
| Entity rendering in the composer and in sent messages | Two small render sites. |

### What stays yours, untouched

Message state and model, transport, the text input and its key handling, the
send button, scrolling, avatars, timestamps, theming, and every existing prop.
The only change to your message *model* is that a message may now carry an
array of entities alongside its text.

### Non-goals

- Cross-window or cross-document drags.
- Keyboard-initiated drag (see §11 for the programmatic alternative).
- Re-ordering attachments beyond detach.
- Any opinion about how entities are transmitted once a message is sent — they
  are JSON; send them however you send messages.

---

## 2. Integration checklist

Six changes to your chat. Sections in brackets have the detail.

1. Add the types in §3 and the hook in §5 (two new files, no edits to yours).
2. Accept a `customEntityComponents` registry prop [§6.1].
3. Wrap your component in `forwardRef` and expose the handle in §3 [§6.2].
4. Call the hook; put `dropZoneRef` on your chat's **root** element, and give
   that element `position: relative` [§6.3].
5. Add `attachments` state; render it above your input, and include it when you
   build a message on send [§6.4, §6.5].
6. Render the overlay, and add the three CSS rules in §7 [§6.6].

The host application then does three things and nothing else [§8].

---

## 3. The type contract

Implement these exactly. They are the API; the rest is implementation.

```ts
import type { ComponentType } from 'react';

/** Any host object, as JSON. Your chat reads `type` and nothing else. */
export interface CustomEntity<P = object> {
  type: string;
  properties: P;
}

/** Props for a `composer` renderer (the chip shown before sending). */
export interface CustomEntityComposerProps<E extends CustomEntity = CustomEntity> {
  entity: E;
  /** The chat's own id for this attachment (see `AttachedEntity`). */
  instanceId: string;
  /**
   * Detach this attachment. An ESCAPE HATCH, not the primary affordance — the
   * chat already wraps every composer renderer in a chip shell carrying its
   * own ×. Ignoring this is the common case.
   */
  remove: () => void;
}

/**
 * Props for a `message` renderer (inside a sent message body).
 * `M` is YOUR chat's own message type, passed through untouched — the renderer
 * gets read-only context about the message the entity was sent with.
 */
export interface CustomEntityMessageProps<E extends CustomEntity = CustomEntity, M = unknown> {
  entity: E;
  message: M;
}

/** How the host renders one entity type on each of the two surfaces. */
export interface CustomEntityComponentDefinition<E extends CustomEntity = CustomEntity, M = unknown> {
  composer: ComponentType<CustomEntityComposerProps<E>>;
  message: ComponentType<CustomEntityMessageProps<E, M>>;
  /** Human-readable name for generic chrome (drop overlay, aria-labels). */
  label?: (entity: E) => string;
  /** Opt-in de-duplication key. The chat cannot derive this — it has no schema. */
  getId?: (entity: E) => string;
}

/**
 * Registry keyed by `CustomEntity.type`.
 * The generic is erased to `any` so definitions for different entity types can
 * share one object; hosts keep their typing by writing typed renderer components.
 */
export type CustomEntityComponentRegistry = Record<string, CustomEntityComponentDefinition<any, any>>;

/**
 * An entity attached but not yet sent.
 * `instanceId` is generated by the chat and deliberately NOT taken from
 * `properties.id`: the chat does not know the schema and cannot assume such a
 * field exists. React keys need a stable id, so it makes its own.
 */
export interface AttachedEntity {
  instanceId: string;
  entity: CustomEntity;
}

/** Why a drag ended without a drop on the chat. */
export type CustomEntityDragCancelReason = 'released-outside' | 'cancelled';

/** Fallback renderer for an entity whose `type` is not in the registry. */
export interface UnknownEntityProps {
  entity: CustomEntity;
  surface: 'composer' | 'message';
}

/** New props on your chat component. */
export interface CustomEntityChatProps {
  customEntityComponents: CustomEntityComponentRegistry;
  /** Dropped and now in the composer. Informational — the host need do nothing. */
  onDragCustomEntitiesConsumed?: (entities: CustomEntity[]) => void;
  /** The drag ended without a drop. Informational; the right place to retire host chrome. */
  onCustomEntityDragCancelled?: (reason: CustomEntityDragCancelReason) => void;
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
  /** Diagnostics only; omit and none of it is computed. See §9. */
  onDebugChange?: (debug: CustomEntityDropDebug) => void;
}

/** The imperative handle on your chat. THIS is how a drag is announced. */
export interface CustomEntityChatHandle {
  /**
   * Announce a drag of `entities` and arm the drop target.
   * MUST be called while a button is physically held. Refused otherwise:
   * returns `false` and changes nothing.
   * Calling again while armed REPLACES the payload without re-arming.
   * Returns whether the target is armed when the call returns.
   */
  startCustomEntityDrag: (entities: CustomEntity[]) => boolean;
  /** Abandon an armed drag. Silent: neither resolve callback fires. */
  cancelCustomEntityDrag: () => void;
  /** Attach without a drag at all (e.g. a "Send to chat" button). */
  attachEntities: (entities: CustomEntity[]) => void;
  /** Drop every pending attachment. */
  clearAttachments: () => void;
}

/** Export publicly — hosts need it for their own drag ghosts. */
export function entityLabel(
  registry: CustomEntityComponentRegistry,
  entity: CustomEntity,
): string {
  return registry[entity.type]?.label?.(entity) ?? entity.type;
}
```

Keep all of this in one module and treat its exports as the public API surface:
anything not exported is internal, and adding to it is an API decision.

**The structural rule:** none of this code may import your host application's
entity schemas, and none of it may branch on a concrete `type` value. That is
what makes the capability reusable across hosts.

---

## 4. Why the drag is a call and not a prop

The obvious design is `<Chat dragCustomEntities={entities} />`: the host puts
entities in state on `pointerdown`, the chat arms when the prop is non-empty.
**Do not build that.** Five things go wrong with it, and all five are the same
root cause.

1. The host must *un-say* it. A forgotten clear leaves the target armed forever;
   the next press is then refused or, worse, silently consumes a stale payload.
2. The overlay strands: the chat paints "drop here" with no gesture behind it,
   because the prop outlives the gesture.
3. A prop set from a click, an effect, or a timer arms a target with **no
   pointer gesture at all** — the chat believes a drag is in flight that is not.
4. Arming has to travel through a render, so the target is inert for one commit;
   a `pointermove` landing in that window is never seen.
5. Two sources of truth — "the host says a drag is happening" and "the latch is
   armed" — that can disagree, with no way to decide which is right.

The root cause: "a button is physically down on one of my objects **right now**"
is an *event*, while a prop is a *value that persists until someone changes it*.
Encoding the event as state creates an obligation to retract it, and every
failure above is that obligation being missed.

A method call cannot be left set. It is also the edge itself, so listeners can
be attached synchronously inside the call, which removes failure 4 outright.

**Corollary you must implement: the "is a button held" guard cannot be satisfied
by a `PointerEvent` the host passes in.** A `PointerEvent` is a frozen snapshot;
a host arming from a long-press timer would hand you a stale `buttons: 1` long
after the release, and the guard would approve a dead gesture — precisely what
the guard exists to prevent. You must watch live pointer state yourself (§5.1).

---

## 5. The mechanism — `useCustomEntityDropTarget`

A generic "drop target for host-driven pointer drags". It knows nothing about
chat; it could be published on its own, and it is the only file that contains
any of the difficulty.

### Signature

```ts
function useCustomEntityDropTarget(options: {
  onDrop: (entities: CustomEntity[]) => void;
  onCancel?: (reason: CustomEntityDragCancelReason) => void;
  onDebug?: (debug: CustomEntityDropDebug) => void;
}): {
  dropZoneRef: RefObject<HTMLDivElement>;
  startCustomEntityDrag: (entities: CustomEntity[]) => boolean;
  cancelCustomEntityDrag: () => void;
  dragCustomEntities: CustomEntity[];
  isDragActive: boolean;   // === dragCustomEntities.length > 0
  isPointerOver: boolean;
};
```

Mirror `onDrop` / `onCancel` / `onDebug` into refs and assign on every render, so
listeners attached once per gesture always reach the latest callbacks without
being re-created.

### 5.1 The held-pointer tracker — the only listeners at rest

`startCustomEntityDrag` must answer "is a button down *right now*", and the DOM
offers no way to ask. So watch, permanently, from a mount effect:

```
document.addEventListener('pointerdown',   handleDown,    true)   // capture
document.addEventListener('pointerup',     handleRelease, true)
document.addEventListener('pointercancel', handleRelease, true)
window.addEventListener('blur',            handleBlur)
```

- `handleDown`: ignore unless `(event.buttons & 1) !== 0` — that is the primary
  button for a mouse and "in contact" for touch and pen, so one test covers every
  pointer type, and a right- or middle-click cannot arm a drag. Otherwise store
  `{ pointerId, pointerType }` in a ref.
- `handleRelease`: clear the ref **only if** `pointerId` matches the held one.
- `handleBlur`: clear unconditionally. A release outside the browser window may
  never produce a `pointerup`, and a tracker stuck on "held" would let a later
  click arm a drag. Fail closed.
- **Capture phase is required** on `pointerdown`: you must see the press before
  the host handler that is about to call `startCustomEntityDrag` for that very
  event runs anywhere down the tree.

Cost: four listeners at rest, deliberately bought. It pays for itself twice —
the guard becomes exact, and you know the `pointerId` at *arm* time, so
multi-touch is filtered correctly from the first event rather than by a
"lock onto the first move we happen to see" heuristic.

### 5.2 The latch

Two states only:

```
idle --(startCustomEntityDrag, button held)--> armed
  ^                                              |
  +------------- (release / cancel) -------------+
```

No third state, and nothing for the host to reset: an arming that is a function
call cannot outlive the gesture, so the gesture returns to `idle` by itself and
the next press starts clean.

Per-gesture bookkeeping lives in **one ref**, not state — it must be readable
synchronously from `document` listeners and must not cause renders:

```ts
interface Gesture {
  entities: CustomEntity[];
  pointerId: number;      // the gesture belongs to one pointer
  pointerType: string;
  over: boolean;          // local mirror of isPointerOver, so moves only touch state on a change
  finished: boolean;      // e.g. a pointerup immediately followed by a window blur
  detach: () => void;
}
```

`entities` is *also* mirrored into React state (`dragCustomEntities`), because
the overlay must repaint when the payload changes. Use a module-level
`const NO_ENTITIES: CustomEntity[] = []` when disarming, so going idle does not
hand out a fresh array identity every time.

### 5.3 `startCustomEntityDrag(entities)` — step by step

Order matters; the notes say why.

1. **If `entities.length === 0`, refuse** (return `false`, bump the refusal
   counter). **This check must come BEFORE the already-armed branch.** The other
   order lets `start([])` empty a *live* gesture while the latch stays armed:
   `isDragActive` would go false while the target is still listening, and a
   release inside the zone would report "consumed" with nothing to consume. This
   check is also why aborting is `cancelCustomEntityDrag()` and not `start([])`.
2. **If a gesture is already live:** replace `gesture.entities`, update the
   mirrored state, return `true`. Do **not** re-arm and do not touch the pointer
   lock — this is what lets a host grow a selection mid-drag. The drop reads the
   payload as of the moment of release.
3. **Read the held-pointer ref. If null, refuse** — return `false`, change
   nothing, bump the refusal counter. This is the guard that makes "armed" mean
   what it says.
4. Create the `Gesture` from the held pointer's `pointerId` / `pointerType`.
5. **Attach the gesture listeners synchronously, here, inside the call** — not
   from an effect keyed on the latch. The call *is* the edge; routing it through
   a render leaves the target inert for one commit, and a `pointermove` arriving
   in that window is lost.
6. Set the debug/latch bookkeeping, mirror `entities` into state, return `true`.

### 5.4 The gesture listeners

All on `document` in **capture phase** (so nothing in the page can
`stopPropagation` them away from you), plus `blur` on `window`. Attached only
while armed; detached in `finish`.

| Listener | Behaviour |
| --- | --- |
| `pointermove` | Ignore other `pointerId`s. Defensively: `pointerType === 'mouse' && buttons === 0` → `finish('cancelled')` (unreachable in normal use, since arming requires a held button, but it costs one comparison and turns a stuck overlay into a clean cancel). Otherwise hit-test the coordinates and update `over`. |
| `pointerup` | Ignore other `pointerId`s. Hit-test **this event's own coordinates** — never trust the last move, which can be a frame stale. Inside → `finish('dropped')`; outside → `finish('released-outside')`. |
| `pointercancel` | Ignore other `pointerId`s. `finish('cancelled')`. Common on touch. |
| `keydown` | `Escape` → `finish('cancelled')`. |
| `window` `blur` | `finish('cancelled')`. A release outside the browser window may never produce a `pointerup`. |

**Pointer filtering is what makes multi-touch behave:** every event whose
`pointerId` differs from `gesture.pointerId` is noise and must be dropped before
any other handling.

### 5.5 The hit test

```ts
const element = document.elementFromPoint(clientX, clientY);
const inside = !!element && !!dropZoneRef.current?.contains(element);
```

**Why coordinates and not `onPointerEnter` / `onPointerLeave` on the drop zone?**
Native enter/leave is simpler and works for a mouse when the host takes no
capture. It breaks in the two cases that must be supported:

- Touch and pen **implicitly capture** the pointer to the element that received
  `pointerdown`. Every later move/up for that gesture is delivered *there*, so
  the drop zone never sees them.
- `setPointerCapture` does the same explicitly, and it is the normal way to drag
  a canvas/WebGL object — you need it to keep receiving moves once the pointer
  leaves the canvas.

`document.elementFromPoint` is plain render-tree hit-testing and is unaffected
by pointer capture. It also beats comparing against `getBoundingClientRect()`,
because a rect test reports "inside" even when a dialog or the drag ghost is
painted on top.

**The cost, which you must pay in CSS (§7): anything painted under the cursor
becomes the answer to every hit test.** The drop overlay and the host's drag
ghost must both be `pointer-events: none`.

### 5.6 `finish(outcome)`

1. If `gesture.finished`, return (idempotent — e.g. `pointerup` then `blur`).
2. Mark finished, set `over` false, `gesture.detach()`, clear the gesture ref.
3. Reset debug state, record the outcome, set `dragCustomEntities` to
   `NO_ENTITIES`.
4. **Last**, invoke the callback: `onDrop(gesture.entities)` for `'dropped'`,
   else `onCancel(reason)`. Callback last means the mechanism is fully back at
   rest before anyone reacts, so a host that arms a *new* drag from inside the
   callback never races a half-torn-down gesture.

### 5.7 `cancelCustomEntityDrag()`

Same teardown, **silent**: neither `onDrop` nor `onCancel` fires. The host asked
for it and therefore already knows. This is for a host that decides mid-gesture
that the drag was really a pan.

### 5.8 Unmount

A mount effect's cleanup detaches any live gesture without firing a callback —
matching the silence of `cancelCustomEntityDrag`, since there is no component
left to report to.

### 5.9 Invariants (check every change against these)

1. `isDragActive` is true **for exactly as long as** the latch is armed. One
   fact, not two that must agree.
2. Gesture listeners exist **only** while armed.
3. At most one drop per arming.
4. Only the locked `pointerId` can affect the gesture.
5. Every path out of `armed` runs `finish` or `cancelCustomEntityDrag` exactly
   once — so listeners are never leaked.
6. `startCustomEntityDrag` never arms without a physically held button.
7. An empty payload can never empty a live gesture.
8. The host has nothing to clear, ever.

If a change makes one of these awkward to hold, the change is wrong.

---

## 6. Wiring it into your chat component

### 6.1 The registry prop

Your chat accepts `customEntityComponents` and passes it to the two render sites
(§6.5). It must never read `entity.properties`, and never branch on a specific
`type` string.

### 6.2 The ref handle

Wrap your chat in `forwardRef<CustomEntityChatHandle, YourProps & CustomEntityChatProps>`
and expose the handle with `useImperativeHandle`, passing the hook's
`startCustomEntityDrag` / `cancelCustomEntityDrag` straight through:

```tsx
useImperativeHandle(ref, () => ({
  startCustomEntityDrag,
  cancelCustomEntityDrag,
  attachEntities,
  clearAttachments,
}), [startCustomEntityDrag, cancelCustomEntityDrag, attachEntities, clearAttachments]);
```

If your chat already exposes a handle, merge these members into it. If it
exposes none, this is the reason it now must.

### 6.3 The drop zone

```tsx
const {
  dropZoneRef, startCustomEntityDrag, cancelCustomEntityDrag,
  dragCustomEntities, isDragActive, isPointerOver,
} = useCustomEntityDropTarget({
  onDrop: handleDrop,
  onCancel: onCustomEntityDragCancelled,
  onDebug: onDebugChange,
});
```

`dropZoneRef` goes on your chat's **root** element — the whole chat is the drop
target, not just the composer, so the user does not have to aim. That element
needs `position: relative` because the overlay is `inset: 0`.

Add the drag classes to it so the overlay can style against them:

```tsx
<div
  ref={dropZoneRef}
  className={['your-chat',
    isDragActive && 'ce-drag-active',
    isPointerOver && 'ce-drag-over'].filter(Boolean).join(' ')}
>
```

### 6.4 Attachment state

One new piece of state:

```ts
const [attachments, setAttachments] = useState<AttachedEntity[]>([]);
```

`instanceId` comes from a module-level counter (`attached-1`, `attached-2`, …).
**Do not** derive it from `properties.id` — there may not be one.

**`attachEntities(entities)`** — for each entity, look up
`registry[entity.type]?.getId`. If present, compute the id and skip the entity
if an attachment of the same `type` already has that id. **De-duplication is
opt-in per type, because only the host knows what makes two entities "the
same".** Without `getId`, always append.

**`handleDrop(entities)`** — `attachEntities(entities)`, then
`onDragCustomEntitiesConsumed?.(entities)`, then focus your text input. The
callback is informational; the target has already disarmed itself.

**On send** — include `attachments.map(a => a.entity)` in the message you build,
then clear `attachments` along with your existing draft reset. Two knock-on
changes in your chat: a message with entities but empty text must be sendable
(so your "can send" test becomes `text.trim() || attachments.length > 0`), and
your message model gains an entity array.

### 6.5 Rendering entities — two sites

**Composer chips (pending attachments), above your input.** The chat renders a
chip **shell** containing the host's `composer` output plus **the chat's own ×**
with `aria-label={"Remove " + entityLabel(registry, entity)}`:

```tsx
<span className="ce-chip">
  <span className="ce-chip-content">
    {definition
      ? <definition.composer entity={entity} instanceId={instanceId} remove={remove} />
      : <Unknown entity={entity} surface="composer" />}
  </span>
  <button type="button" className="ce-chip-remove" onClick={remove}
          aria-label={`Remove ${label}`}>×</button>
</span>
```

The shell and its × belong to the chat, not the host: the attachment list is
chat state, so detaching is the chat's affordance to offer. Leave it to the host
renderer and a renderer that forgets to draw a × (or draws one and forgets to
wire it) strands an entity in the composer with no way out — and the
unknown-type fallback would have no × at all. Owning it here also makes it
uniform across entity types for free. `remove` is still passed down as an escape
hatch for a host that wants a second control inside its own chrome.

**Sent messages.** For each entity on a message, render
`definition.message` with `{ entity, message }` — no shell; the host owns the
whole card, including any actions it offers. Key by **index**: messages are
immutable once sent, and the chat cannot key on a `properties.id` it does not
know exists.

**Both sites must survive an unregistered `type`.** Fall back to
`renderUnknownEntity` if supplied, else a built-in `"Unsupported entity: <type>"`
chip. A host that adds a new entity type server-side before shipping a renderer
must not crash the chat.

### 6.6 The drop overlay — two tiers

Rendered only when `isDragActive`, as the last child of the drop-zone element,
`aria-hidden="true"` (it is chrome for a pointer gesture):

- **Base tier** (armed, pointer anywhere): `"Drop custom entity here"`.
- **Over tier** (`isPointerOver`): `"Release to attach <labels>"`, plus each
  label rendered as a chip underneath.

Two wording rules are load-bearing. The user reads this mid-drag, at a glance,
with a ghost under the cursor — so the two tiers must differ *at the start of
the string*, not in the middle:

1. The over tier leads with **"Release"**, not "Drop". The base state already
   starts with "Drop", so a second headline starting with "Drop" reads as the
   same string and the over state looks like nothing happened.
2. It **names the entities even when there are several**. A generic plural
   fallback like "Drop 2 custom entities here" differs from the base string only
   in the middle and is effectively invisible, so the over state looks broken for
   every multi-entity drag.

```
0 labels  → "Release to attach"
1         → "Release to attach A"
2         → "Release to attach A and B"
n         → "Release to attach A and (n-1) more"
```

Truncate rather than wrap — the full list is always rendered as chips beneath.
Labels come from `entityLabel(registry, entity)`. Style the over state as an
**inversion**, not merely an emphasis, for the same at-a-glance reason.

---

## 7. CSS requirements

Only three rules are load-bearing. The rest is your chat's styling.

1. **The drop overlay must be `pointer-events: none`.** Otherwise
   `document.elementFromPoint` returns the overlay at every hit test and the
   drop zone can never be "hit". Comment it in the CSS as required, not
   decorative — it looks deletable.
2. **A host drag ghost must be `pointer-events: none`** for the same reason. The
   host should put it in `position: fixed` and drive it with `style.transform`
   from its own `pointermove` listener, so dragging does not re-render the host
   each frame.
3. **Drag sources need `touch-action: none`.** Without it a touch drag is treated
   as a scroll: the browser fires `pointercancel` and the gesture dies.

Plus: the drop-zone element needs `position: relative`. Prefix the new classes
(`ce-` above) so they cannot collide with your existing chat CSS.

---

## 8. The host side of the contract

The host's entire obligation is three steps:

1. Notice the user pressed one of its objects.
2. Call `chatRef.current.startCustomEntityDrag([entity])` **while the button is
   still down**.
3. Show and hide its own drag chrome.

Note what is *not* on that list: no drag payload state to clear, and no way to
wedge the chat by forgetting to.

```tsx
const chatRef = useRef<CustomEntityChatHandle>(null);

const customEntityComponents = useMemo(() => ({
  Car: {
    composer: CarChip,
    message: (props) => <CarCard {...props} zoomTo={zoomTo} />,   // zoomTo must be useCallback-stable
    label: (e: CarEntity) => e.properties.name,
    getId: (e: CarEntity) => e.properties.id,
  },
}), [zoomTo]);

<div
  style={{ touchAction: 'none' }}
  onPointerDown={(event) => {
    event.preventDefault();
    // Returns false if no button is held — which cannot happen from a
    // pointerdown handler, but is exactly what stops a click or an effect
    // from arming a drag that is not really happening.
    if (!chatRef.current?.startCustomEntityDrag([carEntity])) return;
    showGhost(event);
  }}
/>

<YourChat
  ref={chatRef}
  customEntityComponents={customEntityComponents}
  onDragCustomEntitiesConsumed={hideGhost}
  onCustomEntityDragCancelled={hideGhost}
/>
```

### Registry stability — the silent footgun

An inline object literal (or an inline arrow closing over an unstable callback)
is a **new component type every render**, so React unmounts and remounts every
renderer instead of updating it. Entity components lose their state, and the
failure looks like flicker rather than like a bug. `useMemo` over
`useCallback`-stable callbacks, as above.

### Arming later than `pointerdown`

A long-press or a drag-threshold delay is fine: arm from a timer or from the
first move past the threshold, as long as the button is still held at that
moment. The tracker (§5.1) checks liveness at call time, so a gesture that ended
during the delay is refused instead of arming a dead drag.

### Drag sources without a DOM element

Canvas- and WebGL-drawn objects have no element to hang a handler on. The host
hit-tests them itself — a `pointerdown` on the canvas, geometry test against its
own model (ray casting a polygon, a picking buffer, whatever it already has) —
and calls `startCustomEntityDrag` with the entity it identified. **This is the
case native HTML5 drag & drop cannot serve, and the reason this whole mechanism
exists.** Nothing in the chat's side changes: it receives JSON either way.

If the host takes `setPointerCapture` to keep receiving moves off-canvas, the
mechanism is unaffected — that is exactly why detection is coordinate-based.

### Suppressing the host's own gesture

A drag source that lives inside a pannable/zoomable surface must stop that
surface reacting: `preventDefault()` + `stopPropagation()` on the press, disable
panning, and re-enable it from a one-shot `pointerup` / `pointercancel` capture
listener. Listen in capture phase so you see the press before the surface's own
handlers. On a press that misses every object, do nothing and let it pan.

### Reacting to the outcome

Both callbacks are informational; a host that ignores them still drags
correctly. Handle `onCustomEntityDragCancelled` anyway: on `pointercancel`
(common on touch) or a release outside the window your own `pointerup` may never
fire, and your ghost would be left on screen.

---

## 9. Debug instrumentation (optional but specified)

Diagnostics only — **nothing in the mechanism may depend on it, and if
`onDebugChange` is absent none of it is computed.** It is worth building: the
snapshot answers "why was my drag refused?" directly, which is otherwise the
hardest question here.

```ts
export type CustomEntityDragLatchState = 'idle' | 'armed';

export type CustomEntityDropListenerName =
  | 'pointermove' | 'pointerup' | 'pointercancel' | 'keydown' | 'blur';

export interface CustomEntityDropListenerStatus { attached: boolean; fired: number }
export interface CustomEntityDropDebugEvent { name: string; detail?: string; at: number }

export interface CustomEntityDropDebug {
  latch: CustomEntityDragLatchState;
  listening: boolean;
  listeners: Record<CustomEntityDropListenerName, CustomEntityDropListenerStatus>;
  entityCount: number;
  /** What the always-on tracker currently sees held — the answer to "why was my drag refused?" */
  pointerDown: { pointerId: number; pointerType: string } | null;
  /** Cumulative refused `startCustomEntityDrag` calls. Non-zero ⇒ a host is arming outside a press. */
  refusedStarts: number;
  pointerId: number | null;
  pointerType: string | null;
  buttons: number | null;
  pointer: { x: number; y: number } | null;
  hit: { element: string; insideDropZone: boolean } | null;
  isPointerOver: boolean;
  lastOutcome: 'dropped' | CustomEntityDragCancelReason | null;
  /** Most recent discrete events, newest first, capped (8 is enough). Moves are counted, not logged. */
  recentEvents: CustomEntityDropDebugEvent[];
}
```

Accumulate in a ref; emit an **immutable copy** (shallow-clone `listeners`,
`pointerDown`, `recentEvents`).

**Emit synchronously and unthrottled.** Do not coalesce into
`requestAnimationFrame`: rAF freezes silently when the tab is backgrounded, and
a debug feed that stops without saying so is worse than a slightly expensive
one. The cost is one consumer render per `pointermove` *while a debug callback is
attached*; the detection path is unaffected either way.

---

## 10. Build order

1. The types (§3) — the whole contract, no implementation.
2. `useCustomEntityDropTarget` (§5). Verifiable on its own against a bare
   `<div>` drop zone, before your chat is touched at all.
3. The overlay CSS, `pointer-events: none` first (§7).
4. Your chat: registry prop, ref handle, drop zone, overlay (§6.1–6.3, §6.6).
   At this point a drag visibly arms and the overlay tiers work.
5. Attachment state and the composer chip shell (§6.4, §6.5) — now a drop lands.
6. Entities in sent messages, and the send-path changes (§6.4, §6.5).
7. The host: one DOM-sourced drag source, then a canvas-sourced one (§8).
8. The debug snapshot and a panel to display it (§9).

---

## 11. Known gaps (do not treat as bugs)

- **No keyboard path** to initiate a drag. The pointer gesture is the only way;
  `attachEntities` is the programmatic alternative to wire to a button or menu
  item, and is the accessible route.
- **No cross-window drags.** Everything is one document.
- **No attachment reordering.**
- **Only the primary button arms** a drag, by design.
- **Nothing validates `properties`.** It is opaque by contract; if a host sends
  an entity its own renderer cannot handle, that is between the host and its
  renderer.

---

## 12. Acceptance criteria

### Automated (component tests driving synthetic pointer events)

1. **Arming refused** — `startCustomEntityDrag([e])` with no button held returns
   `false`, arms nothing, and leaves no listeners attached.
2. **Arming accepted** — during a real `pointerdown`, it returns `true` and the
   base overlay tier appears.
3. **Payload replacement** — a second call while armed returns `true`, updates
   the overlay labels, and does not re-arm (the pointer lock is unchanged).
4. **Empty payload refused** — `start([])` returns `false` both when idle and
   when a gesture is live, and the live gesture still drops correctly afterwards.
5. **Full drop** — `pointerdown` → arm → `pointermove` into the zone (overlay
   reaches the over tier) → `pointerup` → the entity appears in the composer and
   `onDragCustomEntitiesConsumed` fires exactly once.
6. **Released outside** → `onCustomEntityDragCancelled('released-outside')`,
   nothing attached, overlay gone.
7. **`Escape` and `pointercancel`** → `'cancelled'`, same teardown.
8. **`cancelCustomEntityDrag()`** → teardown with **no** callback at all.
9. **Foreign pointer ignored** — events carrying a different `pointerId` change
   nothing during a live gesture.
10. **De-duplication** — dropping the same entity twice yields one chip with
    `getId`, two without it.
11. **Detach** — the chip × removes the attachment, including for an
    unregistered `type`.
12. **Unknown type** — an unregistered `type` renders the fallback on both
    surfaces and does not throw.
13. **Send with no text** — a message carrying only entities is sendable, and
    sending clears the attachments.

### Manual (what synthetic events cannot cover)

- A real mouse drag from a DOM-sourced object and from a canvas-sourced one.
- A **touch** drag — implicit pointer capture is the case coordinate
  hit-testing exists for, and it is the one synthetic tests fake away.
- A multi-entity drag.
- Releasing outside the browser window; alt-tabbing mid-drag.
- Multi-touch: a second finger during a drag changes nothing.
- The host's own panning still works when a press misses every object.
- Dragging over a dialog or ghost painted above the chat does **not** register
  as over the drop zone (proves the `pointer-events: none` rules are in place).

### Invariant checks

Re-read §5.9 and confirm each of the eight still holds.
