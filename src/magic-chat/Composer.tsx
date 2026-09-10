import type { ComponentType } from 'react';
import { forwardRef } from 'react';
import { ComposerEntity } from './EntityRenderer';
import type { AttachedEntity, CustomEntityTypeRegistry, UnknownEntityProps } from './types';

interface ComposerProps {
  registry: CustomEntityTypeRegistry;
  attachments: AttachedEntity[];
  text: string;
  onTextChange: (text: string) => void;
  onRemoveAttachment: (instanceId: string) => void;
  onSend: () => void;
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
}

/**
 * The pre-send area: a bar of attached entities above a text input.
 *
 * Each chip's appearance comes entirely from the host's `composer` renderer for
 * that entity type. The only thing MagicChat contributes is the `remove`
 * callback handed to it.
 */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    registry,
    attachments,
    text,
    onTextChange,
    onRemoveAttachment,
    onSend,
    renderUnknownEntity,
  },
  textareaRef,
) {
  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="mc-composer">
      {attachments.length > 0 && (
        <div className="mc-attachments" aria-label="Attached entities">
          {attachments.map((attached) => (
            <ComposerEntity
              key={attached.instanceId}
              registry={registry}
              attached={attached}
              remove={() => onRemoveAttachment(attached.instanceId)}
              renderUnknownEntity={renderUnknownEntity}
            />
          ))}
        </div>
      )}

      <div className="mc-input-row">
        <textarea
          ref={textareaRef}
          className="mc-input"
          rows={2}
          placeholder="Write a message, or drag an object from the map…"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <button className="mc-send" type="button" onClick={onSend} disabled={!canSend}>
          Send
        </button>
      </div>
    </div>
  );
});
