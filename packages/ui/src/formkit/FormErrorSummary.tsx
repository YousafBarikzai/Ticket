'use client';

import { useEffect, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type Ref } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { useMergedRefs } from '../web/refs.js';
import { focusField } from './form-data.js';

export interface FormErrorSummaryError {
  /** The id of the control the message is about; empty for a message with no field to go to. */
  readonly fieldId: string;
  readonly message: string;
}

export interface FormErrorSummaryProps {
  /** Each links to its field by id. */
  readonly errors: readonly FormErrorSummaryError[];
  /** Default "There is a problem". */
  readonly title?: string;
  /** A sentence for the whole form ("That didn't save. Your answers are still here."), under the title. */
  readonly description?: ReactNode;
  /** The title's heading level. Default 2: the summary sits at the top of the form, under the page's `h1`. */
  readonly headingLevel?: 2 | 3 | 4;
  /**
   * The summary takes focus when it appears and again whenever this changes
   * — a submit counter, so a second failed attempt is announced as firmly as
   * the first, while fixing fields one by one never pulls focus back.
   */
  readonly focusKey?: string | number;
  /** Default true. Off for a summary rendered on page load (a server's 422 re-rendered), where focus belongs to the page. */
  readonly autoFocus?: boolean;
  readonly id?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * What stopped a submit, listed at the top of the form (SPEC §4.4, 4.10
 * "422"): an alert that takes focus the moment it appears, so a keyboard or
 * screen-reader user lands on it instead of on a submit button that seemed
 * to do nothing, and a link per problem that takes them to the field — to
 * its label, so the question is on screen, with the caret in the box.
 *
 * Built on the GOV.UK error summary, which was researched with people who
 * use screen readers and magnifiers: the title says there is a problem, the
 * list says what, in the same words as the message under each field.
 */
export function FormErrorSummary({
  errors,
  title = 'There is a problem',
  description,
  headingLevel = 2,
  focusKey,
  autoFocus = true,
  id,
  className,
  ref,
}: FormErrorSummaryProps): ReactNode {
  const titleId = useStableId('itsm-error-summary');
  const own = useRef<HTMLDivElement | null>(null);
  const mergedRef = useMergedRefs<HTMLDivElement>(ref, own);
  const hasDescription = description !== undefined && description !== null && description !== false && description !== '';
  const shown = errors.length > 0 || hasDescription;

  // On appearing, and on every new attempt. A layout effect so focus moves
  // before the browser paints the page with the summary in it.
  useBrowserLayoutEffect(() => {
    if (!shown || !autoFocus) return;
    const node = own.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
    // Not on `errors`: a summary whose list shrinks as fields are fixed keeps
    // its place and leaves focus where the person is working.
  }, [shown, autoFocus, focusKey]);

  if (!shown) return null;
  const Heading = headingLevel === 4 ? 'h4' : headingLevel === 3 ? 'h3' : 'h2';

  const follow = (event: MouseEvent<HTMLAnchorElement>, fieldId: string): void => {
    // The link works without JavaScript (a fragment); with it, focus lands in
    // the control rather than on the page, and the label comes into view.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (focusField(fieldId, event.currentTarget.ownerDocument)) event.preventDefault();
  };

  return (
    <div
      ref={mergedRef}
      id={id}
      role="alert"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cx('itsm-FormErrorSummary', className)}
    >
      <Icon name="circle-alert" className="itsm-FormErrorSummary__icon" />
      <div className="itsm-FormErrorSummary__body">
        <Heading id={titleId} className="itsm-FormErrorSummary__title">
          {title}
        </Heading>
        {hasDescription ? <div className="itsm-FormErrorSummary__description">{description}</div> : null}
        {errors.length > 0 ? (
          <ul className="itsm-FormErrorSummary__list">
            {errors.map((error, index) => (
              <li key={`${error.fieldId}\u0000${index}`} className="itsm-FormErrorSummary__item">
                {error.fieldId ? (
                  <a className="itsm-FormErrorSummary__link" href={`#${error.fieldId}`} onClick={(event) => follow(event, error.fieldId)}>
                    {error.message}
                  </a>
                ) : (
                  error.message
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
