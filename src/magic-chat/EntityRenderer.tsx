import type { ComponentType } from 'react';
import type {
  AttachedEntity,
  ChatMessage,
  CustomEntity,
  CustomEntityComponentRegistry,
  UnknownEntityProps,
} from './types';

/**
 * Registry lookup, in the only two places MagicChat renders an entity.
 *
 * An unregistered `type` must never crash the chat, so both surfaces fall back
 * to a generic chip. Hosts can replace it with `renderUnknownEntity`.
 */

function DefaultUnknownEntity({ entity }: UnknownEntityProps) {
  return <span className="mc-unknown-entity">Unsupported entity: {entity.type}</span>;
}

/** The name to show for an entity in generic chrome (e.g. the drop overlay). */
export function entityLabel(registry: CustomEntityComponentRegistry, entity: CustomEntity): string {
  const definition = registry[entity.type];
  return definition?.label?.(entity) ?? entity.type;
}

interface ComposerEntityProps {
  registry: CustomEntityComponentRegistry;
  attached: AttachedEntity;
  remove: () => void;
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
}

/**
 * One attachment chip: MagicChat's shell around the host's content.
 *
 * The shell and its × belong to MagicChat, not to the host renderer. The
 * attachment list is MagicChat state, so detaching is MagicChat's affordance to
 * offer — a host renderer that forgot to draw a × (or drew one and forgot to
 * wire it) used to strand an entity in the composer with no way out, and the
 * fallback chip for an unregistered type had no × at all. Hosting the control
 * here also makes it uniform across entity types for free.
 *
 * `remove` is still passed down to the renderer. It is an escape hatch, not the
 * primary affordance: a host that wants a second detach control inside its own
 * chrome can have one, and nothing breaks if it ignores it.
 */
export function ComposerEntity({
  registry,
  attached,
  remove,
  renderUnknownEntity,
}: ComposerEntityProps) {
  const definition = registry[attached.entity.type];
  const label = entityLabel(registry, attached.entity);

  let content;
  if (!definition) {
    const Unknown = renderUnknownEntity ?? DefaultUnknownEntity;
    content = <Unknown entity={attached.entity} surface="composer" />;
  } else {
    const Composer = definition.composer;
    content = (
      <Composer entity={attached.entity} instanceId={attached.instanceId} remove={remove} />
    );
  }

  return (
    <span className="mc-chip">
      <span className="mc-chip-content">{content}</span>
      <button
        type="button"
        className="mc-chip-remove"
        onClick={remove}
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

interface MessageEntityProps {
  registry: CustomEntityComponentRegistry;
  entity: CustomEntity;
  message: ChatMessage;
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
}

export function MessageEntity({
  registry,
  entity,
  message,
  renderUnknownEntity,
}: MessageEntityProps) {
  const definition = registry[entity.type];

  if (!definition) {
    const Unknown = renderUnknownEntity ?? DefaultUnknownEntity;
    return <Unknown entity={entity} surface="message" />;
  }

  const Message = definition.message;
  return <Message entity={entity} message={message} />;
}
