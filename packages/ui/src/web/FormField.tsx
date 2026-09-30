'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { joinIds, useIds } from '../a11y/ids.js';
import { useMappedFieldError } from '../formkit/form-context.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { cx } from './cx.js';

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
  readonly required: boolean;
}

const FieldContext = createContext<FieldControlProps | null>(null);

/**
 * The wiring of the `FormField` around a control, or `null` outside one.
 * `Input`, `Textarea`, `Select` and the `controls/` fields read it, so
 * `<FormField label="Summary"><Input /></FormField>` needs no render prop;
 * props the caller passes explicitly still win.
 */
export function useFieldControl(): FieldControlProps | null {
  return useContext(FieldContext);
}

/**
 * A control's own props merged over its field's wiring: the caller's id
 * wins, descriptions are joined (the field's first), and invalid/required
 * hold if either says so.
 */
export function mergeFieldProps<P extends { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; 'aria-required'?: unknown; required?: boolean }>(
  field: FieldControlProps | null,
  props: P,
): P {
  if (!field) return props;
  const invalid = props['aria-invalid'] ?? field['aria-invalid'];
  const required = props.required ?? field.required;
  // A render prop spreads the same wiring the context carries: each id once.
  const described = joinIds(field['aria-describedby'], props['aria-describedby']);
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': described ? [...new Set(described.split(/\s+/))].join(' ') : undefined,
    'aria-invalid': invalid,
    'aria-required': props['aria-required'] ?? field['aria-required'],
    required,
  };
}

export interface FormFieldProps {
  readonly label: ReactNode;
  /**
   * The control: a node that reads the field's context (`Input`, `Textarea`,
   * `Select`, the `controls/` fields), or a render prop that receives the
   * wiring explicitly — for a custom control (Combobox, DatePicker, a
   * third-party editor) that does not read it.
   */
  readonly children: ReactNode | ((control: FieldControlProps) => ReactNode);
  readonly hint?: ReactNode;
  /** A string, not a boolean: "this is wrong" without saying why fails SC 3.3.3. */
  readonly error?: string;
  readonly required?: boolean;
  /**
   * Marks the field "(optional)" instead of marking the others required —
   * for forms where most answers are needed. Ignored with `required`.
   */
  readonly optional?: boolean;
  /** A character count under the control, for a limit the person should see coming. */
  readonly counter?: { readonly max: number };
  /**
   * `inline` puts the label beside the control once the field is wide enough
   * (a container query, not the viewport), as settings pages lay out.
   */
  readonly layout?: 'stacked' | 'inline';
  /** Hides the label visually but keeps it for assistive technology and for voice control. */
  readonly labelHidden?: boolean;
  /** The control's id, when something else needs to point at it (an error summary link). */
  readonly id?: string;
  readonly className?: string;
}

/**
 * A label, an optional hint, the control, and its error, wired together.
 *
 * The hint sits between the label and the control, where it is read before
 * the person starts typing; the error sits under the control with an icon,
 * because colour alone never carries it. Both are referenced by the control's
 * `aria-describedby`, the hint first — a screen reader reads descriptions in
 * order, and the error is the more recent, more urgent half.
 */
