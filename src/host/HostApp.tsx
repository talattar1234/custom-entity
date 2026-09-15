import { useCallback, useMemo, useRef, useState } from "react";
import { MagicChat, entityLabel } from "../magic-chat";
import type {
  ChatMessage,
  CustomEntity,
  CustomEntityDragCancelReason,
  CustomEntityDropDebug,
  CustomEntityComponentRegistry,
} from "../magic-chat";
import { MapPanel } from "./MapPanel";
import type { MapApi } from "./MapPanel";
import { DragGhost } from "./DragGhost";
import { DebugBar } from "./DebugBar";
import { areaEntity, carEntity } from "./entities";
import type { AircraftEntity, AreaEntity, CarEntity } from "./entities";
import {
  AircraftCard,
  AircraftChip,
  AreaCard,
  AreaChip,
  CarCard,
  CarChip,
} from "./entityRenderers";
import type { ZoomTo } from "./entityRenderers";
import "./host.css";

const seedMessages: ChatMessage[] = [
  {
    id: "seed-1",
    author: "them",
    authorName: "Dana",
    text: "Morning — anything moving in sector 4?",
    entities: [],
    sentAt: "08:41",
  },
  {
    id: "seed-2",
    author: "me",
    authorName: "You",
    text: "Checking the map now.",
    entities: [],
    sentAt: "08:42",
  },
  {
    id: "seed-3",
    author: "them",
    authorName: "Dana",
    text: "Send me whatever you find — just drag it in here.",
    entities: [],
    sentAt: "08:43",
  },
];

/**
 * The host application.
 *
 * Its whole side of the contract is:
 *   1. notice that the user pressed on one of its objects,
 *   2. put that object's JSON into `dragCustomEntities`,
 *   3. clear it again when MagicChat says the drag resolved.
 *
 * It never tells MagicChat how to detect the drop, and MagicChat never learns
 * what a Car is.
 */
export function HostApp() {
  const mapRef = useRef<MapApi>(null);

  const [dragCustomEntities, setDragCustomEntities] = useState<CustomEntity[]>(
    [],
  );
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [lastOutcome, setLastOutcome] = useState("—");

  // Diagnostics for the debug bar. Nothing in the drag depends on these.
  const [chatDebug, setChatDebug] = useState<CustomEntityDropDebug | null>(
    null,
  );
  const [mapDragLocked, setMapDragLocked] = useState(false);
  const [lastPress, setLastPress] = useState("—");

  const startDrag = useCallback(
    (entities: CustomEntity[], point: { clientX: number; clientY: number }) => {
      setDragCustomEntities(entities);
      setDragOrigin({ x: point.clientX, y: point.clientY });
      setLastOutcome("dragging…");
    },
    [],
  );

  const endDrag = useCallback((outcome: string) => {
    // Clearing the array is the host's job, and it must happen before the next
    // drag: MagicChat allows one drop per non-empty period.
    setDragCustomEntities([]);
    setDragOrigin(null);
    setLastOutcome(outcome);
  }, []);

  /** Host behaviour that the message renderers are given access to. */
  const zoomTo = useCallback<ZoomTo>((latitude, longitude, id) => {
    mapRef.current?.flyTo(latitude, longitude);
    mapRef.current?.flash(id);
  }, []);

  /*
    The registry. `useMemo` + a `useCallback`-stable `zoomTo` matter here: an
    inline arrow recreated every render would be a NEW component type each time,
    and React would remount every renderer instead of updating it.
  */
  const customEntityComponents: CustomEntityComponentRegistry = useMemo(
    () => ({
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
    }),
    [zoomTo],
  );

  const ghostLabels = dragCustomEntities.map((entity) =>
    entityLabel(customEntityComponents, entity),
  );

  return (
    <div className="host">
      <header className="host-header">
        <h1>Host application</h1>
        <p>
          Press and hold a map object, drag it into MagicChat on the right, and
          release.
        </p>
      </header>

      <div className="host-toolbar">
        {/*
          A second drag source that is not the map at all, and which carries TWO
          entities — nothing in the design assumes a single entity per drag.
        */}
        <button
          type="button"
          className="host-group-source"
          onPointerDown={(event) => {
            event.preventDefault();
            setLastPress("Car + Area · toolbar");
            startDrag([carEntity, areaEntity], event);
          }}
        >
          🚗 📍 Drag group (2 entities)
        </button>

        <span className="host-status">
          The floating debug panel splits the two sides of the contract: what
          the host does, and what MagicChat does in response.
        </span>
      </div>

      <main className="host-body">
        <DebugBar
          host={{
            entityCount: dragCustomEntities.length,
            ghostVisible: dragOrigin !== null && dragCustomEntities.length > 0,
            mapDragLocked,
            lastPress,
            lastOutcome,
          }}
          chat={chatDebug}
        />

        <MapPanel
          ref={mapRef}
          onEntityPressed={(entity, event, source) => {
            setLastPress(`${entity.type} · ${source}`);
            startDrag([entity], event);
          }}
          onDragLockChange={setMapDragLocked}
        />

        <aside className="host-chat">
          <MagicChat
            customEntityComponents={customEntityComponents}
            dragCustomEntities={dragCustomEntities}
            onDragCustomEntitiesConsumed={(entities) =>
              endDrag(
                `consumed ${entities.length} entit${entities.length === 1 ? "y" : "ies"}`,
              )
            }
            onCustomEntityDragCancelled={(
              reason: CustomEntityDragCancelReason,
            ) => endDrag(reason)}
            initialMessages={seedMessages}
            onSendMessage={(message) =>
              console.log("[host] message sent", message)
            }
            onDebugChange={setChatDebug}
          />
        </aside>
      </main>

      {dragOrigin && dragCustomEntities.length > 0 && (
        <DragGhost labels={ghostLabels} origin={dragOrigin} />
      )}
    </div>
  );
}
