# Using MagicChat — minimal example

The smallest host that can drag an entity into the chat. One entity type, one
drag source, no map. Copy it into a file and it runs.

For the full picture see [`README.md`](./README.md); for the internals,
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## The whole thing

```tsx
import { useMemo, useRef } from 'react';
import { MagicChat } from './magic-chat';
import type {
  CustomEntity,
  CustomEntityComposerProps,
  CustomEntityMessageProps,
  CustomEntityComponentRegistry,
  MagicChatHandle,
} from './magic-chat';
import './magic-chat/magic-chat.css';

/* 1 ── The entity. Any JSON; MagicChat never looks inside `properties`. */

interface CarProperties {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}
type CarEntity = CustomEntity<CarProperties>;

const car: CarEntity = {
  type: 'Car',
  properties: { id: 'car-123', name: 'Car 123', latitude: 31.7683, longitude: 35.2137 },
};

/* 2 ── Two renderers: the chip before sending, the card inside a message. */

// Content only. MagicChat draws the chip around this and puts the × on it —
// detaching is its state, so it offers the control. (`remove` is still in the
// props if you want a second detach affordance of your own; most hosts don't.)
function CarChip({ entity }: CustomEntityComposerProps<CarEntity>) {
  return <span>🚗 {entity.properties.name}</span>;
}

function CarCard({ entity }: CustomEntityMessageProps<CarEntity>) {
  const { name, latitude, longitude } = entity.properties;
  return (
    <div>
      <strong>🚗 {name}</strong>
      <button onClick={() => console.log('zoom to', latitude, longitude)}>Zoom to</button>
    </div>
  );
}

/* 3 ── The host. */

export function App() {
  const chatRef = useRef<MagicChatHandle>(null);

  // Must be memoised — see "Two things that will bite you" below.
  const customEntityComponents: CustomEntityComponentRegistry = useMemo(
    () => ({
      Car: {
        composer: CarChip,
        message: CarCard,
        label: (entity: CarEntity) => entity.properties.name,
      },
    }),
    [],
  );

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* The drag source. Any element, or a canvas hit-test result. */}
      <div
        style={{ flex: 1, padding: 40, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(event) => {
          event.preventDefault();  // stop the browser scrolling on touch
          // That is the entire "start a drag". No state, nothing to clear.
          chatRef.current?.startCustomEntityDrag([car]);
        }}
      >
        🚗 press and drag me into the chat →
      </div>

      <div style={{ width: 400 }}>
        <MagicChat ref={chatRef} customEntityComponents={customEntityComponents} />
      </div>
    </div>
  );
}
```

That's it. No `dragstart`, no `draggable`, no `DataTransfer`, no drop handler on
the chat — and no drag state in your component. The host announces the drag with
one call and MagicChat watches for the release itself, disarming when it comes.

Add `onDragCustomEntitiesConsumed` / `onCustomEntityDragCancelled` if you want
to know how it ended — for instance to hide a drag ghost. Exactly one fires per
gesture, and both are purely informational: the chat has already reset itself by
the time they run.

---

## What just happened

```
onPointerDown           → chatRef.current.startCustomEntityDrag([car])
                            │
                            ▼
MagicChat checks a button is actually held  → if not, returns false, does nothing
  → paints the drop overlay, and attaches pointermove / pointerup on `document`
    — synchronously, inside the call, so the first move is never missed
  → pointermove: hit-tests the coordinates, names the entity in the overlay
  → pointerup:   inside the chat? attach to composer : ignore
  → then disarms itself: listeners off, payload cleared, ready for the next drag
                            │
                            ▼
onDragCustomEntitiesConsumed   (dropped)
onCustomEntityDragCancelled    (released outside, Escape, pointercancel, blur)
   — optional; the chat is already back at rest when these run
```

---

## Two things that will bite you

**1. Memoise the registry.** An inline object recreated every render means
`composer` and `message` are *new component types* every time, so React
unmounts and remounts your renderers instead of updating them — focus, local
state and animations all reset, and it looks like a rendering bug.

