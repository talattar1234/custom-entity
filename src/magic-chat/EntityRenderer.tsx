import type { ComponentType } from 'react';
import type {
  AttachedEntity,
  ChatMessage,
  CustomEntity,
  CustomEntityTypeRegistry,
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
export function entityLabel(registry: CustomEntityTypeRegistry, entity: CustomEntity): string {
  const definition = registry[entity.type];
  return definition?.label?.(entity) ?? entity.type;
}

interface ComposerEntityProps {
  registry: CustomEntityTypeRegistry;
  attached: AttachedEntity;
  remove: () => void;
  renderUnknownEntity?: ComponentType<UnknownEntityProps>;
}

export function ComposerEntity({
  registry,
  attached,
  remove,
  renderUnknownEntity,
}: ComposerEntityProps) {
  const definition = registry[attached.entity.type];

  if (!definition) {
    const Unknown = renderUnknownEntity ?? DefaultUnknownEntity;
    return <Unknown entity={attached.entity} surface="composer" />;
  }

  const Composer = definition.composer;
  return (
    <Composer entity={attached.entity} instanceId={attached.instanceId} remove={remove} />
  );
}

interface MessageEntityProps {
  registry: CustomEntityTypeRegistry;
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
