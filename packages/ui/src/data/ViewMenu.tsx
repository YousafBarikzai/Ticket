'use client';

import type { ReactNode } from 'react';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { cx } from '../web/cx.js';

export interface ViewMenuColumn {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly hideable: boolean;
}

export interface ViewMenuProps {
  readonly sort?: {
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly value: string;
    onChange(value: string): void;
  };
  /** Offers Comfortable / Compact. */
  readonly density?: boolean;
  readonly columns?: readonly ViewMenuColumn[];
  onColumnsChange?(columns: ViewMenuColumn[]): void;
  readonly extra?: readonly MenuItemSpec[];
  readonly className?: string;
}

/**
 * One "View" menu for how a list looks — sort, density, columns, technical
 * keys — instead of a row of separate buttons.
 *
 * Stub (SPEC §4.7): renders nothing; the data package builds it on `Menu`.
 */
export function ViewMenu(props: ViewMenuProps): ReactNode {
  void props;
  return null;
}
