import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { action } from 'storybook/actions';
import { fn } from 'storybook/test';

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
    // Editable JSON, so the drop overlay can be driven from the Controls panel.
    dragCustomEntities: { control: 'object' },
    // Registries and render props are components — not meaningfully editable.
    customEntityComponents: { control: false },
    renderUnknownEntity: { control: false },
    onDebugChange: { control: false },
  },
} satisfies Meta<typeof MagicChat>;

export default meta;

type Story = StoryObj<typeof meta>;

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
    <span className="entity-chip" style={{ borderStyle: 'dashed', color: '#9ca3af' }}>
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
 * dragCustomEntities
 * ------------------------------------------------------------------ */

/**
 * The drop overlay, driven straight from the prop.
 *
 * `dragCustomEntities` is the host's whole side of the drag contract: a
 * non-empty array means "a drag is in flight". MagicChat arms its drop target
 * and paints the overlay, listing each entity by its registry `label`.
 *
 * Here the array is plain story data rather than live host state, so the
 * overlay is visible without performing a drag. Edit the JSON in the Controls
 * panel — add or remove entities, or empty the array to dismiss the overlay.
 *
 * NOTE: move the mouse over the canvas and `onCustomEntityDragCancelled` fires
 * in the Actions panel — a `pointermove` with no button held means the gesture
 * is already over, so the drop target disarms. The overlay stays up anyway,
 * because it follows the prop and this story never clears it. A real host
 * clears on that callback, which is what dismisses the overlay; leaving it
 * stranded is exactly the failure the contract warns about, on show here.
 */
export const DragCustomEntities: Story = {
  args: {
    initialMessages: conversation,
    // Two entities, because nothing in the design assumes one per drag.
    dragCustomEntities: [carEntity, areaEntity],
  },
};
