import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { AVATAR_HUES } from '../display/tone.js';
import { Icon } from '../icons/Icon.js';
import { cx } from './cx.js';

export { AVATAR_HUES };

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';
export type AvatarKind = 'person' | 'team' | 'system' | 'ai';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role'> {
  /** The person's or team's display name. Drives the initials, the hue and the accessible name. */
  readonly name: string;
  /** Overrides the initials worked out from `name` ("AL" for Ada Lovelace), e.g. when the directory supplies them. */
  readonly initials?: string;
  /** `xs` 20 · `sm` 24 · `md` 32 (default) · `lg` 40 · `xl` 56. */
  readonly size?: AvatarSize;
  /** Presence, drawn as a dot with its own shape per state and spoken with the name. */
  readonly status?: PresenceStatus;
  /** `person` (default) is a circle; `team` a rounded square; `ai` and `system` show a glyph instead of initials. */
  readonly kind?: AvatarKind;
  /** True inside something that already names the person; the avatar then adds nothing to announce. */
  readonly decorative?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/** Presence in words, for the accessible name and for anyone who cannot tell the dots apart. */
export const presenceLabel: Readonly<Record<PresenceStatus, string>> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

/**
 * "Ada Lovelace" → "AL", "Ada" → "A", "ada.lovelace@example.com" → "AL",
 * "  " → "".
 *
 * An address stands in for a name often enough (a requester who emailed in)
 * that its local part is read as one. Code points rather than UTF-16 units,
 * so a name that starts outside the Basic Multilingual Plane is not cut in
 * half; upper-cased without a locale, so the server and the browser agree.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  const source = /^[^\s@]+@[^\s@]+$/.test(trimmed) ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed;
  const words = source.split(/[\s._-]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1] ?? '')[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * The hue slot (1–8) for a name: FNV-1a over the trimmed, lower-cased name,
 * so the same person has the same colour on every page, in every app and
 * after every reload, with nothing stored.
 */
export function avatarHue(name: string): number {
  let hash = 0x811c9dc5;
  for (const character of name.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % AVATAR_HUES) + 1;
}

/**
 * A person, team or automation, as a monogram. Server-safe.
 *
 * Initials sit on a tint of one of the eight categorical hues, chosen by a
 * hash of the name, so a list of people is easy to scan without any colour
 * meaning anything; every tint is checked against its text colour in every
 * theme (see `display/__tests__/avatar-tints.test.ts`). There are no photos:
 * the product serves images only from its own origin, and a monogram never
 * breaks.
 *
 * It is an image named by the person ("Ada Lovelace, away") unless
 * `decorative`, where the name is already beside it and saying it twice is
 * noise. Presence is part of the name, not a separate hidden string, because
 * everything inside `role="img"` is presentational.
 */
export function Avatar({
  name,
  initials: given,
  size = 'md',
  status,
  kind = 'person',
  decorative = false,
  className,
  ref,
  ...rest
}: AvatarProps): ReactNode {
  const letters = (given?.trim() || initials(name)).slice(0, size === 'xs' ? 1 : 2);
  const label = status ? `${name}, ${presenceLabel[status].toLowerCase()}` : name;
  const glyph = kind === 'ai' ? 'sparkles' : kind === 'system' ? 'bot' : null;
  return (
    <span
      {...rest}
      ref={ref}
      className={cx('itsm-Avatar', className)}
      data-size={size}
      data-kind={kind}
      data-hue={kind === 'system' ? undefined : kind === 'ai' ? 5 : avatarHue(name)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label, title: label })}
    >
      {glyph ? (
        <Icon name={glyph} className="itsm-Avatar__glyph" />
      ) : (
        <span className="itsm-Avatar__initials" aria-hidden="true">
          {letters}
        </span>
      )}
      {status ? <span className="itsm-Avatar__status" data-status={status} aria-hidden="true" /> : null}
    </span>
  );
}