```tsx
// ✗ remounts every renderer on every render
<MagicChat customEntityComponents={{ Car: { composer: CarChip, message: CarCard } }} … />

// ✓
const customEntityComponents = useMemo(() => ({ Car: { … } }), []);
```

If a renderer needs host behaviour, inject it with a stable callback:

```tsx
const zoomTo = useCallback((lat: number, lng: number) => map.flyTo(lat, lng), [map]);

const customEntityComponents = useMemo(() => ({
  Car: {
    composer: CarChip,
    message: (props) => <CarCard {...props} zoomTo={zoomTo} />,
  },
}), [zoomTo]);
```

**2. Your drag ghost must be `pointer-events: none`.** If you render something
that follows the cursor, MagicChat's `document.elementFromPoint` hit test will
return your ghost on every frame instead of the chat, and the drop will never
register.

```css
.my-drag-ghost { pointer-events: none; }
```

Also set `touch-action: none` on the drag source, or the browser claims a
touch-drag as a scroll and fires `pointercancel` mid-gesture.

### And one rule, which the component enforces for you

**Call `startCustomEntityDrag` while the button is still down.** From
`onPointerDown`, or later in the same held gesture — waiting a few pixels to
tell a click from a drag is fine. From a click handler, an effect, or a timer
after the release it is *refused*: it returns `false`, arms nothing, and paints
nothing.

```tsx
// ✗ refused — no button is held at any point
<button onClick={() => chatRef.current?.startCustomEntityDrag([car])}>Drag</button>

// ✓ the button is physically down
<div onPointerDown={() => chatRef.current?.startCustomEntityDrag([car])}>🚗</div>
```

This used to be a footgun rather than a rule: the old API took a
`dragCustomEntities` prop, which *could* be set from anywhere, and doing so
armed a drop target with no gesture behind it — it then died silently on the
first mouse move. Now the call just says no. Check its return value if you want
to know, or watch `refusedStarts` in the debug snapshot.

---

## Adding a second entity type

Add a key. Nothing else changes.

```tsx
const customEntityComponents = useMemo(() => ({
  Car:  { composer: CarChip,  message: CarCard },
  Area: { composer: AreaChip, message: AreaCard },
}), []);
```

An entity whose `type` is not in the registry does not throw — it renders a
generic fallback chip.

## Dragging several entities at once

The payload is an array the whole way through:

```tsx
chatRef.current?.startCustomEntityDrag([car, area]);
```

Calling it again while the drag is live replaces the payload, so a selection can
grow mid-gesture.

The overlay reads "Release to attach Car 123 and Area A" and both chips land in the
composer.

## When the source is a canvas or WebGL object

Nothing changes on the MagicChat side — this is the case the design exists for.
Hit-test it yourself on `pointerdown` and make the call:

```tsx
const onPointerDown = (event: React.PointerEvent) => {
  const hit = myRenderer.pick(event.clientX, event.clientY); // your own hit test
  if (!hit) return;
  event.preventDefault();
  chatRef.current?.startCustomEntityDrag([toEntity(hit)]);
};
```

`src/host/MapPanel.tsx` does exactly this for a Leaflet canvas polygon, next to
the DOM-marker path, in one function.

## Optional extras

```tsx
// Attach without a drag — a "Send to chat" button, or keyboard accessibility.
chatRef.current?.attachEntities([car]);

// Abandon a drag you started. Silent: neither resolve callback fires. You will
// probably never need it — release, pointercancel, blur and Escape are all
// handled for you already.
chatRef.current?.cancelCustomEntityDrag();

// De-duplicate in the composer. Only you know what makes two entities equal.
Car: { composer: CarChip, message: CarCard, getId: (e) => e.properties.id }

// Seed the mock conversation, and observe sends.
<MagicChat initialMessages={seed} onSendMessage={(m) => console.log(m)} … />

// Live diagnostics — what the demo's floating debug panel renders.
<MagicChat onDebugChange={setChatDebug} … />
```
