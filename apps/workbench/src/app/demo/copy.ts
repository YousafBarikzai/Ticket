import { AREAS } from '@itsm/contracts/areas';

/**
 * An area's name as a sentence uses it: "the Service Desk", "the Help
 * Portal", "Administration" — "Opening the Service Desk…", "Sign in to the
 * Service Desk". Its own module, with no component in it, so the pages that
 * need only the words do not import the entry screen's client islands.
 */
export function areaInSentence(name: string): string {
  return name === AREAS.admin.name ? name : `the ${name}`;
}
