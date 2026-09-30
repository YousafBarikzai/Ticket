'use client';

import { useState, type ReactNode } from 'react';
import { Button, DurationField, FormField, IconButton, Input } from '@itsm/ui';
import { Menu } from '@itsm/ui/overlays';
import {
  DEFAULT_THRESHOLDS,
  PRIORITY_ROWS,
  TARGET_LABELS,
  TARGET_TYPES,
  cellKey,
  formatTarget,
  readDuration,
  readThresholds,
  type TargetType,
  type TargetsModel,
} from './presentation.js';

/**
 * The P1–P4 × promise grid of a policy's targets (SPEC §6.1): one
 * `DurationField` per cell, in business hours and minutes. An empty cell is
 * *no target* — never a default — and a pair can only be written once, so
 * duplicates are impossible by construction.
 *
 * What the old form got wrong and this does not:
 *   - a typo was saved as sixty minutes (`Number(x) || 60`); here a cell
 *     that does not read as a duration is marked, said in words under it, and
 *     the caller refuses to save while any is (`invalid`);
 *   - rows could be added but never removed; here a column is removed with
 *     its ×, and a cell by emptying it.
 *
 * Columns show the promises in use; "+ Add target type" reveals the others.
 * Warning thresholds are per column, under *Advanced*.
 *
 * Wide, it is a table with the promises across the top. In a narrow
 * container (a phone, a narrow sheet) each priority becomes a card with its
 * fields labelled — the same controls, restyled by a container query.
 */
export interface TargetsGridProps {
  readonly value: TargetsModel;
  readonly onChange: (next: TargetsModel) => void;
  /** Cells whose text is not a duration, by `cellKey`. */
  readonly invalid: ReadonlySet<string>;
  readonly onInvalidChange: (next: ReadonlySet<string>) => void;
  /** Column thresholds whose text is not a list of percentages, by type. */
  readonly thresholdErrors: Readonly<Record<string, string>>;
  readonly onThresholdErrorsChange: (next: Readonly<Record<string, string>>) => void;
  /** What is saved, to mark changed cells; absent for a new policy. */
  readonly saved?: TargetsModel;
  /** The group's name: "Targets". */
  readonly label: string;
}

