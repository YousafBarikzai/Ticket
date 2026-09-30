'use client';

import { useMemo, type ReactNode } from 'react';
import { useHotkeyRegistry, type HotkeyListing } from '../a11y/hotkeys.js';
import { isSingleKeyShortcut, parseShortcut } from '../a11y/keys.js';
import { useStableId } from '../a11y/ids.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { cx } from '../web/cx.js';
import { Dialog } from '../web/Dialog.js';
import { Kbd } from '../web/Kbd.js';
import { Switch } from '../web/Switch.js';

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
}

/** The group every app has, listed first; the rest follow in the order the page registered them. */
const FIRST_GROUP = 'General';

interface Group {
  readonly name: string;
  readonly items: readonly HotkeyListing[];
}

function groupListings(listings: readonly HotkeyListing[]): Group[] {
  const groups = new Map<string, HotkeyListing[]>();
  for (const listing of listings) {
    const list = groups.get(listing.group);
    if (list) list.push(listing);
    else groups.set(listing.group, [listing]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => (a.name === FIRST_GROUP ? -1 : b.name === FIRST_GROUP ? 1 : 0));
}

function GroupList({ group, singleKeysOff }: { readonly group: Group; readonly singleKeysOff: boolean }): ReactNode {
  const headingId = useStableId('itsm-shortcuts-group');
  return (
    <section className="itsm-ShortcutsDialog__group" aria-labelledby={headingId}>
      <h3 className="itsm-ShortcutsDialog__groupTitle" id={headingId}>
        {group.name}
      </h3>
      <ul className="itsm-ShortcutsDialog__list">
        {group.items.map((item) => {
          const off = singleKeysOff && isSingleKeyShortcut(parseShortcut(item.keys));
          return (
            <li key={`${item.keys}|${item.description}`} className="itsm-ShortcutsDialog__row" data-off={off || undefined}>
              <span className="itsm-ShortcutsDialog__action">
                {item.description}
                {off ? <span className="itsm-ShortcutsDialog__offNote"> · Off</span> : null}
              </span>
              <Kbd keys={item.keys} className="itsm-ShortcutsDialog__keys" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Every shortcut bound on this page, by group, from the hotkey registry — so
 * the list is what the keyboard actually does here, not a page of
 * documentation that drifts from it.
 *
 * Above the list sits the switch WCAG 2.1.4 asks for: single-key shortcuts
 * (`c`, `j`, `?`) can be turned off, for people using speech input or a
 * switch device, whose "c" should type a c. Combinations with ⌘ or Ctrl keep
 * working. The workbench adds the switch for live announcements (X-66).
 *
 * Opened by `?` and from the account menu's *Keyboard shortcuts…*.
 */
export function ShortcutsDialog({ open, onOpenChange, className }: ShortcutsDialogProps): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const { prefs, setPrefs } = useTheme();
  const listings = useHotkeyRegistry();
  const groups = useMemo(() => groupListings(listings), [listings]);
  const singleKeysOff = prefs.shortcuts === 'off';
  const workbench = itsm?.app === 'workbench';

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={messages.keyboardShortcuts}
      size="md"
      className={cx('itsm-ShortcutsDialog', className)}
    >
      <div className="itsm-ShortcutsDialog__settings">
        <Switch
          layout="row"
          label="Single-key shortcuts"
          description="Letters such as C and J. Turn them off if you use speech input or switch access — combinations with ⌘ or Ctrl keep working."
          checked={!singleKeysOff}
          onChange={(checked) => setPrefs({ shortcuts: checked ? 'on' : 'off' })}
        />
        {workbench ? (
          <Switch
            layout="row"
            label="Announce live updates"
            description="Your screen reader says when new tickets arrive in the list you are looking at."
            checked={prefs.announceLive !== 'off'}
            onChange={(checked) => setPrefs({ announceLive: checked ? 'on' : 'off' })}
          />
        ) : null}
      </div>
      {groups.length === 0 ? (
        <p className="itsm-ShortcutsDialog__empty">No keyboard shortcuts are available here.</p>
      ) : (
        <div className="itsm-ShortcutsDialog__groups">
          {groups.map((group) => (
            <GroupList key={group.name} group={group} singleKeysOff={singleKeysOff} />
          ))}
        </div>
      )}
    </Dialog>
  );
}
