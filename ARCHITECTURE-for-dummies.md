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

> **You call one function to say "a drag is starting right now".
> MagicChat watches the mouse and tells you when it's over.**

The function lives on a ref, and it takes an array:

```tsx
const chatRef = useRef<MagicChatHandle>(null);

chatRef.current.startCustomEntityDrag([car]);   // "I'm dragging a car"
```

That's the entire handshake. You call it once, at the start. You don't tell
MagicChat when the drag ends — it can see that for itself, and it cleans up
after itself.

**"Right now" is literal, and MagicChat checks.** The call only works if a mouse
button or finger is *physically down at that moment*. Call it from a click
handler or a `useEffect` and it does nothing at all, returning `false` to tell
you so. That is deliberate: a drag that isn't a real press isn't a drag.

So: call it from `onPointerDown`. (Or a bit later in the same press — see §8.4.)

---

## 4. The whole flow

```
  1. User presses on your car                  ← you notice this
     you: chatRef.current.startCustomEntityDrag([car])

  2. MagicChat checks a button really is down
     → no?  returns false, nothing happens
     → yes: shows "Drop custom entity here"
            and starts watching the mouse, immediately

  3. Mouse moves over the chat, button still held
     → overlay changes to "Release to attach Car 123"

  4. User lets go
     → MagicChat stops watching and forgets the car, all by itself
     ├── over the chat  → onDragCustomEntitiesConsumed()   ✅ attached
     └── somewhere else → onCustomEntityDragCancelled()    ❌ nothing attached

  5. ...nothing. You're done. It's ready for the next drag already.
```

Exactly **one** of those two callbacks fires, every time — but you don't have to
handle either one. They're there so you can tidy up your *own* stuff, like a
little preview that follows the cursor. MagicChat has already tidied up its own.

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
| `composer` | the *contents* of the small chip, before you hit Send |
| `message` | the bigger card, inside a sent message |

The chip itself — the pill, and the × that takes it back off — is MagicChat's.
What's attached is MagicChat's state, so removing it is MagicChat's button. You
only draw what goes inside.

```
  ┌─────────────────────────────┐
  │  Me:  look at this          │
  │  ┌───────────────────────┐  │
  │  │ 🚗 Car 123            │  │  ← `message` component
  │  │ [Zoom to]             │  │
  │  └───────────────────────┘  │
  ├─────────────────────────────┤
  │  🚗 Car 123 ×               │  ← `composer` fills the chip; × is MagicChat's
  │  [type here...]    [Send]   │
  └─────────────────────────────┘
```

Both get the **whole entity**, so your buttons can do real things — the demo's
"Zoom to" actually flies the map.

---

## 7. The simplest thing that works

Copy-paste this and it runs. One entity type, one drag source, no map.

```tsx
import { useRef } from 'react';
import { MagicChat } from './magic-chat';
import type {
  CustomEntity,
  CustomEntityComponentRegistry,
  MagicChatHandle,
} from './magic-chat';
import './magic-chat/magic-chat.css';

// 1. How to draw a Car. Written OUTSIDE the component on purpose — see §8.
const renderers: CustomEntityComponentRegistry = {
  Car: {
    composer: ({ entity }) => <span>🚗 {entity.properties.name}</span>,
    message: ({ entity }) => <div>🚗 {entity.properties.name}</div>,
    label: (entity) => entity.properties.name,   // what the overlay says
  },
};

// 2. The thing we'll drag. Any JSON you like inside `properties`.
const car: CustomEntity = { type: 'Car', properties: { name: 'Car 123' } };

export function App() {
  const chatRef = useRef<MagicChatHandle>(null);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* 3. The drag source. Any element at all. */}
      <div
        style={{ flex: 1, padding: 40, touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(event) => {
          event.preventDefault();
          // ← this is the entire "start a drag"
          chatRef.current?.startCustomEntityDrag([car]);
        }}
      >
        🚗 press here, drag right, let go over the chat →
      </div>

      {/* 4. The chat. */}
      <div style={{ width: 360 }}>
        <MagicChat ref={chatRef} customEntityComponents={renderers} />
      </div>
    </div>
  );
}
```

Notice there is no `onDragStart`, no `draggable`, no `onDrop` — and no state at
all. One ref, one call.

*(This example was compiled under `strict` and run in the browser — press, drag,
release, twice in a row.)*

---

## 8. The four things that will actually bite you

