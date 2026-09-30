import type { ReactNode } from 'react';
import { Disclosure } from '@itsm/ui';
import type { AdminNavItem } from '../../navigation.js';
import { TechnicalKey } from './TechnicalKey.js';

export interface WithheldEntry {
  readonly item: Pick<AdminNavItem, 'id' | 'label' | 'description'>;
  readonly needs: string;
  readonly needsLabel: string;
}

/**
 * "3 sections aren't available to you" (ADR-0049, SPEC §6.1): the sections
 * this person cannot open, each with the permission to ask for in words —
 * and the key, with Copy, for people who show technical keys. Collapsed,
 * because it is reference rather than news; open when it is the whole story
 * (nothing else on the console is reachable). Never mentions the platform.
 */
export function WithheldSections({ withheld, open = false }: { readonly withheld: readonly WithheldEntry[]; readonly open?: boolean }): ReactNode {
  if (withheld.length === 0) return null;
  const summary = `${withheld.length} ${withheld.length === 1 ? 'section isn’t' : 'sections aren’t'} available to you`;
  return (
    <Disclosure summary={summary} defaultOpen={open} className="app-Withheld">
      <ul className="app-Withheld__list">
        {withheld.map(({ item, needs, needsLabel }) => (
          <li key={item.id} className="app-Withheld__item">
            <div>
              <p className="app-Withheld__label">{item.label}</p>
              <p className="app-Withheld__description">{item.description}</p>
            </div>
            <p className="app-Withheld__needs">
              <span>
                Needs <strong>{needsLabel}</strong>
              </span>
              <TechnicalKey value={needs} label="permission key" />
            </p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
