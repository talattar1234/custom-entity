import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { entityLabel } from './EntityRenderer';
import { useCustomEntityDropTarget } from './useCustomEntityDropTarget';
import type {
  AttachedEntity,
  ChatMessage,
  CustomEntity,
  MagicChatHandle,
  MagicChatProps,
} from './types';

let instanceCounter = 0;
const nextInstanceId = () => `attached-${++instanceCounter}`;

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Headline for the armed-and-over state.
 *
 * Two things are load-bearing here, both learned the hard way:
 *
 * 1. It leads with "Release", not "Drop". The base state says "Drop custom
 *    entity here", so a headline starting with "Drop" reads as the same string
 *    at a glance — which is what the user is doing mid-drag, with a ghost under
 *    the cursor. "Release" names the affordance and cannot be confused with it.
 * 2. It NAMES the entities even when there are several. An earlier version fell
 *    back to "Drop 2 custom entities here" for length > 1, which differs from
 *    the base string only in the middle and so was effectively invisible — the
 *    over state looked broken for every multi-entity drag.
 *
 * Long payloads are truncated rather than wrapped: the full list is always
 * rendered as chips underneath, so the headline only has to be distinctive.
 */
function dropPrompt(labels: string[]): string {
  if (labels.length === 0) return 'Release to attach';
  if (labels.length === 1) return `Release to attach ${labels[0]}`;
  if (labels.length === 2) return `Release to attach ${labels[0]} and ${labels[1]}`;
  return `Release to attach ${labels[0]} and ${labels.length - 1} more`;
}

/**
 * A mock chat that accepts custom entities dragged in from the host app.
 *
 * MagicChat knows only the generic shape `{ type, properties }`. Everything
 * entity-specific — appearance, actions — comes from the host's renderers in
 * `customEntityComponents`.
 *
 * A drag is announced through the ref, not a prop:
 * `chatRef.current.startCustomEntityDrag([entity])`, called while the button is
 * still held. See DECISIONS.md §15 for why that is a call and not state.
 */
export const MagicChat = forwardRef<MagicChatHandle, MagicChatProps>(function MagicChat(
  {
    customEntityComponents,
    onDragCustomEntitiesConsumed,
    onCustomEntityDragCancelled,
    initialMessages = [],
    onSendMessage,
    renderUnknownEntity,
    onDebugChange,
  },
  ref,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [attachments, setAttachments] = useState<AttachedEntity[]>([]);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const attachEntities = useCallback(
    (entities: CustomEntity[]) => {
      setAttachments((current) => {
        const next = [...current];

        for (const entity of entities) {
          // De-duplication is opt-in per type: only the host can say what
          // makes two entities "the same", because only it knows the schema.
          const getId = customEntityComponents[entity.type]?.getId;
          if (getId) {
            const id = getId(entity);
            const alreadyAttached = next.some(
              (candidate) =>
                candidate.entity.type === entity.type &&
                customEntityComponents[candidate.entity.type]?.getId?.(candidate.entity) === id,
            );
            if (alreadyAttached) continue;
          }

          next.push({ instanceId: nextInstanceId(), entity });
        }

        return next;
      });
    },
    [customEntityComponents],
  );

  const handleDrop = useCallback(
    (entities: CustomEntity[]) => {
      attachEntities(entities);
      // Informational: the drop target has already disarmed itself, so there is
      // nothing the host has to do here beyond retiring its own drag chrome.
      onDragCustomEntitiesConsumed?.(entities);
      textareaRef.current?.focus();
    },
    [attachEntities, onDragCustomEntitiesConsumed],
  );

  const {
    dropZoneRef,
    startCustomEntityDrag,
    cancelCustomEntityDrag,
    dragCustomEntities,
    isDragActive,
    isPointerOver,
  } = useCustomEntityDropTarget({
    onDrop: handleDrop,
    onCancel: onCustomEntityDragCancelled,
    onDebug: onDebugChange,
  });

  const removeAttachment = useCallback((instanceId: string) => {
    setAttachments((current) => current.filter((a) => a.instanceId !== instanceId));
  }, []);

  const clearComposer = useCallback(() => {
    setAttachments([]);
    setText('');
  }, []);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const message: ChatMessage = {
      id: `message-${Date.now()}`,
      author: 'me',
      authorName: 'You',
      text: trimmed,
      entities: attachments.map((attached) => attached.entity),
      sentAt: formatTime(new Date()),
    };

    setMessages((current) => [...current, message]);
    clearComposer();
    onSendMessage?.(message);
  }, [text, attachments, clearComposer, onSendMessage]);

  useImperativeHandle(
    ref,
    () => ({
      startCustomEntityDrag,
      cancelCustomEntityDrag,
      attachEntities,
      clearComposer,
      focus: () => textareaRef.current?.focus(),
    }),
    [startCustomEntityDrag, cancelCustomEntityDrag, attachEntities, clearComposer],
  );

  const overlayLabels = dragCustomEntities.map((entity) =>
    entityLabel(customEntityComponents, entity),
  );

  return (
    <div
      ref={dropZoneRef}
      className={[
        'mc-chat',
        isDragActive && 'mc-chat-drag-active',
        isPointerOver && 'mc-chat-drag-over',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="mc-header">
        <h2>MagicChat</h2>
        <span className="mc-header-hint">Operations room</span>
      </header>

      <MessageList
        registry={customEntityComponents}
        messages={messages}
        renderUnknownEntity={renderUnknownEntity}
      />

      <Composer
        ref={textareaRef}
        registry={customEntityComponents}
        attachments={attachments}
        text={text}
        onTextChange={setText}
        onRemoveAttachment={removeAttachment}
        onSend={send}
        renderUnknownEntity={renderUnknownEntity}
      />

      {/*
        The drop overlay, in two tiers.

        `isDragActive` is the base "Drop custom entity here" state, painted for
        the whole gesture. It is now the SAME fact as the latch being armed —
        the mechanism owns the payload, so there is no longer a prop that can
        disagree with it, and the overlay cannot outlive the gesture that
        justified it. That is what retired the stranded-overlay failure mode.

        `isPointerOver` upgrades it to the named "Release to attach <label>"
        state, which can only be true while the pointer is genuinely inside the
        zone, so the specific promise is never made when a drop would not land.

        The two tiers must be distinguishable at a glance, mid-drag, with a drag
        ghost under the cursor — see `dropPrompt` for why the wording and not
        just the styling carries that load.

        `pointer-events: none` in the CSS is not cosmetic:
        `document.elementFromPoint` would otherwise return the overlay on every
        hit test instead of the chat underneath.
      */}
      {isDragActive && (
        <div className="mc-drop-overlay" aria-hidden="true">
          <div className="mc-drop-overlay-card">
            <span className="mc-drop-overlay-icon">＋</span>
            <strong>
              {isPointerOver ? dropPrompt(overlayLabels) : 'Drop custom entity here'}
            </strong>
            <div className="mc-drop-overlay-labels">
              {overlayLabels.map((label, index) => (
                <span key={index} className="mc-drop-overlay-label">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
