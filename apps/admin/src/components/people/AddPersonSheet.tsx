'use client';

import { useId, useState, type ReactNode } from 'react';
import type { RoleRow } from '@itsm/sdk';
import { Button, CheckboxGroup, Form, FormField, Input, Select, describeProblem, notify } from '@itsm/ui';
import { Sheet } from '@itsm/ui/overlays';
import { api } from '../../client/api.js';
import { useOnline } from '../../client/live.js';
import { useMutation } from '../../client/useMutation.js';
import { problemFrom } from '../../problem.js';
import { firstName, nameFromEmail, personProblems } from './presentation.js';
import type { NamedOption } from './types.js';

/**
 * *Add person* (`?new=1`, also ⌘K, SPEC §6.1 `/people`, B §3.16): name,
 * email, organisation, and the roles they start with as checkbox cards.
 *
 * Two writes — the account, then each role — and the second can fail on its
 * own (a plan's agent limit, say) after the first has succeeded. So the
 * person is never lost: the sheet closes on the account, and a role that was
 * not given is named in the toast with where to give it. Sign-in is by the
 * workspace's single sign-on, so there is no password and no invitation to
 * send.
 */

const OFFLINE = 'You’re offline — changes can’t be saved.';

export interface AddPersonSheetProps {
  readonly open: boolean;
  /** Organisations to choose from, indented; null when they cannot be read. */
  readonly organisations: readonly NamedOption[] | null;
  /** Roles to start with; null when this person may not give roles. */
  readonly roles: readonly RoleRow[] | null;
  /** Addresses already on the list, to catch a duplicate before the round trip. */
  readonly takenEmails: readonly string[];
  onClose(): void;
  /** The new person's id, to flash their row and open their details. */
  onAdded(id: string): void;
}

interface Added {
  readonly id: string;
  readonly name: string;
  readonly missed: readonly { readonly role: string; readonly why: string }[];
}

export function AddPersonSheet({ open, organisations, roles, takenEmails, onClose, onAdded }: AddPersonSheetProps): ReactNode {
  const formId = useId();
  const online = useOnline();
  const [dirty, setDirty] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const add = useMutation(
    async (input: { displayName: string; email: string; primaryOrgId?: string; roleKeys: readonly string[] }): Promise<Added> => {
      const user = await api.tenant.createUser({ displayName: input.displayName, email: input.email, ...(input.primaryOrgId ? { primaryOrgId: input.primaryOrgId } : {}) });
      const missed: { role: string; why: string }[] = [];
      // One at a time: a plan limit refuses the rest the same way, and the toast should say so once.
      for (const key of input.roleKeys) {
        try {
          await api.tenant.assignRole(user.id, key);
        } catch (error) {
          missed.push({ role: roles?.find((role) => role.key === key)?.name ?? key, why: describeProblem(problemFrom(error)).title });
        }
      }
      return { id: user.id, name: user.displayName || input.displayName, missed };
    },
    { failure: 'Couldn’t add them' },
  );

  const reset = (): void => {
    setDirty(false);
    setPicked([]);
    setEmail('');
    setName('');
    add.reset();
  };

  const close = (): void => {
    reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="md"
      title="Add person"
      description="They sign in with your workspace’s single sign-on — there’s no password to set and nothing to send."
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={add.pending} loadingLabel="Adding…" {...(online ? {} : { disabledReason: OFFLINE })}>
            Add person
          </Button>
        </>
      }
    >
      {open ? (
        <Form
          id={formId}
          aria-label="Add person"
          onDirtyChange={setDirty}
          onSubmit={async (data) => {
            const displayName = String(data.get('displayName') ?? '').trim();
            const address = String(data.get('email') ?? '').trim();
            const primaryOrgId = String(data.get('primaryOrgId') ?? '');
            const errors = personProblems({ name: displayName, email: address }, takenEmails);
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            const result = await add.run({ displayName, email: address.toLowerCase(), ...(primaryOrgId ? { primaryOrgId } : {}), roleKeys: picked });
            if (!result.ok) {
              if (result.problem.status === 409) return { fieldErrors: { email: 'Someone on this desk already has that email address.' } };
              return result.problem.fieldErrors ? { fieldErrors: result.problem.fieldErrors } : { message: result.problem.detail ?? 'They weren’t added.' };
            }
            const added = result.value;
            const first = firstName(added.name);
            if (added.missed.length === 0) {
              notify(`${first} added — they can sign in with single sign-on`, { tone: 'success' });
            } else {
              notify(`${first} added, but not every role was given`, {
                tone: 'warning',
                description: `${added.missed.map((entry) => entry.role).join(', ')}: ${added.missed[0]!.why}. Give ${added.missed.length === 1 ? 'it' : 'them'} from ${first}’s details.`,
              });
            }
            setDirty(false);
            onAdded(added.id);
            reset();
            return undefined;
          }}
        >
          <FormField label="Name" required>
            <Input
              name="displayName"
              autoComplete="off"
              maxLength={200}
              value={name}
              placeholder={email.includes('@') ? nameFromEmail(email) : undefined}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </FormField>
          <FormField label="Email" required hint="The address their identity provider signs them in with.">
            <Input
              name="email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              onBlur={() => {
                if (name.trim() === '' && email.includes('@')) setName(nameFromEmail(email));
              }}
            />
          </FormField>
          {organisations && organisations.length > 0 ? (
            <FormField label="Organisation" optional hint="Where they belong. People scoped to “their teams” see the people of their own organisations.">
              <Select name="primaryOrgId" defaultValue="" options={[{ value: '', label: 'None' }, ...organisations]} />
            </FormField>
          ) : null}
          {roles && roles.length > 0 ? (
            <CheckboxGroup
              label="Roles"
              hint="What they can do from their first sign-in. You can change it any time from their details."
              value={picked}
              onChange={setPicked}
              className="app-RoleCards"
              options={roles.map((role) => ({ value: role.key, label: role.name, ...(role.description ? { description: role.description } : {}) }))}
            />
          ) : null}
        </Form>
      ) : null}
    </Sheet>
  );
}
