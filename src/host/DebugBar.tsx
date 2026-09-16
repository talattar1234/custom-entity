import { useState } from 'react';
import type { ReactNode } from 'react';
import type { CustomEntityDropDebug, CustomEntityDropListenerName } from '../magic-chat';

/**
 * Live state of the drag, split along the architecture boundary.
 *
 *   HOST panel      — what the host owns: detection, and its own drag ghost.
 *   MAGICCHAT panel — what the component owns: the payload, listeners, hit
 *                     test, the latch.
 *
 * The MagicChat side is read straight out of the mechanism via `onDebugChange`,
 * never re-derived here — a panel that recomputes what it shows can agree with
 * itself while disagreeing with reality.
 *
 * Current state only, no event log. `CustomEntityDropDebug.recentEvents` still
 * carries the last few discrete events if you ever want to render them.
 */

export interface HostDebugState {
  ghostVisible: boolean;
  mapDragLocked: boolean;
  /** Which entity was pressed last, and which hit-test path found it. */
  lastPress: string;
  lastOutcome: string;
}

interface DebugBarProps {
  host: HostDebugState;
  /** Null until MagicChat reports its first snapshot. */
  chat: CustomEntityDropDebug | null;
}

const LISTENERS: Array<{ name: CustomEntityDropListenerName; target: string }> = [
  { name: 'pointermove', target: 'document' },
  { name: 'pointerup', target: 'document' },
  { name: 'pointercancel', target: 'document' },
  { name: 'keydown', target: 'document' },
  { name: 'blur', target: 'window' },
];

function Light({ on, label, title }: { on: boolean; label: string; title?: string }) {
  return (
    <span className="debug-field" title={title}>
      <span className={`debug-light ${on ? 'debug-light-on' : 'debug-light-off'}`} />
      <span className="debug-field-label">{label}</span>
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="debug-field">
      <span className="debug-field-label">{label}</span>
      <span className="debug-field-value">{children}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="debug-row">
      <span className="debug-row-label">{label}</span>
      <span className="debug-row-items">{children}</span>
    </div>
  );
}

function Panel({
  side,
  title,
  subtitle,
  children,
}: {
  side: 'host' | 'chat';
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className={`debug-panel debug-panel-${side}`}>
      <header className="debug-panel-head">
        <span className="debug-panel-title">{title}</span>
        <span className="debug-panel-subtitle">{subtitle}</span>
      </header>
      {children}
    </section>
  );
}

export function DebugBar({ host, chat }: DebugBarProps) {
  const [open, setOpen] = useState(true);
  const latch = chat?.latch ?? 'idle';

  return (
    <div className="debug-bar">
      <div className="debug-bar-head">
        <button type="button" className="debug-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} debug
        </button>
        <span className="debug-legend">
          <span className="debug-light debug-light-on" /> active
          <span className="debug-light debug-light-off" /> inactive
        </span>
        <span className="debug-bar-summary">
          <span className={`debug-pill debug-pill-${latch}`}>latch: {latch}</span>
          <span className="debug-field-label">
            {chat?.entityCount ?? 0} in flight · last: {host.lastOutcome}
          </span>
        </span>
      </div>

      {open && (
        <div className="debug-panels">
          <Panel side="host" title="HOST" subtitle="detects the drag · owns the ghost">
            <Row label="State">
              <Light on={host.ghostVisible} label="drag ghost" />
              <Light
                on={host.mapDragLocked}
                label="map pan locked"
                title="Leaflet panning is suppressed while an entity drag runs"
              />
            </Row>
            <Row label="Last">
              <Field label="press">{host.lastPress}</Field>
              <Field label="outcome">{host.lastOutcome}</Field>
            </Row>
          </Panel>

          <Panel side="chat" title="MAGICCHAT" subtitle="owns the payload · detects the drop">
            <Row label="State">
              <span className={`debug-pill debug-pill-${latch}`} title="idle → armed → idle">
                {latch}
              </span>
              <Light
                on={chat?.listening ?? false}
                label="listening"
                title="Listeners are attached only while the latch is armed"
              />
              <Light on={chat?.isPointerOver ?? false} label="isPointerOver" />
              <Field label="entities">{chat?.entityCount ?? 0}</Field>
              <Field label="outcome">{chat?.lastOutcome ?? '—'}</Field>
            </Row>

            <Row label="Listeners">
              {LISTENERS.map(({ name, target }) => {
                const status = chat?.listeners[name];
                return (
                  <span className="debug-field" key={name} title={`${target}.${name} (capture)`}>
                    <span
                      className={`debug-light ${
                        status?.attached ? 'debug-light-on' : 'debug-light-off'
                      }`}
                    />
                    <span className="debug-field-label">{name}</span>
                    <span className="debug-field-value">{status?.fired ?? 0}</span>
                  </span>
                );
              })}
            </Row>

            {/*
              The two fields that replace the old "array set outside a press"
              footgun. `pointerDown` is the tracker state
              `startCustomEntityDrag` consults, so it answers "why was my drag
              refused?"; `refusedStarts` counts the times it said no. A host
              announcing drags outside a real press shows up here as a rising
              counter instead of a drop target that dies on its first move.
            */}
            <Row label="Press">
              <Light
                on={!!chat?.pointerDown}
                label="button held"
                title="The always-on tracker. startCustomEntityDrag is refused unless this is lit."
              />
              <Field label="tracker">
                {chat?.pointerDown
                  ? `id ${chat.pointerDown.pointerId} ${chat.pointerDown.pointerType}`
                  : '—'}
              </Field>
              <Field label="refused starts">{chat?.refusedStarts ?? 0}</Field>
            </Row>

            <Row label="Hit test">
              <Field label="pointer">
                {chat?.pointer ? `${chat.pointer.x}, ${chat.pointer.y}` : '—'}
              </Field>
              <Field label="id">
                {chat?.pointerId ?? '—'}
                {chat?.pointerType ? ` ${chat.pointerType}` : ''}
              </Field>
              <Field label="buttons">{chat?.buttons ?? '—'}</Field>
              <Field label="elementFromPoint">{chat?.hit?.element ?? '—'}</Field>
              <Light on={chat?.hit?.insideDropZone ?? false} label="inside drop zone" />
            </Row>
          </Panel>
        </div>
      )}
    </div>
  );
}
