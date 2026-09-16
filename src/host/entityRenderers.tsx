import type { ReactNode } from "react";
import type {
  CustomEntityComposerProps,
  CustomEntityMessageProps,
} from "../magic-chat";
import type { AircraftEntity, AreaEntity, CarEntity } from "./entities";

/**
 * The host's renderers for its three entity types.
 *
 * Each type supplies two components:
 *   composer -> the chip shown in the input area before sending
 *   message  -> the card shown inside a sent message
 *
 * Both receive the FULL entity, so they can read any property and run
 * entity-specific actions. `zoomTo` is injected by `HostApp`, which is how
 * host behaviour reaches a renderer without MagicChat knowing anything about it.
 */

export type ZoomTo = (
  latitude: number,
  longitude: number,
  entityId: string,
) => void;

/* ---------- shared chrome (host styling choices, not MagicChat's) ---------- */

/*
  Content only — no pill, and deliberately no ×. MagicChat wraps every composer
  renderer in its own chip shell and puts the detach button there (see
  `CustomEntityComposerProps.remove`), so a host drawing its own would be the
  second one in the same chip.
*/
function Chip({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <span className="entity-chip">
      <span className="entity-chip-icon">{icon}</span>
      <span className="entity-chip-title">{title}</span>
      <span className="entity-chip-subtitle">{subtitle}</span>
    </span>
  );
}

function Card({
  icon,
  title,
  rows,
  actions,
}: {
  icon: string;
  title: string;
  rows: Array<[string, string]>;
  actions: ReactNode;
}) {
  return (
    <div className="entity-card">
      <div className="entity-card-head">
        <span className="entity-card-icon">{icon}</span>
        <strong>{title}</strong>
      </div>
      <dl className="entity-card-rows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="entity-card-actions">{actions}</div>
    </div>
  );
}

/* ---------- Car ---------- */

export function CarChip({ entity }: CustomEntityComposerProps<CarEntity>) {
  return (
    <Chip
      icon="🚗"
      title={entity.properties.name}
      subtitle={entity.properties.status}
    />
  );
}

export function CarCard({
  entity,
  zoomTo,
}: CustomEntityMessageProps<CarEntity> & { zoomTo: ZoomTo }) {
  const { id, name, status, speedKph, latitude, longitude } = entity.properties;

  return (
    <Card
      icon="🚗"
      title={name}
      rows={[
        ["Status", status],
        ["Speed", `${speedKph} km/h`],
        ["Position", `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`],
      ]}
      actions={
        <button type="button" onClick={() => zoomTo(latitude, longitude, id)}>
          Zoom to
        </button>
      }
    />
  );
}

/* ---------- Aircraft ---------- */

export function AircraftChip({ entity }: CustomEntityComposerProps<AircraftEntity>) {
  return (
    <Chip
      icon="✈️"
      title={entity.properties.callsign}
      subtitle={`${entity.properties.altitudeFt} ft`}
    />
  );
}

export function AircraftCard({
  entity,
  zoomTo,
}: CustomEntityMessageProps<AircraftEntity> & { zoomTo: ZoomTo }) {
  const { id, callsign, altitudeFt, headingDeg, latitude, longitude } =
    entity.properties;

  return (
    <Card
      icon="✈️"
      title={callsign}
      rows={[
        ["Altitude", `${altitudeFt} ft`],
        ["Heading", `${headingDeg}°`],
        ["Position", `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`],
      ]}
      actions={
        <button type="button" onClick={() => zoomTo(latitude, longitude, id)}>
          Zoom to
        </button>
      }
    />
  );
}

/* ---------- Area ---------- */

export function AreaChip({ entity }: CustomEntityComposerProps<AreaEntity>) {
  return (
    <Chip
      icon="📍"
      title={entity.properties.name}
      subtitle={entity.properties.classification}
    />
  );
}

export function AreaCard({
  entity,
  zoomTo,
}: CustomEntityMessageProps<AreaEntity> & { zoomTo: ZoomTo }) {
  const { id, name, classification, ring, latitude, longitude } =
    entity.properties;

  return (
    <Card
      icon="📍"
      title={name}
      rows={[
        ["Classification", classification],
        ["Vertices", String(ring.length)],
        ["Centre", `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`],
      ]}
      actions={
        <button type="button" onClick={() => zoomTo(latitude, longitude, id)}>
          Zoom to
        </button>
      }
    />
  );
}
