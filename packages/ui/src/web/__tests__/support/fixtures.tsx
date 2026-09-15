/**
 * Stateful wrappers used by the DOM tests. They live here, in JSX, so the test
 * files themselves stay plain `.test.ts` — the root Vitest "unit" project only
 * collects `.test.ts`, and a test that has to be written in `createElement`
 * calls is a test nobody reads.
 */
import { useState, type ReactNode } from 'react';
import { CommandPalette, type CommandItem } from '../../CommandPalette.js';
import { Dialog } from '../../Dialog.js';
import { RadioGroup } from '../../RadioGroup.js';
import { Tabs } from '../../Tabs.js';

export interface DialogHarnessProps {
  readonly onCloseReason?: (reason: string) => void;
  readonly dismissible?: boolean;
}

export function DialogHarness({ onCloseReason, dismissible = true }: DialogHarnessProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button" id="outside">
        Outside
      </button>
      <Dialog
        open={open}
        dismissible={dismissible}
        title="Resolve ticket"
        description="Tell the requester what changed."
        onClose={(reason) => {
          onCloseReason?.(reason);
          setOpen(false);
        }}
        footer={
          <button type="button" id="confirm">
            Confirm
          </button>
        }
      >
        <input id="reason" aria-label="Resolution note" />
      </Dialog>
    </div>
  );
}

export function CommandPaletteHarness({ commands }: { readonly commands: readonly CommandItem[] }): ReactNode {
  const [open, setOpen] = useState(true);
  return <CommandPalette open={open} commands={commands} onClose={() => setOpen(false)} />;
}

export function RadioGroupHarness({ onSelect }: { readonly onSelect?: (value: string) => void }): ReactNode {
  const [value, setValue] = useState<string | null>('p3');
  return (
    <RadioGroup
      label="Priority"
      value={value}
      onChange={(next) => {
        setValue(next);
        onSelect?.(next);
      }}
      options={[
        { value: 'p1', label: 'P1 — critical' },
        { value: 'p2', label: 'P2 — high', disabled: true },
        { value: 'p3', label: 'P3 — normal' },
        { value: 'p4', label: 'P4 — low' },
      ]}
    />
  );
}

export function TabsHarness({ activation = 'automatic' }: { readonly activation?: 'automatic' | 'manual' }): ReactNode {
  return (
    <Tabs
      label="Ticket sections"
      activation={activation}
      items={[
        { id: 'details', label: 'Details', content: <p>Details panel</p> },
        { id: 'tasks', label: 'Tasks', content: <p>Tasks panel</p> },
        { id: 'related', label: 'Related', content: <p>Related panel</p> },
      ]}
    />
  );
}
