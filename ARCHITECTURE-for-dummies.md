# MagicChat, explained simply

The plain-English version. `ARCHITECTURE.md` is the precise one; this is the one
you read first.

---

## 1. What is this?

You have an app with stuff in it — pins on a map, shapes, rows in a table. You
want the user to **drag one of those things into a chat box** and send it as part
of a message.

That's it. That's the whole product.

```
   YOUR APP                            THE CHAT
   ┌──────────────┐                   ┌──────────────┐
   │              │                   │              │
   │    🚗  ──────┼─── drag it ──────►│  🚗 Car 123  │
   │              │                   │  [ Send ]    │
   └──────────────┘                   └──────────────┘
```

MagicChat is the chat box. **You** are "the host" — your app.

---

## 2. Why isn't this just HTML drag & drop?

Because browsers can only drag **real HTML elements**.

If your map pin is drawn on a `<canvas>` (or in WebGL), it isn't an element. It's
just *paint*. There is no tag to grab, so `draggable="true"` has nothing to
attach to. Also, HTML5 drag & drop doesn't work on touchscreens.

So we do it by hand, with mouse/finger position. That one constraint explains
almost every odd-looking thing in this codebase.

---

## 3. The one idea you need

There is no "drag event". Instead:

> **You put things in a prop to say "a drag is happening".
> MagicChat watches the mouse and tells you when it's over.**

The prop is called `dragCustomEntities`. It's an array.

```
  dragCustomEntities = []          →  nothing happening
  dragCustomEntities = [car]       →  "I am dragging a car right now"
```

That's the entire handshake. You set the array; you empty it when told.

---

## 4. The whole flow

```
  1. User presses on your car                  ← you notice this
     you: setDragging([car])

  2. MagicChat sees a non-empty array
     → shows "Drop custom entity here"
     → starts watching the mouse

  3. Mouse moves over the chat
     → overlay changes to "Drop Car 123 here"

  4. User lets go
     ├── over the chat  → onDragCustomEntitiesConsumed()   ✅ attached
     └── somewhere else → onCustomEntityDragCancelled()    ❌ nothing attached

  5. you: setDragging([])          ← ALWAYS. see §8.
```

Exactly **one** of those two callbacks fires, every time. So you can do the same
thing in both: empty the array.

---

## 5. What is an "entity"?

Any JSON you want, with a `type` label stuck on it:

```ts
{
  type: 'Car',                        // ← MagicChat reads ONLY this
  properties: { name: 'Car 123' }     // ← MagicChat never looks in here
}
```

`properties` can hold anything — ids, coordinates, nested objects, whatever your
app already has.

**MagicChat has no idea what a Car is.** It reads `type` to look up which of your
components to draw, and that is genuinely all it does with your data. That is why
*you* supply the renderers (next section).

---

## 6. You supply the drawings

MagicChat doesn't know what a car looks like, so you give it two components per
type:

| Component | Where it shows up |
| --- | --- |
| `composer` | the small chip, before you hit Send |
| `message` | the bigger card, inside a sent message |

```
  ┌─────────────────────────────┐
  │  Me:  look at this          │
  │  ┌───────────────────────┐  │
  │  │ 🚗 Car 123            │  │  ← `message` component
  │  │ [Zoom to]             │  │
  │  └───────────────────────┘  │
  ├─────────────────────────────┤
  │  🚗 Car 123 ×               │  ← `composer` component
  │  [type here...]    [Send]   │
  └─────────────────────────────┘
```

Both get the **whole entity**, so your buttons can do real things — the demo's
"Zoom to" actually flies the map.

---

## 7. The simplest thing that works

Copy-paste this and it runs. One entity type, one drag source, no map.