export function TargetsGrid({ value, onChange, invalid, onInvalidChange, thresholdErrors, onThresholdErrorsChange, saved, label }: TargetsGridProps): ReactNode {
  const unused = TARGET_TYPES.filter((type) => !value.types.includes(type));
  // The thresholds as typed, so "50, 7" can be half-way to "50, 75".
  const [thresholdText, setThresholdText] = useState<Record<string, string>>(() =>
    Object.fromEntries(TARGET_TYPES.map((type) => [type, (value.thresholds[type] ?? DEFAULT_THRESHOLDS).join(', ')])),
  );

  const setCell = (key: string, minutes: number | null): void => {
    const cells = { ...value.cells };
    if (minutes === null) delete cells[key];
    else cells[key] = minutes;
    onChange({ ...value, cells });
  };

  const markText = (key: string, text: string): void => {
    const bad = readDuration(text) === 'invalid';
    if (bad === invalid.has(key)) return;
    const next = new Set(invalid);
    if (bad) next.add(key);
    else next.delete(key);
    onInvalidChange(next);
  };

  const addType = (type: TargetType): void => {
    onChange({ ...value, types: TARGET_TYPES.filter((entry) => entry === type || value.types.includes(entry)) });
  };

  const removeType = (type: TargetType): void => {
    const cells = { ...value.cells };
    for (const row of PRIORITY_ROWS) delete cells[cellKey(row.id, type)];
    const nextInvalid = new Set([...invalid].filter((key) => !key.endsWith(`:${type}`)));
    if (nextInvalid.size !== invalid.size) onInvalidChange(nextInvalid);
    if (thresholdErrors[type]) {
      const { [type]: _gone, ...rest } = thresholdErrors;
      onThresholdErrorsChange(rest);
    }
    onChange({ ...value, cells, types: value.types.filter((entry) => entry !== type) });
  };

  const setThresholds = (type: TargetType, text: string): void => {
    setThresholdText((current) => ({ ...current, [type]: text }));
    const read = readThresholds(text);
    const errors = { ...thresholdErrors };
    if ('error' in read) {
      errors[type] = read.error;
      onThresholdErrorsChange(errors);
      return;
    }
    delete errors[type];
    onThresholdErrorsChange(errors);
    onChange({ ...value, thresholds: { ...value.thresholds, [type]: read.value } });
  };

  return (
    <div className="app-Targets" role="group" aria-label={label}>
      <div className="app-Targets__scroller">
        <table className="app-Targets__table">
          <thead>
            <tr>
              <th scope="col" className="app-Targets__corner">
                Priority
              </th>
              {value.types.map((type) => (
                <th key={type} scope="col" className="app-Targets__head">
                  <span className="app-Targets__headText">
                    <span className="app-Targets__type">{TARGET_LABELS[type].label}</span>
                    <span className="app-Targets__typeHint">{TARGET_LABELS[type].description}</span>
                  </span>
                  {value.types.length > 1 ? (
                    <IconButton
                      icon="x"
                      size="sm"
                      label={`Remove the ${TARGET_LABELS[type].label.toLowerCase()} targets`}
                      onClick={() => removeType(type)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRIORITY_ROWS.map((row) => (
              <tr key={row.id} className="app-Targets__row">
                <th scope="row" className="app-Targets__priority">
                  {row.label}
                </th>
                {value.types.map((type) => {
                  const key = cellKey(row.id, type);
                  const current = value.cells[key] ?? null;
                  const before = saved ? (saved.cells[key] ?? null) : current;
                  const changed = saved !== undefined && before !== current;
                  const fieldLabel = `${row.id} ${TARGET_LABELS[type].label.toLowerCase()} target${
                    changed ? (before === null ? ', new' : `, changed from ${formatTarget(before)}`) : ''
                  }`;
                  return (
                    <td key={type} className="app-Targets__cell" data-changed={changed ? '' : undefined}>
                      <span className="app-Targets__cellLabel" aria-hidden="true">
                        {TARGET_LABELS[type].label}
                      </span>
                      <DurationField
                        label={fieldLabel}
                        size="sm"
                        units={['h', 'm']}
                        value={current}
                        placeholder="No target"
                        invalid={invalid.has(key)}
                        onChange={(minutes) => setCell(key, minutes)}
                        onInput={(event) => markText(key, (event.target as HTMLInputElement).value)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="app-Targets__foot">
        {unused.length > 0 ? (
          <Menu
            trigger={
              <Button variant="ghost" size="sm" iconStart="plus">
                Add target type
              </Button>
            }
            items={unused.map((type) => ({
              id: type,
              label: TARGET_LABELS[type].label,
              description: TARGET_LABELS[type].description,
              onSelect: () => addType(type),
            }))}
          />
        ) : null}
        <p className="app-Targets__note">Business hours and minutes, counted on the policy’s clock. Leave a cell empty for no target.</p>
      </div>

      <details className="app-Targets__advanced">
        <summary>Advanced: warning thresholds</summary>
        <p className="app-Targets__note">
          A timer warns as it uses up these shares of its time, so escalations can fire before a breach. Each promise has its own.
        </p>
        <div className="app-Targets__thresholds">
          {value.types.map((type) => (
            <FormField
              key={type}
              label={`${TARGET_LABELS[type].label}: warn at`}
              hint="Percent of the time used, like 50, 75, 90"
              {...(thresholdErrors[type] ? { error: thresholdErrors[type] } : {})}
            >
              <Input
                value={thresholdText[type] ?? ''}
                inputMode="numeric"
                suffix="%"
                onChange={(event) => setThresholds(type, event.currentTarget.value)}
              />
            </FormField>
          ))}
        </div>
      </details>
    </div>
  );
}
