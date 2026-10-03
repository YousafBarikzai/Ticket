'use client';

import type { AreaLink, AreaModel } from '@itsm/contracts/areas';
import { useEffect, useId, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { IconTile } from '../display/IconTile.js';
import { Icon } from '../icons/Icon.js';
import { MenuContent, MenuGroup, MenuHeading, MenuItem, MenuPortal, MenuRoot, MenuSeparator, MenuTrigger } from '../overlays/Menu.js';
import { areaHopText, areaPersonaLine, SWITCH_AREA_LABEL } from './AreaList.js';

/* -------------------------------------------------------------------------
 * The leaving veil (X-M11)
 * ---------------------------------------------------------------------- */

/** How long the veil may stay if the next page never arrives: the browser's own loading UI takes over. */
const VEIL_TIMEOUT_MS = 10_000;

let veilTimer: number | null = null;
const veilListeners = new Set<(text: string) => void>();

function clearVeil(): void {
  if (typeof document === 'undefined') return;
  delete document.documentElement.dataset.itsmLeaving;
  if (veilTimer !== null) window.clearTimeout(veilTimer);
  veilTimer = null;
}

/**
 * Covers the page while a cross-area hop loads. A demo hop runs through the
 * sibling's `/demo` page and a redirect or two, half a second to a second
 * and a half of the old page sitting still after a click; without a word the
 * visitor clicks again. So the page is veiled, CSS only, in the hop card's
 * look (`html[data-itsm-leaving]`, `AreaSwitcher.styles.ts`), with the hop
 * card's words; the veil is `aria-hidden` and a polite live region in the
 * open menu says the same. It clears on `pageshow` — Back from the next
 * area restores this page from the cache, unveiled — and after ten seconds.
 */
export function beginAreaHop(text: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.itsmLeaving = text;
  if (veilTimer !== null) window.clearTimeout(veilTimer);
  veilTimer = window.setTimeout(clearVeil, VEIL_TIMEOUT_MS);
  window.addEventListener('pageshow', clearVeil, { once: true });
  for (const listener of [...veilListeners]) listener(text);
}

/** For tests: lifts the veil. */
export function resetAreaHopForTesting(): void {
  clearVeil();
}

/** A plain left click or Enter on a link to another origin: the page is about to go. Anything else (a new tab) is not. */
function leavesThisPage(event: MouseEvent<HTMLAnchorElement>, link: AreaLink): boolean {
  if (link.current || link.origin === null) return false;
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

/** Says the veil's words politely, from inside the menu module (nothing before `main` carries a role). */
function HopAnnouncer(): ReactNode {
  const [text, setText] = useState('');
  useEffect(() => {
    veilListeners.add(setText);
    return () => {
      veilListeners.delete(setText);
    };
  }, []);
  return (
    <span className="itsm-visually-hidden" aria-live="polite" aria-atomic="true">
      {text}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * The rows, shared with the account menu
 * ---------------------------------------------------------------------- */

function AreaRow({ link }: { readonly link: AreaLink }): ReactNode {
  const id = useId();
  const persona = areaPersonaLine(link);
  const descriptionId = `${id}-description`;
  const personaId = `${id}-persona`;
  return (
    <MenuItem
      asChild
      textValue={link.name}
      className="itsm-AreaMenu__row"
      aria-current={link.current ? 'true' : undefined}
      aria-describedby={persona ? `${descriptionId} ${personaId}` : descriptionId}
      data-persona={persona ? '' : undefined}
    >
      <a
        href={link.href}
        onClick={(event) => {
          if (leavesThisPage(event, link)) beginAreaHop(areaHopText(link));
        }}
      >
        <IconTile icon={link.icon} size={28} className="itsm-AreaMenu__tile" />
        <span className="itsm-Menu__text">
          <span className="itsm-Menu__itemLabel itsm-AreaMenu__name">
            {link.name}
            {link.current ? <span className="itsm-visually-hidden"> (current area)</span> : null}
          </span>
          <span className="itsm-Menu__description" id={descriptionId}>
            {link.description}
          </span>
          {persona ? (
            <span className="itsm-Menu__description itsm-Menu__detail itsm-AreaMenu__persona" id={personaId}>
              <Icon name="user" size={12} />
              {persona}
            </span>
          ) : null}
        </span>
        {link.current ? <Icon name="check" size="sm" className="itsm-Menu__current" /> : null}
      </a>
    </MenuItem>
  );
}

/**
 * The area rows (A2 §5.3.2): the area's tile, name and one-liner, the demo
 * persona line, and a check with `aria-current="true"` on the current one.
 * Same-tab anchors, never the router's link and never `rel="noreferrer"`
 * (D22). The account menu's Switch area group draws the same rows.
 */
export function AreaMenuRows({ model }: { readonly model: AreaModel }): ReactNode {
  return model.areas.map((link) => <AreaRow key={link.id} link={link} />);
}

/** "IT Service Management home", the demo's way back to the site (D18). */
export function AreaHomeRow({ model }: { readonly model: AreaModel }): ReactNode {
  if (!model.demo || !model.home) return null;
  return (
    <MenuItem asChild textValue={model.home.label} className="itsm-AreaMenu__row itsm-AreaMenu__row--home">
      <a href={model.home.href}>
        <span className="itsm-Menu__leading" aria-hidden="true">
          <Icon name="home" size="sm" />
        </span>
        <span className="itsm-Menu__text">
          <span className="itsm-Menu__itemLabel">{model.home.label}</span>
        </span>
      </a>
    </MenuItem>
  );
}

/* -------------------------------------------------------------------------
 * The menu
 * ---------------------------------------------------------------------- */

export interface AreaMenuPanelProps {
  readonly model: AreaModel;
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The trigger, to tell a rail's card (menu to the right) from a full one (menu below). */
  readonly triggerElement?: () => HTMLElement | null;
}

/** Whether the trigger sits in the collapsed rail, which the sidebar's styles publish as `--_rail: 1`. */
function inRail(element: HTMLElement | null): boolean {
  const sidebar = element?.closest('.itsm-Sidebar');
  if (!(sidebar instanceof HTMLElement)) return false;
  return getComputedStyle(sidebar).getPropertyValue('--_rail').trim() === '1';
}

/**
 * The area menu, loaded on intent by `AreaSwitcher`: 340 px on the menu
 * surface, a "Switch area" heading with the product and workspace under it,
 * one row per area, and in a demo "IT Service Management home". Radix's
 * roving focus, typeahead on the area names, Escape or Tab closing it with
 * focus back on the trigger (A2 §10.1). Below the card, start-aligned; to the
 * right of the rail's tile.
 */
export function AreaMenuPanel({ model, trigger, open, onOpenChange, triggerElement }: AreaMenuPanelProps): ReactNode {
  const side = open && inRail(triggerElement?.() ?? null) ? 'right' : 'bottom';
  return (
    <>
      <MenuRoot modal={false} open={open} onOpenChange={onOpenChange}>
        <MenuTrigger asChild>{trigger}</MenuTrigger>
        <MenuPortal>
          <MenuContent align="start" side={side} aria-label={SWITCH_AREA_LABEL} className="itsm-AreaMenu">
            <MenuHeading className="itsm-AreaMenu__header">
              <span className="itsm-AreaMenu__title">{SWITCH_AREA_LABEL}</span>
              <span className="itsm-AreaMenu__context">{model.workspace ? `${model.product} · ${model.workspace}` : model.product}</span>
            </MenuHeading>
            <MenuGroup className="itsm-AreaMenu__rows">
              <AreaMenuRows model={model} />
            </MenuGroup>
            {model.demo && model.home ? (
              <>
                <MenuSeparator />
                <AreaHomeRow model={model} />
              </>
            ) : null}
          </MenuContent>
        </MenuPortal>
      </MenuRoot>
      <HopAnnouncer />
    </>
  );
}
