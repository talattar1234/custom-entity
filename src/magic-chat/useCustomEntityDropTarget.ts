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
 * The host tells us a drag is in flight by CALLING us — `startCustomEntityDrag`
 * — from inside the pointer gesture that is already underway. From there this
 * hook does three things:
 *
 *   1. the call arrives -> attach pointermove / pointerup on `document`, now
 *   2. pointermove      -> hit-test the coordinates, toggle `isPointerOver`
 *   3. pointerup        -> inside the drop zone? drop : cancel. Then go inert.
 *
 * Nothing here knows about chat. It is a generic "drop target for host-driven
 * pointer drags" and could be published on its own.
 *
 *
 * WHY A CALL AND NOT A PROP?
 *
 * Because "a button is physically down on one of the host's objects right now"
 * is an *event*, and a prop is a *value that persists until someone changes it*.
 * Encoding the event as state meant the host had to un-say it afterwards, and
 * that obligation was the root of every sharp edge the old design documented: a
 * forgotten clear killed all future drags, left the overlay stranded, and a prop
 * set from a click or an effect armed a target with no gesture behind it.
 *
 * A call cannot be left set. `startCustomEntityDrag` refuses unless a button is
 * genuinely held (see `heldPointerRef`), and the gesture disarms itself on
 * release — so there is nothing for the host to clear and no way to arm outside
 * a real press. See DECISIONS.md §15.
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
 * One call to `startCustomEntityDrag` permits at most one drop.
 *
 *   idle  --(startCustomEntityDrag, button held)-->  armed
 *     ^                                                |
 *     +-------------- (release / cancel) --------------+
 *
 * There is no `spent` state any more, and nothing for the host to reset. The
 * old design needed one because the arming signal was a prop that outlived the
 * gesture; an arming that is a function call cannot outlive anything, so the
 * gesture simply returns to `idle` and the next press starts clean.
 */
type LatchState = CustomEntityDragLatchState;

/** Stable empty array, so disarming does not hand out a new identity. */
const NO_ENTITIES: CustomEntity[] = [];

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
    pointerDown: null,
    refusedStarts: 0,
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

/** A pointer that is down at this instant, per the always-on tracker. */
interface HeldPointer {
  pointerId: number;
  pointerType: string;
}

/**
 * Everything belonging to one armed gesture.
 *
 * Held in a ref rather than in state: all of it is per-gesture bookkeeping that
 * must be readable synchronously from a `document` listener, and none of it
 * should cause a render. `entities` is mirrored into state separately, because
 * the overlay does have to repaint when the payload changes.
 */
interface Gesture {
  entities: CustomEntity[];
  /** The gesture belongs to one pointer; every other pointer is ignored. */
  pointerId: number;
  pointerType: string;
  /** Local mirror of `isPointerOver`, so a move only touches state on a change. */
  over: boolean;
  /** e.g. a pointerup immediately followed by a window blur. */
  finished: boolean;
  detach: () => void;
}

interface UseCustomEntityDropTargetOptions {
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
   * Announce that a drag of `entities` is under way, and arm this drop target.
   *
   * MUST be called while a button is physically held — from a `pointerdown`
   * handler, or anywhere later inside the same held gesture (a long-press or
   * drag-threshold delay is fine). If no button is down the call is REFUSED: it
   * returns `false`, changes nothing, and bumps `refusedStarts` in the debug
   * snapshot. That guard is what makes "armed" mean what it says — a prop could
   * be set from a click or an effect; this cannot.
   *
   * Calling it again while already armed REPLACES the payload without
   * re-arming, so a host can grow a selection mid-drag without disturbing the
   * pointer lock. Returns `true` if the target is armed when the call returns.
   */
  startCustomEntityDrag: (entities: CustomEntity[]) => boolean;
  /**
   * Abandon an armed gesture. Silent: no `onDrop`, no `onCancel`.
   *
   * For a host that decides mid-gesture that this was not a drag after all — it
   * turned into a pan, say. No callback fires because the host initiated it and
   * therefore already knows.
   */
  cancelCustomEntityDrag: () => void;
  /** The payload of the armed gesture, or an empty array. */
  dragCustomEntities: CustomEntity[];
  /**
   * A drag is in flight on this target.
   *
   * Now a single fact rather than two that had to agree: the mechanism owns the
   * payload, so "the host says a drag is happening" and "the latch is armed"
   * cannot diverge. `isPointerOver` narrows it to a drop being possible *here*.
   */
  isDragActive: boolean;
  /** The dragged pointer is over the drop zone, and the gesture is still live. */
  isPointerOver: boolean;
}

