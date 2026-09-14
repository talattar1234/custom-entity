import type { ComponentType } from 'react';
import { useEffect, useRef } from 'react';
import { MessageEntity } from './EntityRenderer';
import type { ChatMessage, CustomEntityComponentRegistry, UnknownEntityProps } from './types';

interface MessageListProps {
  registry: CustomEntityComponentRegistry;
  messages: ChatMessage[];
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
}

/**
 * Sent messages. Attached entities are rendered with the host's `message`
 * renderer for their type, which is where entity-specific actions live.
 */
export function MessageList({ registry, messages, renderUnknownEntity }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div className="mc-messages">
      {messages.map((message) => (
        <div key={message.id} className={`mc-message mc-message-${message.author}`}>
          <div className="mc-message-meta">
            <span className="mc-message-author">{message.authorName}</span>
            <span className="mc-message-time">{message.sentAt}</span>
          </div>

          {message.text && <p className="mc-message-text">{message.text}</p>}

          {message.entities.length > 0 && (
            <div className="mc-message-entities">
              {message.entities.map((entity, index) => (
                <MessageEntity
                  // Entities are immutable within a sent message, so the index
                  // is a stable key here. MagicChat cannot key on
                  // `properties.id` — it does not know the entity schema.
                  key={index}
                  registry={registry}
                  entity={entity}
                  message={message}
                  renderUnknownEntity={renderUnknownEntity}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
