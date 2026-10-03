/**
 * The v2 frame props, read as v3 ones, for the compatibility window of RV1
 * (v3 §3.10).
 *
 * The frame's v3 API arrives a wave before the applications move to it, so
 * until the wave-3 integrator removes this file the frame also accepts what
 * the three shells pass today — `brand.name`, `brand.tenant`, `brand.app`,
 * `brand.switcher`, `sidebarHeaderExtra`. Without an `areas` model the frame
 * draws a single, non-interactive area lockup named by `brand.name`: no Area
 * card, no Switch area group. The v2 switcher's rows are not carried over —
 * a real area model needs the person's permissions and the deployment's
 * origins, which only the layouts' `currentAreas()` (wave 3) has.
 *
 * Server-safe and dependency-free: the descriptions are copied from `AREAS`
 * in `@itsm/contracts/areas` (`frame-compat.test.ts` holds them equal) rather
 * than imported, so this temporary path adds nothing to any first load.
 */
import type { AreaId, AreaLink, AreaModel } from '@itsm/contracts/areas';
import type { ReactNode } from 'react';
import type { ShellBrand } from './nav.js';

/** `PRODUCT_NAME` in `@itsm/contracts/areas` (D1). */
export const COMPAT_PRODUCT_NAME = 'IT Service Management';

/** Each area's one-liner and glyph, as `AREAS` has them. */
export const COMPAT_AREA_TEXT: Readonly<Record<AreaId, { readonly name: string; readonly description: string; readonly icon: AreaLink['icon'] }>> = {
  portal: { name: 'Help Portal', description: 'Get help, request things and follow your requests', icon: 'life-buoy' },
  workbench: { name: 'Service Desk', description: 'Work tickets, queues and SLAs', icon: 'inbox' },
  admin: { name: 'Administration', description: 'Set up rules, SLAs, people and reports', icon: 'settings-2' },
};

/**
 * A single-area `AreaModel` from a v2 brand: the current area is `brand.app`
 * (or `fallback`, the provider's app), named by `brand.name`, at
 * `brand.href`; the workspace is `brand.workspace ?? brand.tenant`. Never
 * visible, never a demo.
 */
export function areasFromV2Brand(brand: ShellBrand, fallback: AreaId = 'portal'): AreaModel {
  const id = brand.app ?? fallback;
  const text = COMPAT_AREA_TEXT[id];
  const workspace = brand.workspace ?? brand.tenant;
  const current: AreaLink = { id, name: brand.name ?? text.name, description: text.description, icon: text.icon, href: brand.href, origin: null, current: true };
  return {
    product: COMPAT_PRODUCT_NAME,
    current: id,
    ...(workspace ? { workspace } : {}),
    demo: false,
    visible: false,
    areas: [current],
  };
}

/** What a frame needs of its props, v3 first and the v2 alias second. */
export function frameAreas(props: { readonly areas?: AreaModel; readonly brand: ShellBrand }, fallback?: AreaId): AreaModel {
  return props.areas ?? areasFromV2Brand(props.brand, fallback);
}

/** The sidebar's action: `sidebarAction`, or the v2 `sidebarHeaderExtra` it renamed. */
export function frameSidebarAction(props: { readonly sidebarAction?: ReactNode; readonly sidebarHeaderExtra?: ReactNode }): ReactNode {
  return props.sidebarAction ?? props.sidebarHeaderExtra;
}
