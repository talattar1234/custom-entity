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
| This file | Learning what the component does and how to use it. |
| [`USAGE.md`](./USAGE.md) | You just want to wire MagicChat into a host — a complete minimal example plus the three things that will bite you. |
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
dragCustomEntities = [{type, properties}]  -->  entities appear
                                                  |
                                                  +- attach document
                                                  |  pointermove / pointerup
                                                  |
                                                  +- pointermove -> hit-test
                                                  |  coordinates -> overlay
                                                  |
                                                  +- pointerup inside?
                                                       |
                      +--------------------------------+
                      v                                v
     onDragCustomEntitiesConsumed        onCustomEntityDragCancelled
                      |                                |
                      +----------> host clears <-------+
                                dragCustomEntities
```

Two rules hold the whole thing together:

- **The host owns detection.** It decides what was pressed and what JSON that
  object is. The source may be a DOM element, a canvas shape, or a WebGL pick.
- **MagicChat owns the drop, and treats entities as opaque.** It reads
  `entity.type` to look up renderers and never touches `entity.properties`,
  whose schema it does not know.

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
  type: string;      // registry key
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

There is no `dragstart`, no `draggable`, no `DataTransfer`. The host simply puts
entities into a prop.

```tsx
const [dragCustomEntities, setDragCustomEntities] = useState<CustomEntity[]>([]);

// on pointerdown over one of its own objects
startDrag([carEntity], event);   // -> setDragCustomEntities([carEntity])
```

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
1. dragCustomEntities becomes non-empty
     -> attach pointermove / pointerup / pointercancel on `document`
2. pointermove -> hit-test the coordinates -> show/hide the overlay
3. pointerup   -> inside the drop zone? consume : cancel. Then go inert.
```

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
phase means nothing in the page can `stopPropagation` them away. They are
attached only while a drag is in flight — there are no listeners at rest.

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
idle  --(entities appear)-->  armed  --(release/cancel)-->  spent
  ^                                                           |
  +------------------ (host clears the array) -----------------+
```

Once the pointer is released, MagicChat is inert regardless of what the prop
still holds. That makes consumption idempotent without session ids or reference
tracking: a stale array plus a stray click can never re-consume the entities.

**Contract: the host must clear `dragCustomEntities` before the next drag.** A
host that forgets gets a loud, obvious failure — the second drag does nothing —
rather than a silent stale re-attach.

---

## How renderers are registered

Each entity type supplies two components. Both receive the **full** entity, so
they can read any property and run entity-specific actions.

```tsx
const customEntityTypes = useMemo(() => ({
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
  customEntityTypes={customEntityTypes}
  dragCustomEntities={dragCustomEntities}
  onDragCustomEntitiesConsumed={(entities) => setDragCustomEntities([])}
  onCustomEntityDragCancelled={(reason) => setDragCustomEntities([])}
/>
```

Exactly one of the two fires for every gesture, so the host has a single place
to clear its state. The demo's toolbar shows the last outcome live.

`onCustomEntityDragCancelled` is worth handling even if you also clear from your
own `pointerup`: on `pointercancel` (common on touch, when the browser decides
the gesture was a scroll) or when the pointer is released outside the window,
your own `pointerup` may never fire — and then the array would stay populated
and no future drag could arm.

### Edge cases and what happens

| Situation | Behaviour |
| --- | --- |
| Released inside the chat | Entities attached to the composer; `onDragCustomEntitiesConsumed`. |
| Released outside the chat | Nothing attached; `onCustomEntityDragCancelled('released-outside')`. |
| `pointercancel`, window blur, or `Escape` | Overlay cleared; `onCustomEntityDragCancelled('cancelled')`. |
| Host changes the array mid-drag | The array is the live source of truth; whatever it holds at release is consumed. |
| Host empties the array mid-drag | Overlay disappears, no callback — the host caused it and already knows. |
| Host never clears the array | The next drag does not arm. Deliberate; see "One drop per arming". |
| A second pointer touches down mid-drag | Ignored. MagicChat latches the first pointer id it sees and filters on it. |
| Array populated with no button held | The first mouse move ends the gesture, so no overlay appears. |
| Unknown `entity.type` | Generic fallback chip; no throw. |

---

## Multiple entities

`dragCustomEntities` is an array throughout — nothing assumes one entity. The
toolbar's "Drag group" source carries a Car and an Area together; the overlay
reads "Drop 2 custom entities here" and both chips land in the composer.

---

## Also available

An imperative handle, for attaching entities without a drag (a "Send to chat"
button, or keyboard accessibility):

```tsx
const chatRef = useRef<MagicChatHandle>(null);
chatRef.current?.attachEntities([carEntity]);
chatRef.current?.clearComposer();
chatRef.current?.focus();
```

`useCustomEntityDropTarget` is exported on its own. It knows nothing about chat
and can turn any element into a drop target for host-driven pointer drags.

### Extension point

For an app with many drop targets, or React roots that do not share a tree, a
module-level drag manager (`customEntityDrag.start(entities)`) removes the prop
plumbing. It was not used here: shared mutable module state is harder to test
and breaks if two copies of the package end up bundled. The prop-driven flow is
more idiomatic, and the imperative handle covers the same need.

---

## Scope

Mock chat only — no backend, no persistence, no message editing. Sending appends
to local state. Map tiles come from OpenStreetMap; without network access the map
renders grey but the drag demo is unaffected.
