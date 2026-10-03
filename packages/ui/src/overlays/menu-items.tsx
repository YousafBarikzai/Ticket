'use client';

import type * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useId, type ReactNode } from 'react';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { Icon } from '../icons/Icon.js';
import type { LinkComponent } from '../types.js';
import { cx } from '../web/cx.js';
import { Kbd } from '../web/Kbd.js';
import type { MenuItemSpec } from './Menu.js';

/**
 * The Radix parts a menu is drawn with. `Menu` passes the dropdown-menu
 * parts and `ContextMenu` the context-menu ones: the two packages share one
 * implementation and one prop shape, so one renderer draws both and the two
 * menus cannot drift apart.
 */
export interface MenuKit {
  readonly Item: typeof DropdownMenu.Item;
  readonly CheckboxItem: typeof DropdownMenu.CheckboxItem;
  readonly RadioGroup: typeof DropdownMenu.RadioGroup;
  readonly RadioItem: typeof DropdownMenu.RadioItem;
  readonly ItemIndicator: typeof DropdownMenu.ItemIndicator;
  readonly Label: typeof DropdownMenu.Label;
  readonly Separator: typeof DropdownMenu.Separator;
  readonly Group: typeof DropdownMenu.Group;
  readonly Sub: typeof DropdownMenu.Sub;
  readonly SubTrigger: typeof DropdownMenu.SubTrigger;
  readonly SubContent: typeof DropdownMenu.SubContent;
  readonly Portal: typeof DropdownMenu.Portal;
}

interface RenderContext {
  readonly kit: MenuKit;
  readonly Link: LinkComponent | null;
}

type ItemSpec = Extract<MenuItemSpec, { type?: 'item' }>;

function isPlainItem(item: MenuItemSpec): item is ItemSpec {
  return item.type === undefined || item.type === 'item';
}

/** Whether any entry at this level draws something before its label, so every label lines up. */
function hasLeading(items: readonly MenuItemSpec[]): boolean {
  return items.some(
    (item) =>
      item.type === 'checkbox' || item.type === 'radio' || ((isPlainItem(item) || item.type === 'submenu') && item.icon !== undefined),
  );
}

/**
 * One actionable entry. An unavailable entry stays focusable and is announced
 * as dimmed, with its reason as its description (APG: disabled menu items are
 * focusable; Radix would skip them, and a keyboard user would then never hear
 * why). Choosing it does nothing and leaves the menu open.
 */
function MenuEntry({ item, leading, context }: { readonly item: ItemSpec; readonly leading: boolean; readonly context: RenderContext }): ReactNode {
  const { kit, Link } = context;
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const detailId = `${id}-detail`;
  const unavailable = item.disabled === true;
  const secondary = unavailable && item.disabledReason ? item.disabledReason : item.description;
  const describedBy = [secondary ? descriptionId : null, item.detail ? detailId : null].filter(Boolean).join(' ');

  const body = (
    <>
      {leading ? (
        <span className="itsm-Menu__leading" aria-hidden="true">
          {item.icon ? <Icon name={item.icon} size="sm" /> : null}
        </span>
      ) : null}
      <span className="itsm-Menu__text">
        <span className="itsm-Menu__itemLabel" id={labelId}>
          {item.label}
        </span>
        {secondary ? (
          <span className="itsm-Menu__description" id={descriptionId}>
            {secondary}
          </span>
        ) : null}
        {item.detail ? (
          <span className="itsm-Menu__description itsm-Menu__detail" id={detailId}>
            {item.detail}
          </span>
        ) : null}
      </span>
      {item.shortcut ? <Kbd keys={item.shortcut} size="sm" className="itsm-Menu__shortcut" aria-hidden /> : null}
      {item.current ? <Icon name="check" size="sm" className="itsm-Menu__current" /> : null}
    </>
  );

  const shared = {
    className: cx('itsm-Menu__item', item.tone === 'danger' && 'itsm-Menu__item--danger'),
    textValue: item.label,
    'aria-labelledby': labelId,
    'aria-describedby': describedBy || undefined,
    'aria-current': item.current ? ('true' as const) : undefined,
    'aria-disabled': unavailable || undefined,
    'aria-keyshortcuts': item.shortcut ? ariaKeyShortcuts(item.shortcut) : undefined,
    'data-unavailable': unavailable ? '' : undefined,
    onSelect: (event: Event): void => {
      if (unavailable) {
        event.preventDefault();
        return;
      }
      item.onSelect?.();
    },
  };

  if (item.href && !unavailable) {
    const Anchor = Link ?? PlainLink;
    return (
      <kit.Item {...shared} asChild>
        <Anchor href={item.href}>{body}</Anchor>
      </kit.Item>
    );
  }
  return <kit.Item {...shared}>{body}</kit.Item>;
}

const PlainLink: LinkComponent = ({ prefetch, replace, scroll, ...anchor }) => {
  void [prefetch, replace, scroll];
  return <a {...anchor} />;
};

