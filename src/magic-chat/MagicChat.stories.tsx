import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { action } from 'storybook/actions';
import { expect, fn, waitFor, within } from 'storybook/test';

import { MagicChat } from './index';
import type {
  ChatMessage,
  CustomEntity,
  CustomEntityComponentRegistry,
  MagicChatHandle,
  MagicChatProps,
  UnknownEntityProps,
} from './index';

/*
  The stories play the part of the HOST application.

  MagicChat itself never imports anything from `src/host` — that is the whole
  point of the design. A story, though, has to be somebody's host, so it
  borrows the demo app's entity schemas and renderers rather than inventing a
  second set. `host.css` comes with them: the chips and cards below are styled
  by the host, not by MagicChat.
*/
import { aircraftEntity, areaEntity, carEntity } from '../host/entities';
import type { AircraftEntity, AreaEntity, CarEntity } from '../host/entities';
import {
  AircraftCard,
  AircraftChip,
  AreaCard,
  AreaChip,
  CarCard,
  CarChip,
} from '../host/entityRenderers';
import type { ZoomTo } from '../host/entityRenderers';
import '../host/host.css';

/* ------------------------------------------------------------------ *
 * The host's side of the contract
 * ------------------------------------------------------------------ */

/**
 * Host behaviour handed to the message renderers. In the demo app this flies
 * the Leaflet map to the entity; here there is no map, so it reports to the
 * Actions panel instead — which demonstrates the same thing: host behaviour
 * reaching a renderer without MagicChat knowing about it.
 */
const zoomTo: ZoomTo = (latitude, longitude, id) =>
  action('zoomTo')({ latitude, longitude, id });

/**
 * The registry, declared at module scope on purpose.
 *
 * Its component identities have to be stable across renders. Building it
 * inline in a story would make `message` a brand-new component type every
 * render, and React would remount every card instead of updating it — the same
 * reason `HostApp` wraps its registry in `useMemo`.
 */
const customEntityComponents: CustomEntityComponentRegistry = {
  Car: {
    composer: CarChip,
    message: (props) => <CarCard {...props} zoomTo={zoomTo} />,
    label: (entity: CarEntity) => entity.properties.name,
    getId: (entity: CarEntity) => entity.properties.id,
  },
  Aircraft: {
    composer: AircraftChip,
    message: (props) => <AircraftCard {...props} zoomTo={zoomTo} />,
    label: (entity: AircraftEntity) => entity.properties.callsign,
    getId: (entity: AircraftEntity) => entity.properties.id,
  },
  Area: {
    composer: AreaChip,
    message: (props) => <AreaCard {...props} zoomTo={zoomTo} />,
    label: (entity: AreaEntity) => entity.properties.name,
    getId: (entity: AreaEntity) => entity.properties.id,
  },
};

const conversation: ChatMessage[] = [
  {
    id: 'seed-1',
    author: 'them',
    authorName: 'Dana',
    text: 'Morning — anything moving in sector 4?',
    entities: [],
    sentAt: '08:41',
  },
  {
    id: 'seed-2',
    author: 'me',
    authorName: 'You',
    text: 'Checking the map now.',
    entities: [],
    sentAt: '08:42',
  },
  {
    id: 'seed-3',
    author: 'them',
    authorName: 'Dana',
    text: 'Send me whatever you find — just drag it in here.',
    entities: [],
    sentAt: '08:43',
  },
];

/* ------------------------------------------------------------------ *
 * Meta
 * ------------------------------------------------------------------ */

/**
 * A grid cell its child fills exactly.
 *
 * `.mc-chat` is `height: 100%`, so something has to give it a height. The
 * `minmax(0, …)` tracks are the load-bearing part: an ordinary `auto` track
 * grows with the message list, and the page scrolls instead of the list.
 */
const fillCell = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1fr)',
  gridTemplateColumns: 'minmax(0, 1fr)',
} as const;

