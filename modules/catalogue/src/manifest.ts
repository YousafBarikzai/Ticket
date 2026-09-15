import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-05 Service catalogue and request fulfilment, with MOD-02's forms.
 *
 * Fulfilment plans and task templates follow in PH-3 with the workflow engine;
 * this phase delivers the catalogue a requester browses and the form they fill
 * in (docs/architecture/04, MOD-05 and MOD-02).
 */
export const catalogueManifest: ModuleManifest = registerModule({
  id: 'MOD-05',
  key: 'catalogue',
  name: 'Service catalogue and request fulfilment',
  version: '1.0.0',
  phase: 'PH-2',
  dependsOn: ['MOD-04', 'MOD-01', 'MOD-17'],
  permissions: [
    { key: 'catalogue.read', scopes: ['own', 'any'], description: 'Browse the catalogue you are entitled to.' },
    { key: 'catalogue.request', scopes: ['own'], description: 'Raise a request from a catalogue item.' },
    { key: 'catalogue.manage', scopes: ['any'], description: 'Write and publish services and catalogue items.' },
    { key: 'catalogue.form.read', scopes: ['any'], description: 'See the form definitions for this tenant.' },
    { key: 'catalogue.form.manage', scopes: ['any'], description: 'Write and publish form definitions.' },
  ],
  events: {
    publishes: ['catalogue.item.published', 'request.submitted'],
    consumes: ['approval.decided'],
  },
  featureFlags: [],
  settings: [],
  jobs: [],
  routesPrefix: '/catalogue',
  enabledByDefault: true,
  optional: true,
});
