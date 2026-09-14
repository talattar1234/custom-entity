import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  CustomEntity,
  CustomEntityDragCancelReason,
  CustomEntityDragLatchState,
  CustomEntityDropDebug,
  CustomEntityDropListenerName,
} from './types';

/**
 * THE DRAG/DROP MECHANISM.
 *
 * The host tells us a drag is in flight by putting entities in
 * `dragCustomEntities`. From there this hook does three things:
 *
 *   1. entities appear  -> attach pointermove / pointerup on `document`
 *   2. pointermove      -> hit-test the coordinates, toggle `isPointerOver`
 *   3. pointerup        -> inside the drop zone? drop : cancel. Then go inert.
 *
 * Nothing here knows about chat. It is a generic "drop target for host-driven
 * pointer drags" and could be published on its own.
 *
 *
 * WHY COORDINATE HIT-TESTING INSTEAD OF onPointerEnter/onPointerLeave?
 *
 * Native enter/leave on the drop-zone element would be simpler, and it does
 * work for a mouse when the host takes no pointer capture. It breaks in the two
 * cases we must support:
 *
 *   - Touch and pen IMPLICITLY capture the pointer to the element that received
 *     `pointerdown`. Every later move/up for that gesture is delivered there,
 *     so our element never sees them.
 *   - `setPointerCapture` does the same explicitly, and it is the normal way to
 *     drag a canvas/WebGL object (you need it to keep receiving moves once the
 *     pointer leaves the canvas).
 *
 * `document.elementFromPoint` is plain render-tree hit-testing and is
 * unaffected by pointer capture, which is exactly why it is the right tool. It
 * also beats comparing against `getBoundingClientRect()`, because a rect test
 * reports "inside" even when a dialog or the drag ghost is painted on top.
 *
 * Two things must therefore be `pointer-events: none`, or they would be
 * returned by every hit test: our own overlay, and the host's drag ghost.
 */

/**
 * One arming of `dragCustomEntities` permits at most one drop.
 *
 *   idle  --(entities appear)-->  armed  --(release/cancel)-->  spent
 *     ^                                                           |
 *     +------------------ (host clears the array) -----------------+
 *
 * `spent` is what makes consumption idempotent: once the pointer is released
 * we ignore everything until the host clears the array, so a stale prop plus a
 * stray click can never re-consume the same entities.
 */
type LatchState = CustomEntityDragLatchState;

const LISTENER_NAMES: CustomEntityDropListenerName[] = [
  'pointermove',
  'pointerup',
  'pointercancel',
  'keydown',
  'blur',
];

const MAX_LOGGED_EVENTS = 8;

function createDebugSnapshot(): CustomEntityDropDebug {
  return {
    latch: 'idle',
    listening: false,
    listeners: {
      pointermove: { attached: false, fired: 0 },
      pointerup: { attached: false, fired: 0 },
      pointercancel: { attached: false, fired: 0 },
      keydown: { attached: false, fired: 0 },
      blur: { attached: false, fired: 0 },
    },
    entityCount: 0,
    pointerId: null,
    pointerType: null,
    buttons: null,
    pointer: null,
    hit: null,
    isPointerOver: false,
    lastOutcome: null,
    recentEvents: [],
  };
}

