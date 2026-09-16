# MagicChat — custom entity drag & drop (POC)

Drag an object out of a host application (here, a Leaflet map) into a chat
component, attach it to a message, and let the host render it — in the composer
before sending, and inside the sent message.

```
npm install
npm run dev      # http://localhost:5173
```

Press and hold the car, the aircraft or the amber area on the map, drag onto the
chat, release. The toolbar also has a "Drag group" source that carries two
entities at once.

### Further reading

| Document | Read it when |
| --- | --- |
| [`ARCHITECTURE-for-dummies.md`](./ARCHITECTURE-for-dummies.md) | You are new to this and want it in plain English, with a runnable minimal example. |
| This file | Learning what the component does and how to use it. |
| [`USAGE.md`](./USAGE.md) | You just want to wire MagicChat into a host — a complete minimal example plus the two things that will bite you. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Before changing the code: module map, state ownership, invariants, extension recipes, pitfalls. |
| [`DECISIONS.md`](./DECISIONS.md) | Before changing the *mechanism*: what was rejected and why. Several obvious simplifications have specific failure modes. |

---

## Architecture

```
HOST APPLICATION                              MAGICCHAT
----------------                              ---------
pointerdown on a map object
  |
  |  host hit-tests its own objects
  v
chatRef.current.startCustomEntityDrag(     -->  is a button held?
  [{type, properties}]                            no  -> refuse, return false
)                                                 yes -> arm, and attach on
                                                  |      document, immediately:
                                                  |      pointermove / pointerup
                                                  |
                                                  +- pointermove -> hit-test
                                                  |  coordinates -> overlay
                                                  |
                                                  +- pointerup inside?
                                                  |
                                                  +- disarm; payload cleared
                                                       |
                      +--------------------------------+
                      v                                v
     onDragCustomEntitiesConsumed        onCustomEntityDragCancelled
                      |                                |
                      +------> host hides its ghost <--+
                          (the chat already reset itself)
```

Two rules hold the whole thing together:

- **The host owns detection.** It decides what was pressed and what JSON that
  object is. The source may be a DOM element, a canvas shape, or a WebGL pick.
- **MagicChat owns the drag, the drop, and nothing about your data.** It holds
  the payload for the duration of the gesture and disarms itself on release — so
  the host has no drag state to keep in sync — and it reads `entity.type` to
  look up renderers, never `entity.properties`, whose schema it does not know.

### Layout

| Path | Contents |
| --- | --- |
| `src/magic-chat/` | The component. This is the part that could become an npm package; it imports nothing from `host/`. |
| `src/magic-chat/useCustomEntityDropTarget.ts` | The drag/drop mechanism. Start here. |
| `src/host/` | The demo application: map, drag sources, entity renderers. |

---

## The entity model

```ts
interface CustomEntity<P = object> {
  type: string;      // key into `customEntityComponents`
  properties: P;     // opaque to MagicChat
}
```

```json
{
  "type": "Car",
  "properties": {
    "id": "car-123",
    "name": "Car 123",
    "latitude": 31.7683,
    "longitude": 35.2137,
    "status": "active"
  }
}
```

---

## How the host starts a drag

There is no `dragstart`, no `draggable`, no `DataTransfer`, and no drag state to
keep. The host makes one call, while the button is still down.

```tsx
const chatRef = useRef<MagicChatHandle>(null);

// on pointerdown over one of its own objects
chatRef.current?.startCustomEntityDrag([carEntity]);
```

The call returns `false` if no button is held — a drag cannot be announced from
a click, an effect, or a timer — so "armed" always means a real gesture is under
way. That guard is the reason there is nothing to clear afterwards; see
[`DECISIONS.md`](./DECISIONS.md) §15.

`src/host/MapPanel.tsx` shows the two kinds of source in one function,
`findEntityAt`:

- **DOM source** — the Car and Aircraft are Leaflet markers, so
  `event.target.closest('[data-entity-id]')` identifies them.
- **Canvas source** — the Area is drawn with `L.canvas()`, so it has *no DOM
  element at all*. The host hit-tests it itself with a point-in-polygon test on
  container coordinates. This is the case native HTML5 drag & drop cannot serve,
  and the reason this POC exists.

Three things the host must do when a drag begins:

```ts
event.preventDefault();      // don't let the browser turn a touch into a scroll
event.stopPropagation();     // don't let Leaflet start panning
map.dragging.disable();
```

And one CSS requirement: the host's drag ghost must be `pointer-events: none`
(see below).

---

## How MagicChat detects the drop

