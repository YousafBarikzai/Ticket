// @vitest-environment jsdom
import { useRef, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { RelativeTime } from '../../format/RelativeTime.js';
import { BrandMark } from '../../icons/BrandMark.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../../web/Kbd.js';
import { VisuallyHidden } from '../../web/VisuallyHidden.js';
import { useCollectionKeyboard } from '../collection-keyboard.js';
import { Region } from '../regions.js';

/*
 * The foundations, read by axe (SPEC §8.0 rule 5): each rendered the way a
 * screen uses it — an icon inside a labelled button and alone as the whole
 * message, the brand mark beside its name and on its own, a shortcut hint in
 * a sentence and inside a control, a timestamp, the F6 regions of a frame and
 * a list driven by the collection keyboard.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-09-29T12:00:00Z'));
});

afterEach(() => {
  cleanupDocument();
  vi.useRealTimers();
});

async function audit(element: ReactElement): Promise<void> {
  render(<TestProvider>{element}</TestProvider>);
  vi.useRealTimers();
  await expectNoViolations(document.body);
}

describe('foundations audit', () => {
  it('Icon: decorative in a labelled control, an image when it is the message', async () => {
    await audit(
      <div>
        <button type="button">
          <Icon name="plus" /> New ticket
        </button>
        <button type="button" aria-label="Notifications">
          <Icon name="bell" />
        </button>
        <p>
          <Icon name="triangle-alert" label="Warning" /> Two deliveries failed
        </p>
        <a href="/help">
          Help <Icon name="external" directional />
        </a>
      </div>,
    );
  });

  it('BrandMark: beside the product name and on its own', async () => {
    await audit(
      <div>
        <a href="/">
          <BrandMark app="workbench" /> Service Desk
        </a>
        <BrandMark app="portal" title="Help Portal" size={64} />
      </div>,
    );
  });

  it('Kbd: in a sentence, in a search trigger and in a list of shortcuts', async () => {
    await audit(
      <div>
        <p>
          Press <Kbd keys="mod+k" /> to search, or <Kbd keys="g m" /> for your tickets.
        </p>
        <button type="button" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K">
          Search <Kbd keys="mod+k" size="sm" aria-hidden />
        </button>
        <dl>
          <dt>Keyboard shortcuts</dt>
          <dd>
            <Kbd keys="?" />
          </dd>
        </dl>
      </div>,
    );
  });

  it('RelativeTime and VisuallyHidden', async () => {
    await audit(
      <p>
        Updated <RelativeTime date="2026-09-29T11:57:00Z" />
        <VisuallyHidden>by Ada Lovelace</VisuallyHidden>
      </p>,
    );
  });

  it('Region: the landmarks F6 cycles', async () => {
    await audit(
      <div>
        <Region id="sidebar" label="Sidebar" as="nav">
          <a href="/inbox">Inbox</a>
        </Region>
        <main>
          <h1>Inbox</h1>
          <Region id="list" label="Tickets">
            <a href="/tickets/1">INC-1</a>
          </Region>
          <Region id="conversation" label="Conversation" as="article">
            <p>Printer on floor 2 is jammed.</p>
          </Region>
        </main>
        <Region id="inspector" label="Details" as="aside">
          <p>Priority P2</p>
        </Region>
      </div>,
    );
  });

  it('a list driven by the collection keyboard', async () => {
    function List(): ReactElement {
      const rows = useRef<(HTMLLIElement | null)[]>([]);
      const keyboard = useCollectionKeyboard({ count: 2, getRow: (index) => rows.current[index] ?? null, onActivate: () => undefined });
      return (
        <ul aria-label="Tickets" onKeyDown={keyboard.onKeyDown} onFocus={keyboard.onFocus}>
          {['INC-1', 'INC-2'].map((label, index) => (
            <li
              key={label}
              ref={(node) => {
                rows.current[index] = node;
              }}
              {...keyboard.getRowProps(index)}
            >
              <input type="checkbox" aria-label={`Select ${label}`} {...keyboard.getControlProps(index, 'select')} />
              <a href={`/tickets/${index + 1}`} {...keyboard.getControlProps(index, 'primary')}>
                {label}
              </a>
              <button type="button" aria-haspopup="menu" aria-label={`More for ${label}`} {...keyboard.getControlProps(index, 'menu')}>
                <Icon name="ellipsis" />
              </button>
            </li>
          ))}
        </ul>
      );
    }
    await audit(<List />);
  });
});