export function FormField({
  label,
  children,
  hint,
  error: ownError,
  required = false,
  optional = false,
  counter,
  layout = 'stacked',
  labelHidden = false,
  id,
  className,
}: FormFieldProps): ReactNode {
  const ids = useIds('itsm-field', ['control', 'hint', 'error', 'count'] as const);
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const controlId = id ?? ids.control;
  // Inside a `Form`, the message a failed submit mapped onto this control
  // (by its id) shows here without the caller passing it; an explicit
  // `error` wins.
  const mappedError = useMappedFieldError(controlId);
  const error = ownError ?? mappedError;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const length = useControlLength(counter ? controlId : null);

  const control = useMemo<FieldControlProps>(
    () => ({
      id: controlId,
      'aria-describedby': joinIds(hasHint && ids.hint, error && ids.error, counter && ids.count),
      'aria-invalid': error ? true : undefined,
      'aria-required': required ? true : undefined,
      required,
    }),
    [controlId, hasHint, ids, error, counter, required],
  );

  const labelNode = (
    <label className={cx('itsm-Field__label', labelHidden && 'itsm-visually-hidden')} htmlFor={controlId}>
      {label}
      {required ? (
        <span className="itsm-Field__required" aria-hidden="true">
          *
        </span>
      ) : optional ? (
        <span className="itsm-Field__optional"> {messages.optional}</span>
      ) : null}
    </label>
  );
  const hintNode = hasHint ? (
    <span className="itsm-Field__hint" id={ids.hint}>
      {hint}
    </span>
  ) : null;
  const errorNode = error ? (
    // Not role="alert": the error is already referenced by the control, and
    // an alert would interrupt the person mid-keystroke on every re-render.
    <span className="itsm-Field__error" id={ids.error}>
      <Icon name="circle-alert" size="xs" className="itsm-Field__errorIcon" />
      <span>{error}</span>
    </span>
  ) : null;
  const countNode = counter ? <CharacterCount id={ids.count} length={length.value} max={counter.max} /> : null;
  const body = (
    <FieldContext value={control}>{typeof children === 'function' ? children(control) : children}</FieldContext>
  );
  const footer =
    errorNode || countNode ? (
      <div className="itsm-Field__footer">
        {errorNode}
        {countNode}
      </div>
    ) : null;

  if (layout === 'inline') {
    return (
      <div className={cx('itsm-Field', 'itsm-Field--inline', className)} onInput={length.onInput}>
        <div className="itsm-Field__grid">
          <div className="itsm-Field__head">
            {labelNode}
            {hintNode}
          </div>
          <div className="itsm-Field__body">
            {body}
            {footer}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cx('itsm-Field', className)} onInput={length.onInput}>
      {labelNode}
      {hintNode}
      {body}
      {footer}
    </div>
  );
}

/**
 * The length of the text in the control with this id, kept current for
 * typing (the `input` event bubbles to the field) and for a value the caller
 * changed in code (read after every render of the field).
 */
function useControlLength(controlId: string | null): { readonly value: number; onInput(event: FormEvent<HTMLElement>): void } {
  const [value, setValue] = useState(0);

  useLayoutEffect(() => {
    if (!controlId) return;
    const element = document.getElementById(controlId);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) setValue(element.value.length);
  });

  return {
    value,
    onInput(event) {
      if (!controlId) return;
      const target = event.target;
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.id === controlId) {
        setValue(target.value.length);
      }
    },
  };
}

export interface CharacterCountProps {
  /** The id the control's `aria-describedby` points at: it reads "Up to 280 characters". */
  readonly id: string;
  readonly length: number;
  readonly max: number;
  readonly className?: string;
}

/** How long typing must pause before the remaining count is spoken. */
const COUNT_ANNOUNCE_MS = 1000;

function plural(n: number, one: string, other: string): string {
  return `${n} ${n === 1 ? one : other}`;
}

/**
 * "120/280" under a field, turning to a warning near the limit and to an
 * error past it (with an icon — never colour alone).
 *
 * Built on the GOV.UK character-count pattern, which was tested with screen
 * reader users: the control is described once with the limit ("Up to 280
 * characters"), and the remaining count is spoken politely only when typing
 * pauses and only once the limit is near — not on every keystroke, which
 * would drown out the text being typed.
 */
export function CharacterCount({ id, length, max, className }: CharacterCountProps): ReactNode {
  const remaining = max - length;
  const near = remaining <= Math.max(10, Math.round(max * 0.1));
  const state = remaining < 0 ? 'over' : near ? 'near' : 'ok';
  const [spoken, setSpoken] = useState('');
  const first = useRef(true);

  useEffect(() => {
    // Nothing is said about the text a field arrived with.
    if (first.current) {
      first.current = false;
      return;
    }
    if (state === 'ok') {
      setSpoken('');
      return;
    }
    const timer = setTimeout(() => {
      setSpoken(
        remaining < 0
          ? `You have ${plural(-remaining, 'character', 'characters')} too many`
          : `You have ${plural(remaining, 'character', 'characters')} left`,
      );
    }, COUNT_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [length, remaining, state]);

  return (
    <span className={cx('itsm-Count', className)} data-state={state}>
      {state === 'over' ? <Icon name="circle-alert" size="xs" className="itsm-Count__icon" /> : null}
      <span className="itsm-Count__value" aria-hidden="true">
        {length}/{max}
      </span>
      <span className="itsm-visually-hidden" id={id}>
        {`Up to ${plural(max, 'character', 'characters')}`}
      </span>
      <span className="itsm-visually-hidden" role="status">
        {spoken}
      </span>
    </span>
  );
}
