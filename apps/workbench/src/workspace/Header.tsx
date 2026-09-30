'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Button, Icon, IconButton, Input, channelInfo } from '@itsm/ui';
import { Menu, type MenuItemSpec } from '@itsm/ui/overlays';
import { typeLabel } from '../inbox/presentation.js';

/**
 * The ticket's header (SPEC §6.2, X-32): opaque, two rows.
 *
 * Row one says which ticket this is — `INC-000123 · Incident · Email`, the
 * title (the pane's `h2`, the page's `h1`, editable with `e`) — and how to
 * move: ‹ › through the list it was opened from, "Open full page" beside the
 * list or "‹ Back to My work" on the page, and ⋯ for the rest. Row two is the
 * property chips, the SLA and the next step.
 *
 * It condenses as the conversation scrolls — the identity line folds away
 * and the title shrinks to one line — but every control stays where it was,
 * so the keyboard never loses one.
 */

export interface Neighbours {
  readonly previous: string | null;
  readonly next: string | null;
  /** Where the list is: "‹ Back to My work". */
  readonly back: { readonly href: string; readonly label: string } | null;
}

export interface HeaderProps {
  readonly ticket: Ticket;
  readonly mode: 'pane' | 'page';
  /** The title's id: the workspace's landmark is named by it. */
  readonly titleId: string;
  /** May change the title (`ticket.update`); a state gate otherwise explains why not. */
  readonly canEditTitle: boolean;
  readonly gate?: string;
  readonly editingTitle: boolean;
  readonly onEditingTitleChange: (editing: boolean) => void;
  /** Resolves `true` once saved; `false` keeps the editor open (the workspace has said why). */
  readonly onSaveTitle: (title: string) => Promise<boolean>;
  readonly neighbours: Neighbours;
  readonly onStep: (number: string) => void;
  /** Pane only: `/tickets/<number>`. */
  readonly fullPageHref?: string;
  readonly menu: readonly MenuItemSpec[];
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  readonly menuReturnFocus?: RefObject<HTMLElement | null> | null;
  /** The inspector's toggle (`]`), when it can be shown or hidden here. */
  readonly inspector?: { readonly open: boolean; onToggle(): void };
  readonly condensed?: boolean;
  /** Row two: the chips, the SLA and the next step. */
  readonly properties: ReactNode;
}

/** The longest title the API takes. */
const MAX_TITLE = 500;

function TitleEditor({
  initial,
  onSave,
  onCancel,
}: {
  readonly initial: string;
  readonly onSave: (title: string) => Promise<boolean>;
  readonly onCancel: () => void;
}): ReactNode {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = value.trim();
    if (!title) {
      setError('A ticket needs a title.');
      return;
    }
    if (title === initial.trim()) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    const saved = await onSave(title);
    setBusy(false);
    if (!saved) input.current?.focus();
  }

  return (
    <form className="app-TitleEditor" onSubmit={(event) => void submit(event)}>
      <Input
        ref={input}
        aria-label="Title"
        value={value}
        maxLength={MAX_TITLE}
        invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <Button type="submit" variant="secondary" size="sm" loading={busy} loadingLabel="Saving…">
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error ? (
        <p className="app-TitleEditor__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function Header({
  ticket,
  mode,
  titleId,
  canEditTitle,
  gate,
  editingTitle,
  onEditingTitleChange,
  onSaveTitle,
  neighbours,
  onStep,
  fullPageHref,
  menu,
  menuOpen,
  onMenuOpenChange,
  menuReturnFocus,
  inspector,
  condensed = false,
  properties,
}: HeaderProps): ReactNode {
  const Title = mode === 'page' ? 'h1' : 'h2';
  const channel = channelInfo(ticket.sourceChannel);
  const editButton = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(editingTitle);

  // Focus goes back to the pencil when the editor closes, wherever it was opened from.
  useEffect(() => {
    if (wasEditing.current && !editingTitle) editButton.current?.focus();
    wasEditing.current = editingTitle;
  }, [editingTitle]);

  return (
    <header className="app-WsHeader" data-mode={mode} data-condensed={condensed ? '' : undefined}>
      <div className="app-WsHeader__top">
        <div className="app-WsHeader__identity">
          {mode === 'page' && neighbours.back ? (
            <Button href={neighbours.back.href} variant="ghost" size="sm" iconStart="chevron-left" className="app-WsHeader__back">
              {`Back to ${neighbours.back.label}`}
            </Button>
          ) : null}
          <p className="app-WsHeader__meta">
            <span className="app-WsHeader__number">{ticket.number}</span>
            <span aria-hidden="true"> · </span>
            <span>{typeLabel(ticket.type)}</span>
            <span aria-hidden="true"> · </span>
            <span className="app-WsHeader__channel">
              <Icon name={channel.icon} size="xs" />
              {channel.label}
            </span>
          </p>
          {editingTitle ? (
            <>
              <Title id={titleId} className="itsm-visually-hidden">
                {ticket.title}
              </Title>
              <TitleEditor initial={ticket.title} onSave={onSaveTitle} onCancel={() => onEditingTitleChange(false)} />
            </>
          ) : (
            <div className="app-WsHeader__titleRow">
              <Title id={titleId} className="app-WsHeader__title" tabIndex={mode === 'page' ? -1 : undefined}>
                {ticket.title}
              </Title>
              {canEditTitle ? (
                <IconButton
                  ref={editButton}
                  label="Edit title"
                  icon="pencil"
                  size="sm"
                  shortcut="e"
                  className="app-WsHeader__edit"
                  aria-disabled={gate ? true : undefined}
                  onClick={() => {
                    if (!gate) onEditingTitleChange(true);
                  }}
                />
              ) : null}
            </div>
          )}
        </div>

        <div className="app-WsHeader__actions">
          {neighbours.previous !== null || neighbours.next !== null ? (
            <span className="app-WsHeader__stepper" role="group" aria-label="Move through the list">
              <IconButton
                label={neighbours.previous ? `Previous ticket, ${neighbours.previous}` : 'Previous ticket'}
                icon="chevron-up"
                size="sm"
                disabled={neighbours.previous === null}
                onClick={() => neighbours.previous && onStep(neighbours.previous)}
              />
              <IconButton
                label={neighbours.next ? `Next ticket, ${neighbours.next}` : 'Next ticket'}
                icon="chevron-down"
                size="sm"
                disabled={neighbours.next === null}
                onClick={() => neighbours.next && onStep(neighbours.next)}
              />
            </span>
          ) : null}
          {fullPageHref ? <IconButton label="Open full page" icon="external-link" size="sm" shortcut="o" href={fullPageHref} /> : null}
          {inspector ? (
            <IconButton
              label={inspector.open ? 'Hide details' : 'Show details'}
              icon="panel-right"
              size="sm"
              shortcut="]"
              pressed={inspector.open}
              onClick={inspector.onToggle}
            />
          ) : null}
          <Menu
            open={menuOpen}
            onOpenChange={onMenuOpenChange}
            onCloseFocus={menuReturnFocus ?? 'trigger'}
            align="end"
            label={`More actions for ${ticket.number}`}
            items={menu}
            trigger={<IconButton label={`More actions for ${ticket.number}`} icon="ellipsis" size="sm" shortcut="." />}
          />
        </div>
      </div>
      <div className="app-WsHeader__properties">{properties}</div>
    </header>
  );
}
