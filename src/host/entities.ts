import type { CustomEntity } from '../magic-chat';

/**
 * The host application's own object schemas.
 *
 * MagicChat never sees these types — it only ever handles
 * `CustomEntity<Record<string, unknown>>`. They exist so the host's own
 * renderers are properly typed.
 */

export interface CarProperties {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: 'active' | 'idle';
  speedKph: number;
}

export interface AircraftProperties {
  id: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
  headingDeg: number;
}

export interface AreaProperties {
  id: string;
  name: string;
  /** Centre, used by "Zoom to". */
  latitude: number;
  longitude: number;
  classification: string;
  /** Polygon outline as [latitude, longitude] pairs. */
  ring: Array<[number, number]>;
}

export type CarEntity = CustomEntity<CarProperties>;
export type AircraftEntity = CustomEntity<AircraftProperties>;
export type AreaEntity = CustomEntity<AreaProperties>;

export const carEntity: CarEntity = {
  type: 'Car',
  properties: {
    id: 'car-123',
    name: 'Car 123',
    latitude: 31.7683,
    longitude: 35.2137,
    status: 'active',
    speedKph: 48,
  },
};

export const aircraftEntity: AircraftEntity = {
  type: 'Aircraft',
  properties: {
    id: 'ac-77',
    callsign: 'HAWK 77',
    latitude: 31.7861,
    longitude: 35.2312,
    altitudeFt: 12500,
    headingDeg: 215,
  },
};

export const areaEntity: AreaEntity = {
  type: 'Area',
  properties: {
    id: 'area-a',
    name: 'Area A',
    latitude: 31.7745,
    longitude: 35.1955,
    classification: 'Restricted',
    ring: [
      [31.7800, 35.1860],
      [31.7810, 35.2050],
      [31.7690, 35.2060],
      [31.7680, 35.1870],
    ],
  },
};

/** Everything on the map, in one place. */
export const mapEntities: CustomEntity[] = [carEntity, aircraftEntity, areaEntity];

/** The host's own id lookup — MagicChat could not do this, it has no schema. */
export function entityId(entity: CustomEntity): string {
  return (entity.properties as { id: string }).id;
}