/** A short, readable selector for whatever was under the pointer. */
function describeElement(element: Element | null): string {
  if (!element) return 'null (outside viewport)';
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const className = typeof element.className === 'string' ? element.className.trim() : '';
  const firstClass = className.split(/\s+/).filter(Boolean)[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

interface UseCustomEntityDropTargetOptions {
  /** The host's live drag payload. Non-empty means a drag is in flight. */
  dragCustomEntities: CustomEntity[];
  /** Released inside the drop zone. Receives the payload as of the release. */
  onDrop: (entities: CustomEntity[]) => void;
  /** Released outside, or the gesture was cancelled. */
  onCancel?: (reason: CustomEntityDragCancelReason) => void;
  /** Diagnostics only. Emitted synchronously and unthrottled — see DECISIONS.md §13. */
  onDebug?: (debug: CustomEntityDropDebug) => void;
}

interface UseCustomEntityDropTargetResult {
  /** Attach to the element that should accept drops. */
  dropZoneRef: RefObject<HTMLDivElement>;
  /**
   * The host says a drag is in flight — i.e. `dragCustomEntities` is non-empty.
   *
   * Prop-driven on purpose. This is a *view* signal, so it stays a pure function
   * of props rather than of the internal latch, which is an event concern (it
   * exists to make consumption idempotent). `isPointerOver` is the flag that
   * reflects a drop being genuinely possible right now.
   */
  isDragActive: boolean;
  /** The dragged pointer is over the drop zone, and the gesture is still live. */
  isPointerOver: boolean;
}

export function useCustomEntityDropTarget({
  dragCustomEntities,
  onDrop,
  onCancel,
  onDebug,
}: UseCustomEntityDropTargetOptions): UseCustomEntityDropTargetResult {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [latch, setLatch] = useState<LatchState>('idle');
  const [isPointerOver, setIsPointerOver] = useState(false);

  // Mirrored into refs so the listener effect depends only on `latch` and does
  // not re-subscribe on every host render. The drop reads the payload as it is
  // at the moment of release, so a host that swaps entities mid-drag is honoured.
  const entitiesRef = useRef(dragCustomEntities);
  const onDropRef = useRef(onDrop);
  const onCancelRef = useRef(onCancel);
  const onDebugRef = useRef(onDebug);
  entitiesRef.current = dragCustomEntities;
  onDropRef.current = onDrop;
  onCancelRef.current = onCancel;
  onDebugRef.current = onDebug;

  /*
    Diagnostics accumulate in a ref and are emitted as an immutable copy.

    Emission is synchronous and unthrottled, on purpose. An earlier version
    coalesced it into a requestAnimationFrame, which freezes silently whenever
    the tab is backgrounded — a debug feed that stops without saying so is worse
    than a slightly expensive one.

    The cost is one consumer render per pointermove while `onDebug` is attached.
    That is accepted because this is opt-in diagnostics: omit the callback and
    none of this runs. The detection path itself is unaffected either way.
  */
  const debugRef = useRef<CustomEntityDropDebug>(createDebugSnapshot());

  const emitDebug = useCallback(() => {
    const current = debugRef.current;
    onDebugRef.current?.({
      ...current,
      listeners: { ...current.listeners },
      recentEvents: [...current.recentEvents],
    });
  }, []);

  const logDebugEvent = useCallback((name: string, detail?: string) => {
    if (!onDebugRef.current) return;
    const events = debugRef.current.recentEvents;
    events.unshift({ name, detail, at: Date.now() });
    if (events.length > MAX_LOGGED_EVENTS) events.length = MAX_LOGGED_EVENTS;
  }, []);

  const hasEntities = dragCustomEntities.length > 0;

  useEffect(() => {
    setLatch((previous) => {
      if (!hasEntities) return 'idle'; // host cleared: re-armable
      if (previous === 'idle') return 'armed'; // a new drag begins
      return previous; // 'armed' continues; 'spent' stays spent
    });
  }, [hasEntities]);

  // Keep the reported payload size current even if the host swaps entities.
  useEffect(() => {
    debugRef.current.entityCount = dragCustomEntities.length;
    emitDebug();
  }, [dragCustomEntities.length, emitDebug]);

  useEffect(() => {
    const debug = debugRef.current;
    debug.latch = latch;

    if (latch !== 'armed') {
      debug.listening = false;
      for (const name of LISTENER_NAMES) debug.listeners[name].attached = false;
      debug.pointerId = null;
      debug.pointerType = null;
      debug.buttons = null;
      debug.pointer = null;
      debug.hit = null;
      debug.isPointerOver = false;
      logDebugEvent(`latch → ${latch}`);
      emitDebug();
      return;
    }

    debug.listening = true;
    for (const name of LISTENER_NAMES) debug.listeners[name] = { attached: true, fired: 0 };
    debug.lastOutcome = null;
    logDebugEvent('latch → armed', `${entitiesRef.current.length} entity(ies)`);
    emitDebug();

    // Local mirrors, so a move only touches React state when the answer changes.
    let over = false;
    let finished = false;
    // The gesture belongs to one pointer. We latch onto the first one we see and
    // ignore the rest, which is what makes multi-touch behave.
    let pointerId: number | null = null;

    const isOverDropZone = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const inside = !!element && !!dropZoneRef.current?.contains(element);
      if (onDebugRef.current) {
        debug.pointer = { x: Math.round(clientX), y: Math.round(clientY) };
        debug.hit = { element: describeElement(element), insideDropZone: inside };
      }
      return inside;
    };

    const setOver = (next: boolean) => {
      if (next === over) return;
      over = next;
      debug.isPointerOver = next;
      logDebugEvent(next ? 'entered drop zone' : 'left drop zone');
      setIsPointerOver(next);
    };

    const finish = (outcome: 'dropped' | CustomEntityDragCancelReason) => {
      if (finished) return; // e.g. pointerup immediately followed by blur
      finished = true;
      setOver(false);
      debug.lastOutcome = outcome;
      logDebugEvent('resolved', outcome);
      emitDebug();
      setLatch('spent');
      if (outcome === 'dropped') onDropRef.current(entitiesRef.current);
      else onCancelRef.current?.(outcome);
    };

    const countFired = (name: CustomEntityDropListenerName) => {
      if (onDebugRef.current) debug.listeners[name].fired += 1;
    };

    const handleMove = (event: PointerEvent) => {
      countFired('pointermove');
      if (pointerId === null) {
        pointerId = event.pointerId;
        logDebugEvent('locked to pointer', `id ${event.pointerId} (${event.pointerType})`);
      } else if (event.pointerId !== pointerId) {
        logDebugEvent('ignored other pointer', `id ${event.pointerId}`);
        emitDebug();
        return;
      }

      debug.pointerId = event.pointerId;
      debug.pointerType = event.pointerType;
      debug.buttons = event.buttons;

      // No button held means the gesture is already over — the host populated
      // the array outside a gesture, or the drag started before we mounted.
      // Only meaningful for mouse: touch/pen only emit moves while down.
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        finish('cancelled');
        return;
      }

      setOver(isOverDropZone(event.clientX, event.clientY));
      emitDebug();
    };

    const handleUp = (event: PointerEvent) => {
      countFired('pointerup');
      if (pointerId !== null && event.pointerId !== pointerId) {
        logDebugEvent('ignored other pointer', `id ${event.pointerId}`);
        emitDebug();
        return;
      }
      // Hit-test this event's own coordinates rather than trusting the last
      // move, so the decision can never be a frame stale.
      finish(isOverDropZone(event.clientX, event.clientY) ? 'dropped' : 'released-outside');
    };

    const handleCancel = () => {
      countFired('pointercancel');
      finish('cancelled');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      countFired('keydown');
      if (event.key === 'Escape') finish('cancelled');
      else emitDebug();
    };
    // A release outside the browser window may never produce a pointerup.
    const handleWindowBlur = () => {
      countFired('blur');
      finish('cancelled');
    };

    // Capture phase: nothing in the page can stopPropagation these away from us.
    document.addEventListener('pointermove', handleMove, true);
    document.addEventListener('pointerup', handleUp, true);
    document.addEventListener('pointercancel', handleCancel, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('pointermove', handleMove, true);
      document.removeEventListener('pointerup', handleUp, true);
      document.removeEventListener('pointercancel', handleCancel, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', handleWindowBlur);
      setIsPointerOver(false);
    };
  }, [latch, emitDebug, logDebugEvent]);

  // `isDragActive` follows the prop, not the latch: a drop *indicator* should be
  // a function of what the host says, while the latch governs what the mechanism
  // will actually do. They agree for the whole of a well-behaved gesture, and
  // diverge only after a release the host has not yet cleared — where leaving the
  // overlay up is the loud, diagnosable failure (see DECISIONS.md §14).
  return { dropZoneRef, isDragActive: hasEntities, isPointerOver };
}
