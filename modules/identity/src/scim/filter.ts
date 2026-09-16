import { ScimError } from './errors.js';

/**
 * The part of the SCIM filter grammar an identity provider actually sends.
 *
 * Entra ID and Okta both look a resource up before they create it, and both
 * do it with one equality: `userName eq "x"`, `externalId eq "x"`,
 * `displayName eq "x"`, occasionally `emails[type eq "work"].value eq "x"`.
 * That is what is parsed. Anything else — `and`, `or`, `co`, `sw`, `pr` —
 * is refused as `invalidFilter` rather than half-supported, because a
 * filter the server quietly ignores is a provider that thinks the user does
 * not exist and creates them again.
 */

export const FILTERABLE = ['userName', 'externalId', 'emails.value', 'displayName', 'id'] as const;
export type Filterable = (typeof FILTERABLE)[number];

export interface Filter {
  attribute: Filterable;
  value: string;
}

const CANONICAL: Record<string, Filterable> = {
  username: 'userName',
  externalid: 'externalId',
  'emails.value': 'emails.value',
  emails: 'emails.value',
  displayname: 'displayName',
  id: 'id',
};

export function parseFilter(text: string | undefined): Filter | null {
  if (text === undefined || text.trim() === '') return null;
  // `attr eq "value"`, with an optional `[...]` selector on the attribute
  // that is stripped: `emails[type eq "work"].value` is `emails.value`.
  const match = /^\s*([A-Za-z][A-Za-z0-9_.:-]*(?:\[[^\]]*\])?(?:\.[A-Za-z]+)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(text);
  if (!match) throw new ScimError(400, `only "attribute eq \\"value\\"" filters are supported; got: ${text.slice(0, 120)}`, 'invalidFilter');

  const rawAttribute = match[1]!.replace(/\[[^\]]*\]/, '').replace(/^urn:ietf:params:scim:schemas:core:2\.0:user:/i, '').toLowerCase();
  const attribute = CANONICAL[rawAttribute];
  if (!attribute) throw new ScimError(400, `${match[1]} cannot be filtered on; try one of ${FILTERABLE.join(', ')}`, 'invalidFilter');

  return { attribute, value: match[2]!.replace(/\\(.)/g, '$1') };
}
