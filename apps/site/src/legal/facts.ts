/**
 * The facts the legal pages state about the operator (SPEC v3 §6.6; A5
 * §11.5), in one place the owner fills in.
 *
 * Every `null` is a fact nobody has confirmed yet. The pages never print a
 * placeholder for one: each sentence that needs it has a written fallback,
 * and the page adds one quiet note that some details are being confirmed
 * (A5 §11.1). Hosting is stated only as verified (H6): the app region is
 * `infra/railway/services.json` `"region": "ams"`; the database and identity
 * services were made by hand, so their regions stay unconfirmed here.
 */
export interface LegalFacts {
  /** ISO date of the last change to any of the three pages. */
  readonly updated: string;
  readonly vendor: string;
  readonly legalEntity: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly icoRegistration: string | null;
  readonly privacyEmail: string | null;
  readonly legalEmail: string | null;
  readonly securityEmail: string | null;
  readonly hosting: {
    readonly provider: string;
    readonly appRegion: string;
    readonly dataRegion: string | null;
    readonly identityRegion: string | null;
    readonly requestLogRetention: string | null;
  };
  /** D19: how long the demo's activity records are kept after a reset. */
  readonly auditRetention: string | null;
  readonly liabilityCap: string | null;
}

export const LEGAL_FACTS: LegalFacts = Object.freeze({
  updated: '2026-10-02',
  vendor: 'VNE Technologies',
  legalEntity: null,
  companyNumber: null,
  registeredOffice: null,
  icoRegistration: null,
  privacyEmail: null,
  legalEmail: null,
  securityEmail: null,
  hosting: Object.freeze({
    provider: 'Railway Corporation',
    appRegion: 'EU West (Amsterdam)',
    dataRegion: null,
    identityRegion: null,
    requestLogRetention: null,
  }),
  auditRetention: null,
  liabilityCap: null,
});
