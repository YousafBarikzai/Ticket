import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner } from '../feedback/Spinner.js';
import { formatBytes } from '../format/format.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { FileChipRemove } from './FileChipRemove.js';

export type FileChipState = 'ready' | 'scanning' | 'blocked' | 'unavailable';

export interface FileChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly name: string;
  /** Bytes. */
  readonly size?: number;
  readonly mime?: string;
  /** Where the file can be fetched. Followed only while `state` is `ready`: there are no dead links. */
  readonly href?: string;
  /**
   * `ready` (default); `scanning` while the virus scan runs; `blocked` when
   * the scan refused it; `unavailable` when it exists but cannot be opened
   * yet, which reads "· preview soon" rather than looking broken (X-80).
   */
  readonly state?: FileChipState;
  /** Client only: shows a labelled remove button beside the chip. A server component renders the chip without one. */
  readonly onRemove?: () => void;
  /** The locale the size is written in ("1.2 MB"). `en-GB` by default. */
  readonly locale?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLSpanElement>;
}

const stateText: Readonly<Record<Exclude<FileChipState, 'ready'>, string>> = {
  scanning: 'Scanning…',
  blocked: 'Blocked by the virus scan',
  unavailable: 'preview soon',
};

/** "annual-report.pdf" → ["annual-report", ".pdf"], so the extension survives truncation. */
function splitName(name: string): readonly [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > 8) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/** A visible " · " that a screen reader hears as a pause, not as "dot". */
function Separator(): ReactNode {
  return (
    <>
      <span aria-hidden="true"> · </span>
      <span className="itsm-visually-hidden">, </span>
    </>
  );
}

/**
 * An attachment: a glyph, the name, the size and its state. Server-safe when
 * rendered without `onRemove`.
 *
 * The name truncates in the middle of the word rather than losing its
 * extension ("annual-rep….pdf"), the full name stays in the text a screen
 * reader hears and in `title`. A chip that can be opened is one link — the
 * whole chip is the target — and a remove button, when there is one, is its
 * sibling, never nested inside it. A chip that cannot be opened says why in
 * words: "Scanning…", "Blocked by the virus scan", "preview soon".
 */
export function FileChip({
  name,
  size,
  mime,
  href,
  state = 'ready',
  onRemove,
  locale = 'en-GB',
  className,
  ref,
  ...rest
}: FileChipProps): ReactNode {
  const [base, extension] = splitName(name);
  const meta: string[] = [];
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) meta.push(formatBytes(size, { locale }));
  if (state !== 'ready') meta.push(stateText[state]);

  const inner = (
    <>
      <span className="itsm-FileChip__icon">
        {state === 'scanning' ? <Spinner size="sm" /> : <Icon name={state === 'blocked' ? 'ban' : 'file'} size="sm" />}
      </span>
      <span className="itsm-FileChip__text">
        <span className="itsm-FileChip__name" title={name}>
          <span className="itsm-FileChip__base">{base}</span>
          {extension ? <span className="itsm-FileChip__extension">{extension}</span> : null}
        </span>
        {meta.length > 0 ? (
          <span className="itsm-FileChip__meta">
            {meta.map((part, index) => (
              <span key={part}>
                {index > 0 ? <Separator /> : <span className="itsm-visually-hidden">, </span>}
                {part}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <span {...rest} ref={ref} className={cx('itsm-FileChip', className)} data-state={state} data-mime={mime}>
      {href && state === 'ready' ? (
        <a className="itsm-FileChip__main" href={href}>
          {inner}
        </a>
      ) : (
        <span className="itsm-FileChip__main">{inner}</span>
      )}
      {onRemove ? <FileChipRemove name={name} onRemove={onRemove} /> : null}
    </span>
  );
}
