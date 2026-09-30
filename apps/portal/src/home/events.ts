/**
 * What the "Something else?" tile sends to Home's search: "put the person in
 * the search" — the caret in the field on a wide screen, the full-screen
 * flow on a phone. An event rather than a shared ref, because the two live in
 * different streamed sections of the page.
 */
export const FOCUS_HOME_SEARCH = 'app:focus-home-search';