export function useCustomEntityDropTarget({
  onDrop,
  onCancel,
  onDebug,
}: UseCustomEntityDropTargetOptions): UseCustomEntityDropTargetResult {
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [dragCustomEntities, setDragCustomEntities] = useState<CustomEntity[]>(NO_ENTITIES);
  const [isPointerOver, setIsPointerOver] = useState(false);

  const gestureRef = useRef<Gesture | null>(null);

  // Mirrored into refs so the listeners, attached once per gesture and never
  // re-created, always reach the host's latest callbacks.
  const onDropRef = useRef(onDrop);
  const onCancelRef = useRef(onCancel);
  const onDebugRef = useRef(onDebug);
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
      pointerDown: current.pointerDown ? { ...current.pointerDown } : null,
      recentEvents: [...current.recentEvents],
    });
  }, []);

  const logDebugEvent = useCallback((name: string, detail?: string) => {
    if (!onDebugRef.current) return;
    const events = debugRef.current.recentEvents;
    events.unshift({ name, detail, at: Date.now() });
    if (events.length > MAX_LOGGED_EVENTS) events.length = MAX_LOGGED_EVENTS;
  }, []);

  /*
    THE HELD-POINTER TRACKER — the only listeners this hook keeps at rest.

    `startCustomEntityDrag` has to answer "is a button down *right now*", and
    the DOM offers no way to ask. It cannot be answered from an event the host
    passes in either: a `PointerEvent` is a frozen snapshot, so a host arming
    from a long-press timer would hand us a stale `buttons: 1` and the guard
    would approve a gesture that is already over — precisely the failure the
    guard exists to prevent. So we watch instead.

    This costs four listeners at rest, where the prop-driven design had zero
    (DECISIONS.md §3). Bought deliberately, and it pays for itself twice: the
    guard becomes exact, and the tracker knows the pointer id at ARM time, which
    removes the old "lock onto the first pointermove we happen to see"
    heuristic. Multi-touch is now filtered correctly from the very first event.
  */
  const heldPointerRef = useRef<HeldPointer | null>(null);

  useEffect(() => {
    const remember = (pointer: HeldPointer | null) => {
      heldPointerRef.current = pointer;
      if (onDebugRef.current) {
        debugRef.current.pointerDown = pointer;
        emitDebug();
      }
    };

    const handleDown = (event: PointerEvent) => {
      // `buttons & 1` is the primary (left) button for a mouse and "in contact"
      // for touch and pen, so one test covers every pointer type. A right- or
      // middle-click therefore cannot arm a drag.
      if ((event.buttons & 1) === 0) return;
      remember({ pointerId: event.pointerId, pointerType: event.pointerType });
    };

    const handleRelease = (event: PointerEvent) => {
      if (heldPointerRef.current?.pointerId === event.pointerId) remember(null);
    };

    // A release outside the browser window may never produce a pointerup, and a
    // tracker stuck on "held" would let a later click arm a drag. Failing closed
    // is the only safe direction here.
    const handleWindowBlur = () => remember(null);

    // Capture phase on `document`, so we see the press before the host handler
    // that is about to call `startCustomEntityDrag` for this very event runs
    // anywhere down the tree.
    document.addEventListener('pointerdown', handleDown, true);
    document.addEventListener('pointerup', handleRelease, true);
    document.addEventListener('pointercancel', handleRelease, true);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('pointerdown', handleDown, true);
      document.removeEventListener('pointerup', handleRelease, true);
      document.removeEventListener('pointercancel', handleRelease, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [emitDebug]);

  /** Debug-only bookkeeping for a latch transition. */
  const setLatchDebug = useCallback((latch: LatchState) => {
    const debug = debugRef.current;
    debug.latch = latch;
    if (latch === 'idle') {
      debug.listening = false;
      for (const name of LISTENER_NAMES) debug.listeners[name].attached = false;
      debug.entityCount = 0;
      debug.pointerId = null;
      debug.pointerType = null;
      debug.buttons = null;
      debug.pointer = null;
      debug.hit = null;
      debug.isPointerOver = false;
    }
  }, []);

  /*
    Listeners are attached HERE, synchronously inside the call — not from an
    effect keyed on the latch.

    The old design armed in an effect, so the target was inert for the one
    commit between the prop changing and the effect running, and a pointermove
    landing in that window was never seen (verified: two back-to-back synthetic
    moves produced a `fired` count of 1). Harmless in practice, but the window
    only existed because arming had to travel through a render. It does not any
    more: the call IS the edge, so routing it through an effect would be
    indirection around something already in hand.
  */
  const startCustomEntityDrag = useCallback(
    (entities: CustomEntity[]): boolean => {
      const debug = debugRef.current;
      const live = gestureRef.current;

      const refuse = (why: string) => {
        // The one-line replacement for a whole class of old failures: a drag
        // announced outside a press is refused at the call, at once, instead of
        // arming a target that then dies silently on its first move.
        debug.refusedStarts += 1;
        logDebugEvent('start refused', why);
        emitDebug();
        return false;
      };

      // Checked BEFORE the armed branch, so an empty payload can never empty a
      // LIVE gesture. If it could, `isDragActive` would go false while the latch
      // stayed armed and listening, and a release inside the zone would report
      // "consumed" with nothing to consume. Refusing here is what makes
      // "isDragActive is true for exactly as long as the latch is armed" hold
      // unconditionally — and it is why aborting is `cancelCustomEntityDrag`
      // rather than `startCustomEntityDrag([])`.
      if (entities.length === 0) return refuse('no entities');

      // Already armed: replace the payload, keep the pointer lock. The drop
      // reads the payload as at the moment of release, so a host that grows a
      // selection mid-drag is honoured.
      if (live) {
        live.entities = entities;
        debug.entityCount = entities.length;
        logDebugEvent('payload replaced', `${entities.length} entity(ies)`);
        setDragCustomEntities(entities);
        emitDebug();
        return true;
      }

      const held = heldPointerRef.current;
      if (!held) return refuse('no button held');

      const gesture: Gesture = {
        entities,
        pointerId: held.pointerId,
        pointerType: held.pointerType,
        over: false,
        finished: false,
        detach: () => {},
      };
      gestureRef.current = gesture;

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
        if (next === gesture.over) return;
        gesture.over = next;
        debug.isPointerOver = next;
        logDebugEvent(next ? 'entered drop zone' : 'left drop zone');
        setIsPointerOver(next);
      };

      const finish = (outcome: 'dropped' | CustomEntityDragCancelReason) => {
        if (gesture.finished) return; // e.g. pointerup immediately followed by blur
        gesture.finished = true;
        setOver(false);
        gesture.detach();
        gestureRef.current = null;

        setLatchDebug('idle');
        debug.lastOutcome = outcome;
        logDebugEvent('resolved', outcome);
        emitDebug();
        setDragCustomEntities(NO_ENTITIES);

        // Last, so the mechanism is fully back at rest before the host reacts —
        // a host that arms a new drag from inside this callback is never racing
        // a half-torn-down gesture.
        if (outcome === 'dropped') onDropRef.current(gesture.entities);
        else onCancelRef.current?.(outcome);
      };

      const countFired = (name: CustomEntityDropListenerName) => {
        if (onDebugRef.current) debug.listeners[name].fired += 1;
      };

      /** Every pointer but ours is noise — this is what makes multi-touch behave. */
      const isOurs = (event: PointerEvent, name: CustomEntityDropListenerName) => {
        if (event.pointerId === gesture.pointerId) return true;
        countFired(name);
        logDebugEvent('ignored other pointer', `id ${event.pointerId}`);
        emitDebug();
        return false;
      };

      const handleMove = (event: PointerEvent) => {
        if (!isOurs(event, 'pointermove')) return;
        countFired('pointermove');

        debug.pointerId = event.pointerId;
        debug.pointerType = event.pointerType;
        debug.buttons = event.buttons;

        // Defensive only, and unreachable in normal use now that arming
        // requires a held button: a mouse move with none means the release
        // escaped both our pointerup listener and the tracker. Kept because it
        // costs one comparison and turns a stuck overlay into a clean cancel.
        if (event.pointerType === 'mouse' && event.buttons === 0) {
          finish('cancelled');
          return;
        }

        setOver(isOverDropZone(event.clientX, event.clientY));
        emitDebug();
      };

      const handleUp = (event: PointerEvent) => {
        if (!isOurs(event, 'pointerup')) return;
        countFired('pointerup');
        // Hit-test this event's own coordinates rather than trusting the last
        // move, so the decision can never be a frame stale.
        finish(isOverDropZone(event.clientX, event.clientY) ? 'dropped' : 'released-outside');
      };

      const handleCancel = (event: PointerEvent) => {
        if (!isOurs(event, 'pointercancel')) return;
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

      gesture.detach = () => {
        document.removeEventListener('pointermove', handleMove, true);
        document.removeEventListener('pointerup', handleUp, true);
        document.removeEventListener('pointercancel', handleCancel, true);
        document.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('blur', handleWindowBlur);
      };

      setLatchDebug('armed');
      debug.listening = true;
      for (const name of LISTENER_NAMES) debug.listeners[name] = { attached: true, fired: 0 };
      debug.entityCount = entities.length;
      debug.pointerId = gesture.pointerId;
      debug.pointerType = gesture.pointerType;
      debug.lastOutcome = null;
      logDebugEvent(
        'armed',
        `${entities.length} entity(ies), pointer ${gesture.pointerId} (${gesture.pointerType})`,
      );
      emitDebug();

      setDragCustomEntities(entities);
      return true;
    },
    [emitDebug, logDebugEvent, setLatchDebug],
  );

  const cancelCustomEntityDrag = useCallback(() => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gesture.finished = true;
    gesture.detach();
    gestureRef.current = null;

    setLatchDebug('idle');
    logDebugEvent('aborted by host');
    emitDebug();
    setIsPointerOver(false);
    setDragCustomEntities(NO_ENTITIES);
  }, [emitDebug, logDebugEvent, setLatchDebug]);

  // Unmounting mid-gesture detaches without a callback, matching the silence of
  // `cancelCustomEntityDrag`: there is no component left to report to.
  useEffect(
    () => () => {
      gestureRef.current?.detach();
      gestureRef.current = null;
    },
    [],
  );

  return {
    dropZoneRef,
    startCustomEntityDrag,
    cancelCustomEntityDrag,
    dragCustomEntities,
    isDragActive: dragCustomEntities.length > 0,
    isPointerOver,
  };
}