*(There used to be five. Two of them were about remembering to empty an array
you no longer have — see §11 if you're coming from the old version.)*

### 1. Don't build the renderers inside your component

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

### 2. If you draw something that follows the cursor, make it click-through

```css
.my-drag-ghost { pointer-events: none; }
```

MagicChat figures out "is the mouse over the chat?" by asking the browser *what
is under this point*. If your little drag preview is painted under the cursor, the
answer is always "your preview" and never "the chat", so the drop never happens.

### 3. Put `touch-action: none` on the drag source

Otherwise a finger-drag is treated as *scrolling* the page, and the browser
cancels your drag halfway through. Mouse works fine; touch mysteriously doesn't.

### 4. Call it while the button is still down

```tsx
// ✗ REFUSED — no button is held at any point, so nothing happens
<button onClick={() => chatRef.current?.startCustomEntityDrag([car])}>Drag</button>
useEffect(() => { chatRef.current?.startCustomEntityDrag([car]); }, []);

// ✓ GOOD — the button is physically down when you call
<div onPointerDown={() => chatRef.current?.startCustomEntityDrag([car])}>🚗</div>
```

A drag means *"a button is down right now"* (§3), and MagicChat checks rather than
trusting you. If no button is down the call returns `false` and changes nothing
— no overlay, no listeners, no half-started drag.

> **Symptom:** you call it and absolutely nothing happens.
> **Cause:** you called it outside a press. Log the return value to confirm.

This is the gentlest item on this list, and it's here mostly for the old hands:
in the previous version this was a *prop*, it could be set from anywhere, and
setting it outside a press armed a drop target that then died silently on the
first mouse move. The symptom was an overlay that appeared but never lit up. Now
the call just says no.

You don't have to call it on `pointerdown` *exactly* — anywhere inside the held
gesture is fine, so waiting a few pixels to tell a click from a drag works. The
button just has to still be down.

---

## 9. The overlay has two states

Small thing, worth knowing, because it tells you what MagicChat is thinking:

| What you see | What it means |
| --- | --- |
| "Drop custom entity here" | a drag is happening somewhere — you called `startCustomEntityDrag` and it said yes |
| "Release to attach **Car 123**" + a solid blue border | the button is still down, the mouse is over the chat *right now*, and letting go will work |

The first one is on for exactly as long as the drag is; it cannot get stuck,
because the same thing that shows it is the thing that clears it. The second only
appears when a drop would genuinely land, so it never promises something it can't
do.

If you see neither, the call was refused — §8.4.

---

## 10. Who owns what

The single rule that keeps this tidy:

```
  YOU (the host)                      MAGICCHAT
  ─────────────                       ─────────
  what the user grabbed               did they let go over me?
  what a Car is                       the chat UI
  what a Car looks like               the messages
  your own cursor preview             the drag itself, start to finish
                                      what's attached to the composer
```

The drag used to be on your side of that table. It moved, and that's the whole
change described in §11.

MagicChat never imports anything from your app, and never reads
`entity.properties`. If you ever find yourself wanting to teach MagicChat about
cars, something has gone wrong — pass it a component instead.

---

## 11. Coming from the old version?

The drag used to be announced with a **prop** instead of a call:

```tsx
// OLD
const [dragging, setDragging] = useState<CustomEntity[]>([]);
const stop = () => setDragging([]);

<div onPointerDown={() => setDragging([car])}>🚗</div>
<MagicChat
  dragCustomEntities={dragging}
  onDragCustomEntitiesConsumed={stop}
  onCustomEntityDragCancelled={stop}
  customEntityComponents={renderers}
/>

// NEW
const chatRef = useRef<MagicChatHandle>(null);

<div onPointerDown={() => chatRef.current?.startCustomEntityDrag([car])}>🚗</div>
<MagicChat ref={chatRef} customEntityComponents={renderers} />
```

**Why it changed.** A non-empty array meant "a button is down *right now*" — but
an array is a thing that *stays* set, and a press isn't. Everything awkward about
the old version came from that gap:

- you had to empty the array afterwards, and if you forgot, every later drag
  silently stopped working and the overlay stuck to the chat for ever;
- you had to remember to set it only during a real press, because nothing stopped
  you setting it from a click or an effect — which armed a drag that then died on
  the first mouse move.

A function call can't be left switched on, and this one refuses to run unless a
button really is down. So both problems just stop existing, along with the two
warnings in §8 that used to describe them.

**What to do.** Swap the state for a ref, move your `setDragging([car])` to
`chatRef.current?.startCustomEntityDrag([car])`, and delete the clearing
callbacks. Keep them only if you have your own cursor preview to hide — that's
all they're for now.

---

## Where to go next

| You want to… | Read |
| --- | --- |
| Actually wire it up | [`USAGE.md`](./USAGE.md) |
| Understand the moving parts | [`README.md`](./README.md) |
| Change the code | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Change how the dragging *works* | [`DECISIONS.md`](./DECISIONS.md) — read this one first, several "obvious" simplifications have already been tried and have specific failure modes |
