import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftEntity, areaEntity, carEntity, entityId, mapEntities } from './entities';
import type { CustomEntity } from '../magic-chat';

/** Which of the two hit-test paths identified the pressed object. */
export type EntityPressSource = 'dom-marker' | 'canvas-hit-test';

/** What the chat's message renderers are allowed to do to the map. */
export interface MapApi {
  flyTo: (latitude: number, longitude: number) => void;
  flash: (id: string) => void;
}

interface MapPanelProps {
  /** The user pressed on one of the map's objects — a drag may be starting. */
  onEntityPressed: (
    entity: CustomEntity,
    event: PointerEvent,
    source: EntityPressSource,
  ) => void;
  /** Diagnostics only: Leaflet panning is suppressed while an entity drag runs. */
  onDragLockChange?: (locked: boolean) => void;
}

/** Ray casting, in container pixels. */
function polygonContainsPoint(ring: L.Point[], point: L.Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The host application's map. Vanilla Leaflet in one effect — no react-leaflet,
 * so there is no extra abstraction between you and the Leaflet API.
 *
 * The interesting part is `findEntityAt`, which shows the two kinds of drag
 * source side by side:
 *
 *   - the Car and Aircraft are Leaflet markers, i.e. real DOM elements;
 *   - the Area is drawn on a <canvas> and has NO DOM element at all, so the
 *     host hit-tests it itself — exactly what a WebGL host has to do, and the
 *     case native HTML5 drag & drop cannot serve.
 *
 * Either way MagicChat receives nothing but JSON.
 */
export const MapPanel = forwardRef<MapApi, MapPanelProps>(function MapPanel(
  { onEntityPressed, onDragLockChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Record<string, L.Marker | L.Polygon>>({});

  // Held in a ref so the map is built once, not rebuilt whenever the host
  // re-renders with a new callback identity.
  const onEntityPressedRef = useRef(onEntityPressed);
  const onDragLockChangeRef = useRef(onDragLockChange);
  onEntityPressedRef.current = onEntityPressed;
  onDragLockChangeRef.current = onDragLockChange;

  useEffect(() => {
    const map = L.map(containerRef.current as HTMLElement, {
      center: [31.7767, 35.212],
      zoom: 13,
    });
    mapRef.current = map;

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // --- DOM-sourced objects: markers are elements we can tag with an id. ---
    const addMarker = (entity: CustomEntity, glyph: string) => {
      const { latitude, longitude } = entity.properties as {
        latitude: number;
        longitude: number;
      };
      const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: 'host-marker',
          html: `<span>${glyph}</span>`,
          iconSize: [36, 36],
        }),
      }).addTo(map);
      marker.getElement()!.dataset.entityId = entityId(entity);
      layersRef.current[entityId(entity)] = marker;
    };

    addMarker(carEntity, '🚗');
    addMarker(aircraftEntity, '✈️');

    // --- Canvas-sourced object: L.canvas() draws it, so it has no element. ---
    const areaPolygon = L.polygon(areaEntity.properties.ring, {
      renderer: L.canvas(),
      color: '#b45309',
      weight: 2,
      fillColor: '#f59e0b',
      fillOpacity: 0.25,
    }).addTo(map);
    layersRef.current[entityId(areaEntity)] = areaPolygon;

    const findEntityAt = (
      event: PointerEvent,
    ): { entity: CustomEntity; source: EntityPressSource } | null => {
      // Path 1 — DOM: did the press land on a marker element?
      const target = event.target as HTMLElement | null;
      const markerElement = target?.closest<HTMLElement>('[data-entity-id]');
      if (markerElement) {
        const id = markerElement.dataset.entityId;
        const entity = mapEntities.find((candidate) => entityId(candidate) === id);
        return entity ? { entity, source: 'dom-marker' } : null;
      }

      // Path 2 — CANVAS: the Area has no element, so hit-test it by geometry.
      const point = map.mouseEventToContainerPoint(event);
      const ring = areaEntity.properties.ring.map(([latitude, longitude]) =>
        map.latLngToContainerPoint([latitude, longitude]),
      );
      return polygonContainsPoint(ring, point)
        ? { entity: areaEntity, source: 'canvas-hit-test' }
        : null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      const hit = findEntityAt(event);
      if (!hit) return; // empty map — let Leaflet pan as usual

      // Stop Leaflet starting a pan, and stop the browser treating a touch as a
      // scroll (which would fire pointercancel and abort the drag).
      event.preventDefault();
      event.stopPropagation();
      map.dragging.disable();
      onDragLockChangeRef.current?.(true);

      const reenableDragging = () => {
        map.dragging.enable();
        onDragLockChangeRef.current?.(false);
        document.removeEventListener('pointerup', reenableDragging, true);
        document.removeEventListener('pointercancel', reenableDragging, true);
      };
      document.addEventListener('pointerup', reenableDragging, true);
      document.addEventListener('pointercancel', reenableDragging, true);

      onEntityPressedRef.current(hit.entity, event, hit.source);
    };

    // Capture phase, so we see the press before Leaflet's own handlers do.
    const container = map.getContainer();
    container.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, true);
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (latitude, longitude) => {
        mapRef.current?.flyTo([latitude, longitude], 15, { duration: 0.8 });
      },
      flash: (id) => {
        const layer = layersRef.current[id];
        if (!layer) return;

        if (layer instanceof L.Marker) {
          const element = layer.getElement();
          element?.classList.add('host-marker-flash');
          window.setTimeout(() => element?.classList.remove('host-marker-flash'), 1400);
        } else {
          layer.setStyle({ color: '#dc2626', weight: 4, fillOpacity: 0.5 });
          window.setTimeout(
            () => layer.setStyle({ color: '#b45309', weight: 2, fillOpacity: 0.25 }),
            1400,
          );
        }
      },
    }),
    [],
  );

  return <div ref={containerRef} className="host-map" />;
});