function CheckboxEntry({ item, context }: { readonly item: Extract<MenuItemSpec, { type: 'checkbox' }>; readonly context: RenderContext }): ReactNode {
  const { kit } = context;
  return (
    <kit.CheckboxItem className="itsm-Menu__item" textValue={item.label} checked={item.checked} onCheckedChange={item.onCheckedChange}>
      <span className="itsm-Menu__leading" aria-hidden="true">
        <kit.ItemIndicator className="itsm-Menu__indicator">
          <Icon name="check" size="sm" />
        </kit.ItemIndicator>
      </span>
      <span className="itsm-Menu__text">
        <span className="itsm-Menu__itemLabel">{item.label}</span>
      </span>
    </kit.CheckboxItem>
  );
}

function RadioEntry({ item, context }: { readonly item: Extract<MenuItemSpec, { type: 'radio' }>; readonly context: RenderContext }): ReactNode {
  const { kit } = context;
  const headingId = useId();
  // The radio group is itself the `group`, named by the heading before it.
  return (
    <>
      <kit.Label className="itsm-Menu__heading" id={headingId}>
        {item.label}
      </kit.Label>
      <kit.RadioGroup className="itsm-Menu__group" value={item.value} onValueChange={item.onValueChange} aria-labelledby={headingId}>
        {item.items.map((option) => (
          <kit.RadioItem key={option.value} className="itsm-Menu__item" value={option.value} textValue={option.label}>
            <span className="itsm-Menu__leading" aria-hidden="true">
              <kit.ItemIndicator className="itsm-Menu__indicator">
                <Icon name="check" size="sm" />
              </kit.ItemIndicator>
            </span>
            <span className="itsm-Menu__text">
              <span className="itsm-Menu__itemLabel">{option.label}</span>
            </span>
          </kit.RadioItem>
        ))}
      </kit.RadioGroup>
    </>
  );
}

function SubmenuEntry({ item, leading, context }: { readonly item: Extract<MenuItemSpec, { type: 'submenu' }>; readonly leading: boolean; readonly context: RenderContext }): ReactNode {
  const { kit } = context;
  return (
    <kit.Sub>
      <kit.SubTrigger className="itsm-Menu__item itsm-Menu__subTrigger" textValue={item.label}>
        {leading ? (
          <span className="itsm-Menu__leading" aria-hidden="true">
            {item.icon ? <Icon name={item.icon} size="sm" /> : null}
          </span>
        ) : null}
        <span className="itsm-Menu__text">
          <span className="itsm-Menu__itemLabel">{item.label}</span>
        </span>
        <Icon name="chevron-right" size="sm" directional className="itsm-Menu__chevron" />
      </kit.SubTrigger>
      <kit.Portal>
        <kit.SubContent className="itsm-Menu__content itsm-Menu__content--sub" sideOffset={2} alignOffset={-6} collisionPadding={8} loop>
          <MenuItems items={item.items} context={context} />
        </kit.SubContent>
      </kit.Portal>
    </kit.Sub>
  );
}

/**
 * A run of entries. A `label` opens a group (named by that label) that runs
 * to the next separator or label, so a screen reader announces "Sort by,
 * group" as focus enters it rather than reading the label as a dead item.
 */
export function MenuItems({ items, context }: { readonly items: readonly MenuItemSpec[]; readonly context: RenderContext }): ReactNode {
  const leading = hasLeading(items);
  const out: ReactNode[] = [];
  let group: { readonly key: string; readonly label: string; readonly children: ReactNode[] } | null = null;
  const push = (node: ReactNode): void => {
    if (group) group.children.push(node);
    else out.push(node);
  };
  const closeGroup = (): void => {
    if (!group) return;
    out.push(<LabelledGroup key={group.key} label={group.label} kit={context.kit}>{group.children}</LabelledGroup>);
    group = null;
  };

  items.forEach((item, index) => {
    switch (item.type) {
      case 'separator':
        closeGroup();
        out.push(<context.kit.Separator key={`separator-${index}`} className="itsm-Menu__separator" />);
        break;
      case 'label':
        closeGroup();
        group = { key: `group-${index}`, label: item.label, children: [] };
        break;
      case 'checkbox':
        push(<CheckboxEntry key={item.id} item={item} context={context} />);
        break;
      case 'radio':
        closeGroup();
        out.push(<RadioEntry key={item.id} item={item} context={context} />);
        break;
      case 'submenu':
        push(<SubmenuEntry key={item.id} item={item} leading={leading} context={context} />);
        break;
      default:
        push(<MenuEntry key={item.id} item={item} leading={leading} context={context} />);
    }
  });
  closeGroup();
  return <>{out}</>;
}

function LabelledGroup({ label, kit, children }: { readonly label: string; readonly kit: MenuKit; readonly children: ReactNode }): ReactNode {
  const id = useId();
  return (
    <kit.Group className="itsm-Menu__group" aria-labelledby={id}>
      <kit.Label className="itsm-Menu__heading" id={id}>
        {label}
      </kit.Label>
      {children}
    </kit.Group>
  );
}
