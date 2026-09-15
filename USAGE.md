# Using MagicChat — minimal example

The smallest host that can drag an entity into the chat. One entity type, one
drag source, no map. Copy it into a file and it runs.

For the full picture see [`README.md`](./README.md); for the internals,
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## The whole thing

```tsx
import { useCallback, useMemo, useState } from 'react';
import { MagicChat } from './magic-chat';
import type {
  CustomEntity,
  CustomEntityComposerProps,
  CustomEntityMessageProps,
  CustomEntityComponentRegistry,
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

function CarChip({ entity, remove }: CustomEntityComposerProps<CarEntity>) {
  return (
    <span>
      🚗 {entity.properties.name}
      <button onClick={remove}>×</button>
    </span>
  );
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
  const [dragCustomEntities, setDragCustomEntities] = useState<CustomEntity[]>([]);

  // Must be memoised — see "Three things that will bite you" below.
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

  // Clear the payload on either outcome, so the next drag can arm.
  const clearDrag = useCallback(() => setDragCustomEntities([]), []);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* The drag source. Any element, or a canvas hit-test result. */}
      <div
        style={{ flex: 1, padding: 40, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(event) => {
          event.preventDefault();       // stop the browser scrolling on touch
          setDragCustomEntities([car]); // that is the entire "start a drag"
        }}
      >
        🚗 press and drag me into the chat →
      </div>

      <div style={{ width: 400 }}>
        <MagicChat
          customEntityComponents={customEntityComponents}
          dragCustomEntities={dragCustomEntities}
          onDragCustomEntitiesConsumed={clearDrag}
          onCustomEntityDragCancelled={clearDrag}
        />
      </div>
    </div>
  );
}
```

That's it. There is no `dragstart`, no `draggable`, no `DataTransfer`, and no
drop handler on the chat — the host announces the drag by setting a prop, and
MagicChat watches for the release itself.

---

## What just happened

```
onPointerDown           → setDragCustomEntities([car])
                            │
                            ▼
MagicChat sees a non-empty array
  → paints the drop overlay, and attaches pointermove / pointerup on `document`
  → pointermove: hit-tests the coordinates, names the entity in the overlay
  → pointerup:   inside the chat? attach to composer : ignore
                            │
                            ▼
onDragCustomEntitiesConsumed   (dropped)
onCustomEntityDragCancelled    (released outside, Escape, pointercancel, blur)
                            │
                            ▼
clearDrag() → setDragCustomEntities([]) → ready for the next drag
```

---

## Three things that will bite you

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

**2. Always clear the array.** MagicChat allows **one drop per non-empty
period**, and it paints its drop overlay for as long as the array is non-empty.
If you only clear in `onDragCustomEntitiesConsumed`, a drag released outside the
chat leaves the array populated — so the overlay stays stranded on top of the
chat and *no future drag will arm*. Handle both callbacks, as the example does.

A drop overlay that will not go away is the symptom, and this is always the
cause.

**3. Your drag ghost must be `pointer-events: none`.** If you render something
that follows the cursor, MagicChat's `document.elementFromPoint` hit test will
return your ghost on every frame instead of the chat, and the drop will never
register.

```css
.my-drag-ghost { pointer-events: none; }
```

Also set `touch-action: none` on the drag source, or the browser claims a
touch-drag as a scroll and fires `pointercancel` mid-gesture.

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

The prop is an array the whole way through:

```tsx
setDragCustomEntities([car, area]);
```

The overlay reads "Release to attach Car 123 and Area A" and both chips land in the
composer.

## When the source is a canvas or WebGL object

Nothing changes on the MagicChat side — this is the case the design exists for.
Hit-test it yourself on `pointerdown` and set the prop:

```tsx
const onPointerDown = (event: React.PointerEvent) => {
  const hit = myRenderer.pick(event.clientX, event.clientY); // your own hit test
  if (!hit) return;
  event.preventDefault();
  setDragCustomEntities([toEntity(hit)]);
};
```

`src/host/MapPanel.tsx` does exactly this for a Leaflet canvas polygon, next to
the DOM-marker path, in one function.

## Optional extras

```tsx
// Attach without a drag — a "Send to chat" button, or keyboard accessibility.
const chatRef = useRef<MagicChatHandle>(null);
chatRef.current?.attachEntities([car]);

// De-duplicate in the composer. Only you know what makes two entities equal.
Car: { composer: CarChip, message: CarCard, getId: (e) => e.properties.id }

// Seed the mock conversation, and observe sends.
<MagicChat initialMessages={seed} onSendMessage={(m) => console.log(m)} … />

// Live diagnostics — what the demo's floating debug panel renders.
<MagicChat onDebugChange={setChatDebug} … />
```
