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

/** Stable default, so an omitted prop does not produce a new array each render. */
const NO_ENTITIES: CustomEntity[] = [];

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
 */
export const MagicChat = forwardRef<MagicChatHandle, MagicChatProps>(function MagicChat(
  {
    customEntityComponents,
    dragCustomEntities = NO_ENTITIES,
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
      // Tell the host we took them, so it can clear `dragCustomEntities`.
      onDragCustomEntitiesConsumed?.(entities);
      textareaRef.current?.focus();
    },
    [attachEntities, onDragCustomEntitiesConsumed],
  );

  const { dropZoneRef, isDragActive, isPointerOver } = useCustomEntityDropTarget({
    dragCustomEntities,
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
      attachEntities,
      clearComposer,
      focus: () => textareaRef.current?.focus(),
    }),
    [attachEntities, clearComposer],
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

        Visibility is prop-driven: `isDragActive` is simply "the host put
        entities in `dragCustomEntities`", so the base "Drop custom entity here"
        state is painted for the whole gesture. That claim stays true whatever
        the mechanism's latch is doing.

        `isPointerOver` upgrades it to the named "Release to attach <label>"
        state. That flag can only be true while the drop target is armed, so the
        specific promise is never made when a drop would not actually land.

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
