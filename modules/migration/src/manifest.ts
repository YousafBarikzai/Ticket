import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-24 Migration. Brings another tool's records in through the modules
 * that own them, and keeps the map from their identifiers to ours.
 */
export const migrationManifest: ModuleManifest = registerModule({
  id: 'MOD-24',
  key: 'migration',
  name: 'Migration',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-01', 'MOD-04', 'MOD-05', 'MOD-11', 'MOD-14', 'MOD-21'],
  permissions: [
    { key: 'migration.read', scopes: ['any'], description: 'See import jobs, their records and the saved mappings.' },
    { key: 'migration.manage', scopes: ['any'], description: 'Upload files, save mappings and run imports, dry or for real.' },
  ],
  events: {
    publishes: ['import.job.finished'],
    consumes: [],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'import.run',
      queue: 'imports',
      description: 'Run one import job: read the source, map every row, and write or report.',
    },
    {
      name: 'import.file.sweep',
      queue: 'retention',
      // Uploaded files are read once; a week is long enough to run the dry
      // run, look at it, and commit.
      schedule: '20 3 * * *',
      description: 'Delete uploaded import files older than seven days.',
    },
  ],
  routesPrefix: '/import',
  enabledByDefault: true,
  optional: true,
});
