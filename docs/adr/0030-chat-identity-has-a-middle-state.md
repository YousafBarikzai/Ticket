# ADR-0030 · Chat identity has a middle state, and it buys exactly one thing

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-03, §7 Authorisation, §4.2

## Context

The email channel has one question to answer about a sender: is this address
linked to a person, or not. There is no middle. An email address is evidence of
nothing on its own — anybody can put anything in a `From:` header — so the
platform sends a code to an address it already holds and waits for it to come
back.

Chat is different in a way worth using. Slack and Teams both report an email
address for the account that sent a message, and both will say whether they
consider it verified. That is real evidence, and requiring every employee to
complete a linking dance before they can ask the service desk for a laptop
charger is friction with a cost: the channel that is easiest to ignore is the
one people stop using.

It is also evidence the platform did not gather. A workspace administrator can
usually edit a profile email. So "Slack says this address is verified" means
"nobody with admin in that workspace has chosen to lie about it", which is a
strong statement about a workspace an organisation controls and an empty one
about a workspace it does not.

## Decision

**Three verification methods, and a table saying what each permits.**

- `provider_verified` — the provider reported a verified email, **and** that
  address is on a domain the tenant has declared it trusts from that account.
  Both halves are required. Without the domain claim, this is
  impersonation-as-a-service: anybody who can create a workspace can create a
  profile claiming to be your finance director.
- `one_time_code` — the platform sent a code to an address it already held and
  the code came back.
- `admin` — somebody with the permission linked it by hand.

**`provider_verified` buys raising a request in your own name, and nothing
else.** The asymmetry is the whole decision. The worst case of a wrongly
attributed `createTicket` is a ticket you did not raise, addressed to you, which
you can see and close. The worst cases of the others are different in kind:
`addComment` puts words in your mouth on a record other people are reading and
acting on, `getStatus` discloses, and `decideApproval` commits money or
authorises a change. Those want a code.

**An unrecognised method is treated as no method.** A row written by a later
version of this code, or by hand, is not silently trusted more than the
strongest thing the running version understands.

**Auto-linking only ever creates a weak link.** It cannot upgrade an identity
already verified by code, and it cannot repoint one already linked to somebody
else. Otherwise a profile edit would be a privilege escalation.

**The refusal says what to do next.** The reply is the only thing the person
sees, and "you are not a verified identity" sends somebody to raise a ticket
about not being able to raise a ticket.

## Alternatives considered

- **Require the code from everybody, as email does.** Safest and the reason it
  is tempting. Rejected because the cost falls entirely on first use, which is
  exactly when a person is deciding whether this channel is worth bothering
  with — and because the domain-claim requirement recovers most of the safety.
- **Trust the provider's verified email outright.** Rejected: a workspace admin
  can edit a profile, so this hands the strongest identity in the system to
  whoever administers the noisiest workspace.
- **Trust it for reads, require the code for writes.** The obvious cut, and
  wrong in both directions here. `getStatus` is a read and is the clearest
  disclosure risk in the set; `createTicket` is a write and the safest thing on
  the list. Sorting by read and write sorts by the wrong property — what matters
  is what a wrong attribution costs.
- **A per-tenant switch between strict and permissive.** Rejected for now: it is
  a setting nobody has the information to set on day one, and the domain claim
  already lets a tenant decide how much they trust a given workspace.

## Consequences

- A tenant that claims no domains gets the strict behaviour by default, which is
  the right default for a workspace nobody has vouched for.
- The domain match is exact, not a suffix: `notacme.example` must not pass
  because it ends with `acme.example`.
- Teams supplies the principal name from the directory and Slack does not put an
  email on the event at all, so Slack's auto-linking waits on a `users.info`
  call the linking path makes when it needs one. Absent is recorded as absent
  rather than guessed.
- The same table governs interactive components. A button the desk posted comes
  back through the internet, so `decideApproval` from a button is held to the
  same standard as `decideApproval` typed as a command — and the payload is
  parsed and validated rather than trusted because the platform wrote it.