```
1. startCustomEntityDrag(entities), with a button held
     -> paint the overlay ("Drop custom entity here")
     -> attach pointermove / pointerup / pointercancel on `document`,
        synchronously, inside the call
2. pointermove -> hit-test the coordinates
     -> inside? intensify the overlay to "Release to attach <label>"
3. pointerup   -> inside the drop zone? consume : cancel.
     -> then disarm, detach, clear the payload
```

Note which signal drives which tier. **Visibility is the armed state:** the
overlay is painted for the whole gesture, no pointer movement required, and it
cannot outlive the gesture because the same state drives both. **The named tier
follows the hit test**, which is strictly narrower, so the component never says
"release here" about a release that would not land.

Because the listeners go on in the call rather than in an effect, there is no
render between the press and the target being live — the very first
`pointermove` is seen.

### Why coordinates, not onPointerEnter / onPointerLeave

Native enter/leave on the chat element would be simpler, and it does work for a
mouse when the host takes no pointer capture. It fails in the two cases this
component has to support:

- **Touch and pen implicitly capture** the pointer to the element that received
  `pointerdown`. Every later move and up for that gesture is delivered *there*,
  so the chat element never sees them.
- **`setPointerCapture`** does the same explicitly, and it is the normal way to
  drag a canvas object — you need it to keep receiving moves once the pointer
  leaves the canvas.

So the hit test is:

```ts
const element = document.elementFromPoint(event.clientX, event.clientY);
const isOver = !!element && !!dropZoneRef.current?.contains(element);
```

`elementFromPoint` is plain render-tree hit-testing and is unaffected by pointer
capture, which is exactly why it is the right tool. It also beats comparing
against `getBoundingClientRect()`, because a rect test reports "inside" even
when a dialog or the drag ghost is painted on top of the chat.

**Consequence — two elements must be `pointer-events: none`:** MagicChat's own
overlay, and the host's drag ghost. Either one would otherwise be the topmost
element at every hit test. Both are commented as such in the CSS.

### Listeners on document, capture phase

Element-level listeners cannot work, for the reasons above, and MagicChat also
needs to see releases *outside* itself in order to reset its overlay. Capture
phase means nothing in the page can `stopPropagation` them away. These five are
attached only while a drag is in flight.

Four cheaper ones *are* always attached — `pointerdown` / `pointerup` /
`pointercancel` on `document` plus `blur` on `window` — tracking whether a
button is currently held. That is what lets `startCustomEntityDrag` refuse a
call made outside a real press, and it is also how the gesture knows which
`pointerId` to lock onto from its very first event.

`pointerup` re-runs the hit test on its own coordinates rather than trusting the
last `pointermove`, so the decision can never be a frame stale.

### No requestAnimationFrame

`pointermove` is native and browsers already coalesce it to roughly one per
frame. Throttling would only defer the `elementFromPoint` layout read, at the
cost of a frame of latency. Instead the handler hit-tests on every move but
calls `setState` **only when the answer changes** — that removes the per-move
re-render, which is the cost that actually matters. If hit-testing ever shows up
in a profile, cache `getBoundingClientRect()` at drag start as a fast reject.

### One drop per arming

```
idle  --(startCustomEntityDrag, button held)-->  armed
  ^                                                |
  +---------------- (release / cancel) ------------+
```

One call permits at most one drop, and the gesture returns itself to `idle`
before either callback fires. Consumption is idempotent without session ids or
reference tracking, and **there is no contract for the host to honour** — no
array to clear, nothing that can be left set. A host that ignores both resolve
callbacks still drags correctly for ever; the only casualty is its own drag
ghost, which would stay on screen.

Calling `startCustomEntityDrag` again while armed replaces the payload without
re-arming, so a selection can grow mid-drag. An empty array is always refused,
which is why aborting is `cancelCustomEntityDrag()` rather than passing `[]`.

---

## How renderers are registered

Each entity type supplies two components. Both receive the **full** entity, so
they can read any property and run entity-specific actions.

```tsx
const customEntityComponents = useMemo(() => ({
  Car: {
    composer: CarChip,                                            // chip before sending
    message: (props) => <CarCard {...props} zoomTo={zoomTo} />,   // inside a message
    label: (entity) => entity.properties.name,                    // used by the overlay
    getId: (entity) => entity.properties.id,                      // optional de-duplication
  },
  // Aircraft, Area ...
}), [zoomTo]);
```

```tsx
function CarCard({ entity, zoomTo }) {
  const { name, latitude, longitude, id } = entity.properties;
  return (
    <div>
      <span>{name}</span>
      <button onClick={() => zoomTo(latitude, longitude, id)}>Zoom to</button>
    </div>
  );
}
```

The `Zoom to` buttons in this demo really do fly the Leaflet map to the object
and flash it. That behaviour lives entirely in the host's renderer — MagicChat
only rendered a component it was handed.

Notes:

- `useMemo` plus a `useCallback`-stable `zoomTo` matter. An inline arrow
  recreated on every render is a *new component type* each time, and React would
  remount every renderer instead of updating it.
- `label` is what the drop overlay and the drag ghost display. Without it,
  MagicChat falls back to `entity.type`.
- `getId` is optional and opt-in: only the host can say what makes two entities
  the same, because only the host knows the schema.
- An unregistered `type` never throws — it renders a generic fallback chip,
  which `renderUnknownEntity` can replace.
- React keys for attachments come from an `instanceId` that MagicChat generates.
  It deliberately does not use `properties.id`: it cannot assume such a field
  exists.

---

## How the host learns the entities were consumed

```tsx
<MagicChat
  ref={chatRef}
  customEntityComponents={customEntityComponents}
  onDragCustomEntitiesConsumed={(entities) => hideGhost()}
  onCustomEntityDragCancelled={(reason) => hideGhost()}
/>
```

Exactly one of the two fires for every gesture, so the host has a single place to
retire its drag chrome. Both are *informational* — the chat has already disarmed
itself by the time they run — so nothing breaks if you skip them. The demo's
debug bar shows the last outcome live.

`onCustomEntityDragCancelled` is still worth handling even if you also tear down
from your own `pointerup`: on `pointercancel` (common on touch, when the browser
decides the gesture was a scroll) or when the pointer is released outside the
window, your own `pointerup` may never fire — and then your ghost would be
stranded.

### Edge cases and what happens

| Situation | Behaviour |
| --- | --- |
| Released inside the chat | Entities attached to the composer; `onDragCustomEntitiesConsumed`. |
| Released outside the chat | Nothing attached; `onCustomEntityDragCancelled('released-outside')`. |
| `pointercancel`, window blur, or `Escape` | Overlay cleared; `onCustomEntityDragCancelled('cancelled')`. |
| Host calls `startCustomEntityDrag` again mid-drag | Payload replaced, pointer lock untouched, no re-arm. Whatever it holds at release is consumed. |
| Host calls `startCustomEntityDrag([])` | Refused, and a live gesture is left alone. Use `cancelCustomEntityDrag()` to abort. |
| Host calls `cancelCustomEntityDrag()` | Overlay clears, latch returns to `idle`, neither callback fires — the host caused it and already knows. |
| Host never handles either callback | The drag still works, every time. Only the host's own ghost is left stranded. |
| A second pointer touches down mid-drag | Ignored. The gesture is locked to the pointer that was held when `startCustomEntityDrag` was called. |
| `startCustomEntityDrag` called with no button held | Refused: returns `false`, arms nothing, paints nothing, and ticks `refusedStarts` in the debug snapshot. Call it from `pointerdown` — or later in the same held gesture — not from a click, an effect, or a Storybook arg. |
| Unknown `entity.type` | Generic fallback chip; no throw. |

---

## Multiple entities

The payload is an array throughout — nothing assumes one entity. The toolbar's
"Drag group" source carries a Car and an Area together; the overlay reads
"Release to attach Car 123 and Area A" and both chips land in the composer.

```tsx
chatRef.current?.startCustomEntityDrag([carEntity, areaEntity]);
```

---

## Also available

The rest of the imperative handle — including the non-drag path, for a "Send to
chat" button or keyboard accessibility:

```tsx
const chatRef = useRef<MagicChatHandle>(null);
chatRef.current?.startCustomEntityDrag([carEntity]);  // the drag contract
chatRef.current?.cancelCustomEntityDrag();            // abandon it, silently
chatRef.current?.attachEntities([carEntity]);         // no drag at all
chatRef.current?.clearComposer();
chatRef.current?.focus();
```

`cancelCustomEntityDrag` is an escape hatch you will probably never need: every
ordinary reason to abort mid-gesture — release, `pointercancel`, blur, Escape —
is already handled for you. `DECISIONS.md` §15 has the full table.

`useCustomEntityDropTarget` is exported on its own. It knows nothing about chat
and can turn any element into a drop target for host-driven pointer drags.

### Extension point

Many drop targets is now a solved case rather than an extension point: a call has
an addressee, so the host arms the target it means — `chatRef` here,
`reportRef` there, or both — and each keeps its own latch. See
`ARCHITECTURE.md` §6.

A module-level drag manager (`customEntityDrag.start(entities)`) would remove the
ref plumbing for React roots that do not share a tree. Still not used here:
shared mutable module state is harder to test and breaks if two copies of the
package end up bundled. `DECISIONS.md` §7 has the reasoning.

---

## Scope

Mock chat only — no backend, no persistence, no message editing. Sending appends
to local state. Map tiles come from OpenStreetMap; without network access the map
renders grey but the drag demo is unaffected.
