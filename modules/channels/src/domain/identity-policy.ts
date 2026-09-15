import type { ChannelCommand } from './commands.js';

/**
 * How much a chat identity has to be proved before it may do a given thing.
 *
 * Email had one answer — verified or not — because an email address is either
 * linked or it is not. Chat has a middle state worth using: the provider says
 * "this account's email is verified and it is alice@acme.example", which is
 * evidence, but not evidence the platform gathered.
 *
 * **Why that is not enough on its own.** A workspace administrator can usually
 * edit a profile email. So "Slack says the email is verified" means "somebody
 * with admin in that workspace has not chosen to lie", which is fine for a
 * workspace an organisation controls and worthless for one it does not. That is
 * why `provider_verified` counts only when the address is on a domain the
 * tenant has declared it trusts from that account: the tenant is asserting the
 * workspace is theirs, and the platform is not guessing.
 *
 * **What it then buys.** Raising a request in your own name, and nothing else.
 * The worst case of a wrongly-attributed `createTicket` is a ticket you did not
 * raise, addressed to you, which you can see and close. The worst cases of the
 * others are different in kind: `addComment` puts words in your mouth on a
 * record other people are reading, `getStatus` discloses, and `decideApproval`
 * commits money or authorises a change. Those want a code the platform sent to
 * an address it already trusts.
 */

export const VERIFICATION_METHODS = ['provider_verified', 'one_time_code', 'admin'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export type CommandKind = ChannelCommand['kind'];

/** What each method is good for. Anything absent needs a stronger method. */
const PERMITS: Record<VerificationMethod, ReadonlySet<CommandKind>> = {
  // Evidence from the workspace, on a domain the tenant vouched for.
  provider_verified: new Set<CommandKind>(['createTicket', 'linkIdentity', 'handoff']),
  // The platform sent a code to an address it already holds, and it came back.
  one_time_code: new Set<CommandKind>([
    'createTicket',
    'addComment',
    'getStatus',
    'decideApproval',
    'linkIdentity',
    'handoff',
  ]),
  // An administrator linked it by hand, having checked however they check.
  admin: new Set<CommandKind>(['createTicket', 'addComment', 'getStatus', 'decideApproval', 'linkIdentity', 'handoff']),
};

export interface IdentityState {
  userId: string | null;
  verified: boolean;
  method: string | null;
}

export interface PolicyVerdict {
  allowed: boolean;
  /** What the person should be told, in words that say what to do next. */
  message?: string;
  /** True where linking with a code would grant it, so the reply can offer that. */
  offerLinking?: boolean;
}

export function isVerificationMethod(value: string | null): value is VerificationMethod {
  return value !== null && (VERIFICATION_METHODS as readonly string[]).includes(value);
}

/**
 * Whether this identity may run this command.
 *
 * Returns words rather than a boolean alone, because the reply is the only
 * thing the person sees: "you are not verified" sends them to raise a ticket
 * about not being able to raise a ticket.
 */
export function permits(identity: IdentityState | null, command: ChannelCommand): PolicyVerdict {
  if (command.kind === 'linkIdentity') return { allowed: true };

  if (!identity || !identity.userId || !identity.verified) {
    return {
      allowed: false,
      message: 'I do not know who you are here yet. Link this account and I can help.',
      offerLinking: true,
    };
  }

  if (!isVerificationMethod(identity.method)) {
    // An unrecognised method is treated as no method. A row written by a future
    // version of this code, or by hand, should not silently be trusted more
    // than the strongest thing this version understands.
    return {
      allowed: false,
      message: 'This account is linked in a way I cannot check. Link it again and I can help.',
      offerLinking: true,
    };
  }

  if (PERMITS[identity.method].has(command.kind)) return { allowed: true };

  return {
    allowed: false,
    message:
      command.kind === 'getStatus'
        ? 'I can only share ticket details with a confirmed account. Link this one and ask again.'
        : command.kind === 'decideApproval'
          ? 'Approvals need a confirmed account. Link this one and the request will still be waiting.'
          : 'That needs a confirmed account. Link this one and try again.',
    offerLinking: true,
  };
}

/**
 * Whether the provider's word is good enough to link this address at all.
 *
 * Both halves are required. An unverified email from the provider is a profile
 * field anybody can type. A verified one on a domain the tenant has not claimed
 * is a verified email in somebody else's workspace, which says nothing about
 * who this person is here.
 */
export function canAutoLink(input: {
  email: string | null | undefined;
  providerVerified: boolean;
  trustedDomains: string[];
}): boolean {
  if (!input.email || !input.providerVerified) return false;
  const at = input.email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = input.email.slice(at + 1).toLowerCase();
  return input.trustedDomains.some((trusted) => trusted.trim().toLowerCase() === domain);
}