const meta = {
  title: 'MagicChat',
  component: MagicChat,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A chat that accepts custom entities dragged in from the host application. ' +
          'MagicChat only ever sees `{ type, properties }`; everything entity-specific ' +
          'comes from the host renderers in `customEntityComponents`.',
      },
    },
  },
  /*
    The canvas supplies the height, and a 400px-wide column — the same width
    the demo app gives the chat.
  */
  decorators: [
    (Story) => (
      <div
        style={{
          ...fillCell,
          height: '100vh',
          gridTemplateColumns: 'minmax(0, 400px)',
          background: '#eef2f7',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    customEntityComponents,
    onSendMessage: fn(),
    onDragCustomEntitiesConsumed: fn(),
    onCustomEntityDragCancelled: fn(),
  },
  argTypes: {
    // Registries and render props are components — not meaningfully editable.
    customEntityComponents: { control: false },
    renderUnknownEntity: { control: false },
    onDebugChange: { control: false },
  },
} satisfies Meta<typeof MagicChat>;

export default meta;

type Story = StoryObj<typeof meta>;

/* ------------------------------------------------------------------ *
 * Simplest
 *
 * Deliberately self-contained: its own tiny entity, its own two
 * renderers, its own registry. Every other story borrows the demo app's
 * schemas and `host.css`, which is realistic but hides how little is
 * actually required. Nothing below is imported from `src/host`.
 * ------------------------------------------------------------------ */

/** The entity. Any JSON — MagicChat never looks inside `properties`. */
type NoteEntity = CustomEntity<{ id: string; text: string }>;

const noteEntity: NoteEntity = {
  type: 'Note',
  properties: { id: 'note-1', text: 'Hello from the host' },
};

/**
 * The two renderers, at module scope so their component identities are stable.
 * Declared inline in the story they would be new component types every render,
 * and React would remount rather than update — the same trap `useMemo` guards
 * against in `HostApp`.
 */
const simplestComponents: CustomEntityComponentRegistry = {
  Note: {
    // Content only: MagicChat draws the chip around this and puts the × on it,
    // so the host renderer never has to know how detaching works.
    composer: ({ entity }) => <span>📝 {entity.properties.text}</span>,
    message: ({ entity }) => <div>📝 {entity.properties.text}</div>,
    // Only used to name the entity in the drop overlay.
    label: (entity: NoteEntity) => entity.properties.text,
    /*
      Optional, and the reason this story's button can be dragged twice without
      collecting two identical chips: `getId` is the host telling MagicChat what
      makes two entities the same one. MagicChat cannot work that out — it never
      looks inside `properties` — so with no `getId` there is no de-duplication
      and a second drop attaches a second copy. That is a legitimate choice for
      an entity with no identity (`DECISIONS.md` §9); it is the wrong one here,
      where every drag is the same note.
    */
    getId: (entity: NoteEntity) => entity.properties.id,
  },
};

/**
 * One button, one entity, one line of host code.
 *
 * `onPointerDown` is the whole contract: the call must happen while the button
 * is physically held, which is why this cannot be a click handler. There is no
 * drag state here and nothing to clear afterwards.
 */
function SimplestHost(props: MagicChatProps) {
  const chatRef = useRef<MagicChatHandle>(null);

  return (
    <div style={{ ...fillCell, gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <div style={{ padding: 12, background: '#f8fafc' }}>
        <button
          type="button"
          /*
            `touchAction: none` stops a finger-drag being claimed by the page
            scroller mid-gesture; `preventDefault` stops the browser's own
            native text drag.
          */
          style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={(event) => {
            event.preventDefault();
            chatRef.current?.startCustomEntityDrag([noteEntity]);
          }}
        >
          📝 press and drag me into the chat
        </button>
      </div>

      <MagicChat ref={chatRef} {...props} />
    </div>
  );
}

/**
 * The smallest host there is: press the button, drag onto the chat, release.
 *
 * Read this one first. `StartCustomEntityDrag` below is the same mechanism with
 * the demo app's richer entities, and `DragGesture` drives it automatically.
 */
export const Simplest: Story = {
  args: {
    customEntityComponents: simplestComponents,
  },
  render: (args) => <SimplestHost {...args} />,
};

/* ------------------------------------------------------------------ *
 * Default
 * ------------------------------------------------------------------ */

/**
 * The chat at rest: an ordinary conversation, no entities in play.
 *
 * Type a message and send it — `onSendMessage` fires in the Actions panel.
 */
export const Default: Story = {
  args: {
    initialMessages: conversation,
  },
};

/* ------------------------------------------------------------------ *
 * customEntityComponents
 * ------------------------------------------------------------------ */

/** An entity type deliberately left out of the registry. */
const legacyMarkerEntity: CustomEntity = {
  type: 'LegacyMarker',
  properties: { id: 'lm-9', name: 'Marker 9' },
};

/** Replaces MagicChat's built-in "Unsupported entity" chip. */
function UnknownEntity({ entity, surface }: UnknownEntityProps) {
  return (
    <span className="entity-chip" style={{ color: '#9ca3af', fontStyle: 'italic' }}>
      <span className="entity-chip-icon">❓</span>
      <span className="entity-chip-title">{entity.type}</span>
      <span className="entity-chip-subtitle">no renderer ({surface})</span>
    </span>
  );
}

const messagesWithEntities: ChatMessage[] = [
  {
    id: 'types-1',
    author: 'them',
    authorName: 'Dana',
    text: 'What have we got out there?',
    entities: [],
    sentAt: '09:02',
  },
  {
    id: 'types-2',
    author: 'me',
    authorName: 'You',
    text: 'One vehicle and one aircraft, both inside the restricted area.',
    entities: [carEntity, aircraftEntity, areaEntity],
    sentAt: '09:03',
  },
  {
    id: 'types-3',
    author: 'them',
    authorName: 'Dana',
    text: 'This one came off the old system.',
    entities: [legacyMarkerEntity],
    sentAt: '09:04',
  },
];

/** Fills the composer once, through the imperative handle. */
function ChatWithAttachments({
  attach,
  ...props
}: MagicChatProps & { attach: CustomEntity[] }) {
  const chatRef = useRef<MagicChatHandle>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return; // survive StrictMode's double-invoked effects
    done.current = true;
    chatRef.current?.attachEntities(attach);
  }, [attach]);

  return <MagicChat ref={chatRef} {...props} />;
}

/**
 * The registry drives both surfaces: a compact chip in the composer, a full
 * card inside a sent message. Each type supplies its own pair, and the cards
 * run host behaviour (`Zoom to`) that MagicChat knows nothing about.
 *
 * `LegacyMarker` is intentionally absent from the registry — an unregistered
 * type falls back to `renderUnknownEntity` instead of crashing the chat.
 */
export const CustomEntityComponents: Story = {
  args: {
    initialMessages: messagesWithEntities,
    renderUnknownEntity: UnknownEntity,
  },
  render: (args) => (
    <ChatWithAttachments
      {...args}
      attach={[carEntity, aircraftEntity, areaEntity, legacyMarkerEntity]}
    />
  ),
};

/* ------------------------------------------------------------------ *
 * startCustomEntityDrag
 * ------------------------------------------------------------------ */

/**
 * A minimal host with genuine drag sources.
 *
 * The host's whole side of the contract is one call:
 * `chatRef.current.startCustomEntityDrag(entities)`, made from `onPointerDown`
 * while the button is still down. There is no drag state here, and nothing to
 * clear afterwards — the chat arms itself on the call and disarms itself on the
 * release, so the cycle repeats on its own:
 *
 *   idle → armed → over → dropped → idle → …
 *
 * The call returns `false` if no button is held, which is why the old
 * static-args story cannot be written any more: a drag cannot be announced from
 * story args, a click, or an effect. Call `startCustomEntityDrag` from the
 * browser console and it is refused, ticking `refusedStarts` in the debug
 * snapshot.
 */
function HostWithDragSources(props: MagicChatProps) {
  const chatRef = useRef<MagicChatHandle>(null);

  return (
    <div style={{ ...fillCell, gridTemplateRows: 'auto minmax(0, 1fr)' }}>
      <div style={{ display: 'flex', gap: 8, padding: 12, background: '#f8fafc' }}>
        {/*
          `touchAction: none` keeps a finger-drag from being claimed by the page
          scroller, which would cancel the gesture halfway through.
          `preventDefault` stops the browser's native text/image drag.
        */}
        <button
          type="button"
          style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={(event) => {
            event.preventDefault();
            chatRef.current?.startCustomEntityDrag([carEntity]);
          }}
        >
          🚗 drag one
        </button>
        <button
          type="button"
          style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={(event) => {
            event.preventDefault();
            chatRef.current?.startCustomEntityDrag([carEntity, areaEntity]);
          }}
        >
          🚗 📍 drag two
        </button>
      </div>

      <MagicChat ref={chatRef} {...props} />
    </div>
  );
}

/**
 * Press and hold a source button, drag onto the chat, release.
 *
 * This replaces an earlier `DragCustomEntities` story that painted the overlay
 * from static args. That story could never reach the second overlay tier — no
 * button was ever held — and what it displayed was a *stranded* overlay over an
 * inert drop target: the old contract's failure mode rather than its behaviour.
 * The imperative API makes both situations unreachable, so the only way to see
 * the overlay is to perform a drag. That is the point.
 *
 * `DragGesture` below drives this same host automatically.
 */
export const StartCustomEntityDrag: Story = {
  args: {
    initialMessages: conversation,
  },
  render: (args) => <HostWithDragSources {...args} />,
};

/**
 * Drive one pointer gesture by hand.
 *
 * Real `PointerEvent`s rather than `userEvent`, because the thing under test is
 * specifically `buttons`: MagicChat distinguishes a live drag from a stale array
 * by whether a button is held, and that is the bit a convenience helper hides.
 *
 * Dispatching on an element still reaches the hook — its listeners are on
 * `document` in the *capture* phase, which runs root-first before the target.
 */
function pointer(
  target: Element | Document,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  buttons: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX,
      clientY,
      buttons,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

const centreOf = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

/**
 * The drag gesture end to end, twice, with different payload sizes.
 *
 * Covers three things no other story can:
 *
 * 1. The `isPointerOver` tier of the overlay, and specifically its wording. The
 *    multi-entity headline used to collapse to a bare count ("Drop 2 custom
 *    entities here"), which differs from the base string only in the middle and
 *    so read as "nothing changed" mid-drag (DECISIONS.md §14).
 * 2. That the chat disarms itself, with the host doing nothing at all. The
 *    second drag arming at all is the proof.
 * 3. That listeners are live the instant `startCustomEntityDrag` returns. The
 *    gesture below dispatches exactly ONE `pointermove` and expects it to be
 *    seen. Under the old prop-driven arming this needed a `waitFor` and two
 *    moves, because the latch armed a commit later and the first move fell into
 *    the gap (DECISIONS.md §14 and §15).
 */
export const DragGesture: Story = {
  args: {
    initialMessages: conversation,
  },
  render: (args) => <HostWithDragSources {...args} />,
  play: async ({ canvasElement, args, step }) => {
    const canvas = within(canvasElement);
    const chat = canvasElement.querySelector('.mc-chat');
    if (!chat) throw new Error('chat element not found');

    const drag = async (sourceName: RegExp, expected: RegExp) => {
      const source = canvas.getByRole('button', { name: sourceName });
      const from = centreOf(source);
      pointer(source, 'pointerdown', from.x, from.y, 1);

      // ONE move, dispatched with no wait in between. Listeners are attached
      // synchronously inside `startCustomEntityDrag`, so there is no commit for
      // this move to fall into — that is the assertion.
      const to = centreOf(chat);
      pointer(document, 'pointermove', to.x, to.y, 1);

      await waitFor(() => expect(canvas.getByText(expected)).toBeInTheDocument());
      expect(chat).toHaveClass('mc-chat-drag-over');

      pointer(document, 'pointerup', to.x, to.y, 0);

      // Nobody cleared anything: the chat disarmed itself on the release, which
      // is what dismisses the overlay.
      await waitFor(() => expect(canvas.queryByText('Drop custom entity here')).toBeNull());
    };

    await step('one entity: the headline names it', async () => {
      await drag(/drag one/, /^Release to attach Car 123$/);
      await expect(args.onDragCustomEntitiesConsumed).toHaveBeenCalledTimes(1);
    });

    await step('two entities: the headline still names them', async () => {
      // Re-arming with no host involvement whatsoever. Under the old contract
      // this second drag was dead unless the host had emptied the array first.
      await drag(/drag two/, /^Release to attach Car 123 and Area A$/);
      await expect(args.onDragCustomEntitiesConsumed).toHaveBeenCalledTimes(2);
    });
  },
};
