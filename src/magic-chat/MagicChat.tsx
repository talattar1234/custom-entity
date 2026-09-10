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
 * A mock chat that accepts custom entities dragged in from the host app.
 *
 * MagicChat knows only the generic shape `{ type, properties }`. Everything
 * entity-specific — appearance, actions — comes from the host's renderers in
 * `customEntityTypes`.
 */
export const MagicChat = forwardRef<MagicChatHandle, MagicChatProps>(function MagicChat(
  {
    customEntityTypes,
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
          const getId = customEntityTypes[entity.type]?.getId;
          if (getId) {
            const id = getId(entity);
            const alreadyAttached = next.some(
              (candidate) =>
                candidate.entity.type === entity.type &&
                customEntityTypes[candidate.entity.type]?.getId?.(candidate.entity) === id,
            );
            if (alreadyAttached) continue;
          }

          next.push({ instanceId: nextInstanceId(), entity });
        }

        return next;
      });
    },
    [customEntityTypes],
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
    entityLabel(customEntityTypes, entity),
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
        registry={customEntityTypes}
        messages={messages}
        renderUnknownEntity={renderUnknownEntity}
      />

      <Composer
        ref={textareaRef}
        registry={customEntityTypes}
        attachments={attachments}
        text={text}
        onTextChange={setText}
        onRemoveAttachment={removeAttachment}
        onSend={send}
        renderUnknownEntity={renderUnknownEntity}
      />

      {/*
        The drop overlay. It is `pointer-events: none` in CSS, which is not
        cosmetic: `document.elementFromPoint` would otherwise return the overlay
        on every hit test instead of the chat underneath.

        Shown for the whole drag (so it is obvious MagicChat recognises the
        entity) and intensified once the pointer is actually inside.
      */}
      {isDragActive && (
        <div className="mc-drop-overlay" aria-hidden="true">
          <div className="mc-drop-overlay-card">
            <span className="mc-drop-overlay-icon">＋</span>
            <strong>
              {isPointerOver
                ? overlayLabels.length === 1
                  ? `Drop ${overlayLabels[0]} here`
                  : `Drop ${overlayLabels.length} custom entities here`
                : 'Drop custom entity here'}
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