```tsx
import { useState } from 'react';
import { MagicChat } from './magic-chat';
import type { CustomEntity, CustomEntityComponentRegistry } from './magic-chat';
import './magic-chat/magic-chat.css';

// 1. How to draw a Car. Written OUTSIDE the component on purpose — see §8.
const renderers: CustomEntityComponentRegistry = {
  Car: {
    composer: ({ entity, remove }) => (
      <span>
        🚗 {entity.properties.name} <button onClick={remove}>×</button>
      </span>
    ),
    message: ({ entity }) => <div>🚗 {entity.properties.name}</div>,
    label: (entity) => entity.properties.name,   // what the overlay says
  },
};

// 2. The thing we'll drag. Any JSON you like inside `properties`.
const car: CustomEntity = { type: 'Car', properties: { name: 'Car 123' } };

export function App() {
  const [dragging, setDragging] = useState<CustomEntity[]>([]);
  const stopDragging = () => setDragging([]);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* 3. The drag source. Any element at all. */}
      <div
        style={{ flex: 1, padding: 40, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging([car]);        // ← this is the entire "start a drag"
        }}
      >
        🚗 press here, drag right, let go over the chat →
      </div>

      {/* 4. The chat. */}
      <div style={{ width: 360 }}>
        <MagicChat
          customEntityComponents={renderers}
          dragCustomEntities={dragging}
          onDragCustomEntitiesConsumed={stopDragging}   // dropped on the chat
          onCustomEntityDragCancelled={stopDragging}    // dropped anywhere else
        />
      </div>
    </div>
  );
}
```

Notice there is no `onDragStart`, no `draggable`, no `onDrop`. Just a piece of
state and two callbacks that both empty it.

*(This example was compiled under `strict` and run in the browser — press, drag,
release, twice in a row.)*

---

## 8. The four things that will actually bite you

### 1. Always empty the array

Handle **both** callbacks, not just the "consumed" one.

MagicChat allows **one drop per non-empty array**. If you only clear on a
successful drop, then a drag released outside the chat leaves your array full
forever — and after that, nothing works and the drop overlay is stuck on screen.

> **Symptom:** the blue "Drop custom entity here" panel won't go away, and
> dragging does nothing.
> **Cause:** this. Every time.

This is deliberate: a stuck overlay is easy to spot. The alternative design
silently re-attached the same car twice, which is much harder to notice.

### 2. Don't build the renderers inside your component

```tsx
// ✗ BAD — new objects every render, React throws your components away and
//         rebuilds them, so they lose focus and state and look glitchy
<MagicChat customEntityComponents={{ Car: { composer: CarChip, message: CarCard } }} />

// ✓ GOOD — write it at the top of the file, outside the component (as in §7)
const renderers = { Car: { composer: CarChip, message: CarCard } };

// ✓ ALSO GOOD — if the renderers need something from your component, useMemo it
const renderers = useMemo(() => ({ Car: { … } }), [zoomTo]);
```

Outside the component is simplest, and works because the object is then created
exactly once.

### 3. If you draw something that follows the cursor, make it click-through

```css
.my-drag-ghost { pointer-events: none; }
```

MagicChat figures out "is the mouse over the chat?" by asking the browser *what
is under this point*. If your little drag preview is painted under the cursor, the
answer is always "your preview" and never "the chat", so the drop never happens.

### 4. Put `touch-action: none` on the drag source

Otherwise a finger-drag is treated as *scrolling* the page, and the browser
cancels your drag halfway through. Mouse works fine; touch mysteriously doesn't.

---

## 9. The overlay has two states

Small thing, worth knowing, because it tells you what MagicChat is thinking:

| What you see | What it means |
| --- | --- |
| "Drop custom entity here" | your array isn't empty — a drag is happening somewhere |
| "Drop **Car 123** here" + a stronger border | the mouse is over the chat *right now*, and letting go will work |

The first one just follows your prop. The second one only appears when a drop
would genuinely land, so it never promises something it can't do.

---

## 10. Who owns what

The single rule that keeps this tidy:

```
  YOU (the host)                      MAGICCHAT
  ─────────────                       ─────────
  what the user grabbed               did they let go over me?
  what a Car is                       the chat UI
  what a Car looks like               the messages
  the drag array                      what's attached to the composer
```

MagicChat never imports anything from your app, and never reads
`entity.properties`. If you ever find yourself wanting to teach MagicChat about
cars, something has gone wrong — pass it a component instead.

---

## Where to go next

| You want to… | Read |
| --- | --- |
| Actually wire it up | [`USAGE.md`](./USAGE.md) |
| Understand the moving parts | [`README.md`](./README.md) |
| Change the code | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Change how the dragging *works* | [`DECISIONS.md`](./DECISIONS.md) — read this one first, several "obvious" simplifications have already been tried and have specific failure modes |
