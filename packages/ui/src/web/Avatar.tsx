import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { AVATAR_HUES } from '../display/tone.js';
import { Icon } from '../icons/Icon.js';
import { cx } from './cx.js';

export { AVATAR_HUES };

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';
export type AvatarKind = 'person' | 'team' | 'system' | 'ai' | 'unassigned';

interface AvatarBaseProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role'> {
  /** Overrides the initials worked out from `name` ("AL" for Ada Lovelace), e.g. when the directory supplies them. */
  readonly initials?: string;
  /**
   * `xs` 20 · `sm` 24 · `md` 32 (default) · `lg` 40 · `xl` 56, or a size in
   * pixels for the rare place off the ramp (the sign-in persona card's 44).
   */
  readonly size?: AvatarSize | number;
  /** Presence, drawn as a dot with its own shape per state and spoken with the name. */
  readonly status?: PresenceStatus;
  /** A 2 px ring in the card's own surface colour, so overlapping avatars and avatars on photos-of-colour stay separate. */
  readonly ring?: boolean;
  /** True inside something that already names the person; the avatar then adds nothing to announce. */
  readonly decorative?: boolean;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

/** Somebody, or something, with a name. */
interface NamedAvatarProps extends AvatarBaseProps {
  /** The person's or team's display name. Drives the initials, the hue and the accessible name. */
  readonly name: string;
  /** `person` (default) is a circle; `team` a rounded square; `ai` and `system` show a glyph instead of initials. */
  readonly kind?: Exclude<AvatarKind, 'unassigned'>;
}

/** Nobody yet: the dashed placeholder an unowned ticket shows where its assignee would be. */
interface UnassignedAvatarProps extends AvatarBaseProps {
  readonly kind: 'unassigned';
  /** Ignored for the drawing; the avatar is always called "Unassigned". */
  readonly name?: string;
}

export type AvatarProps = NamedAvatarProps | UnassignedAvatarProps;

/** Presence in words, for the accessible name and for anyone who cannot tell the dots apart. */
export const presenceLabel: Readonly<Record<PresenceStatus, string>> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

/** What an unassigned avatar is called, on screen beside it and to a screen reader. */
export const UNASSIGNED_LABEL = 'Unassigned';

/** Below the smallest step on the ramp (`xs`, 20 px) two letters no longer fit legibly (X-m18). */
const TWO_LETTER_MIN_PX = 20;

/** The violet slot: the assistant's colour wherever it appears (A1 §7.10). */
const AI_HUE = 3;

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

/** At most `count` letters, counted in code points so a letter outside the BMP is never split. */
function firstLetters(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

/**
 * A person, team or automation, as a monogram. Server-safe.
 *
 * v3 (§2.14, A1 §7.10): white initials on one of eight deep discs, chosen by
 * a hash of the name so a list of people is easy to scan without any colour
 * meaning anything. Every disc is audited against white in every theme
 * (`display/__tests__/avatar-palette.test.ts`; at least 7:1 in light and
 * both high-contrast themes). Two letters at every step of the ramp — `xs`
 * draws them at 9 px with no tracking — and one only below it, when a caller
 * asks for a smaller pixel size. There are no photos: the product serves
 * images only from its own origin, and a monogram never breaks.
 *
 * `kind="unassigned"` is the dashed placeholder for nobody, with a person
 * glyph, called "Unassigned"; it is a shape and a word, never amber (D5).
 * `system` is a neutral disc with a robot, `ai` the violet disc with sparkles.
 *
 * It is an image named by the person ("Ada Lovelace, away") unless
 * `decorative`, where the name is already beside it and saying it twice is
 * noise. Presence is part of the name, not a separate hidden string, because
 * everything inside `role="img"` is presentational.
 */
export function Avatar(props: AvatarProps): ReactNode {
  const { name, initials: given, size = 'md', status, kind = 'person', ring = false, decorative = false, className, style, ref, ...rest } = props;
  const unassigned = kind === 'unassigned';
  const custom = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
  const letterCount = custom !== null && custom < TWO_LETTER_MIN_PX ? 1 : 2;
  const letters = firstLetters(given?.trim() || initials(name ?? ''), letterCount);
  const who = unassigned ? UNASSIGNED_LABEL : (name ?? '');
  const label = status ? `${who}, ${presenceLabel[status].toLowerCase()}` : who;
  const glyph = unassigned ? 'user' : kind === 'ai' ? 'sparkles' : kind === 'system' ? 'bot' : null;
  const hue = unassigned || kind === 'system' ? undefined : kind === 'ai' ? AI_HUE : avatarHue(name ?? '');
  // Dynamic geometry, which is what inline style is for (SPEC §3.3 rule 6).
  const geometry = custom === null ? style : ({ ...style, '--_itsm-avatar-size': `${custom / 16}rem` } as CSSProperties);
  return (
    <span
      {...rest}
      ref={ref}
      className={cx('itsm-Avatar', className)}
      data-size={custom === null ? (size as AvatarSize) : 'custom'}
      data-kind={kind}
      data-hue={hue}
      data-ring={ring ? '' : undefined}
      {...(geometry ? { style: geometry } : {})}
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
