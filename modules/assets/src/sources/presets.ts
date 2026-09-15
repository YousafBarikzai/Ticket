import type { Mapping } from '../domain/mapping.js';

/**
 * The built-in sources.
 *
 * Each one is the generic HTTP source with the boxes already filled in — the
 * URL, where the records are in the response, how the feed pages, and a mapping
 * from its field names to ours. There is no per-source code path, which is the
 * point: a tenant whose estate lives somewhere none of these cover configures
 * `http_json` by hand and gets exactly the same behaviour, and a preset that
 * drifts is a mapping to correct rather than a connector to rewrite.
 */

export const SOURCE_KINDS = ['http_json', 'csv', 'intune', 'azure', 'aws', 'aws_api'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Preset {
  url?: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  recordsPath?: string;
  /** Where the next page's URL is in the response, for feeds that page. */
  nextPath?: string;
  /** The header the credential goes in. */
  credentialHeader?: string;
  /** Sign the request instead, for a service that will not take a bearer token. */
  signing?: { kind: 'aws_sigv4'; region: string; service: string };
  mapping?: Mapping;
  /** Classes the preset expects to exist, so a source can say so before it runs. */
  expectsClasses?: string[];
  note?: string;
}

/**
 * Microsoft Intune managed devices, through Graph.
 *
 * The most common corporate source by a distance: it knows about the laptops
 * and phones, who has them, and whether they are still checking in. It reuses
 * the Graph credential shape MOD-03 already built for mail, so a tenant that
 * has connected Graph for email has connected it for this.
 */
const intune: Preset = {
  url: 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices',
  method: 'GET',
  recordsPath: 'value',
  nextPath: '@odata.nextLink',
  credentialHeader: 'authorization',
  expectsClasses: ['device'],
  mapping: {
    classKey: 'device',
    // Intune's own id, not the serial: a device re-imaged and re-enrolled keeps
    // the serial and gets a new id, and matching on the serial would merge two
    // records that are genuinely one machine — which is right — while matching
    // on a serial the manufacturer reused is wrong in a way nobody notices.
    externalKeyFrom: 'id',
    nameFrom: 'deviceName',
    fields: { status: 'complianceState' },
    attributes: {
      serial: 'serialNumber',
      manufacturer: 'manufacturer',
      model: 'model',
      operatingSystem: 'operatingSystem',
      osVersion: 'osVersion',
      lastSyncedAt: 'lastSyncDateTime',
      enrolledAt: 'enrolledDateTime',
      primaryUser: 'userPrincipalName',
    },
  },
};

/**
 * Azure resources, through Resource Graph.
 *
 * One query returns every resource in every subscription the credential can
 * see, which is why it is a POST with a body rather than a URL to walk.
 */
const azure: Preset = {
  url: 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01',
  method: 'POST',
  body: {
    query:
      "Resources | project id, name, type, location, resourceGroup, subscriptionId, tags | order by name asc",
  },
  recordsPath: 'data',
  credentialHeader: 'authorization',
  expectsClasses: ['cloud_resource'],
  mapping: {
    classKey: 'cloud_resource',
    externalKeyFrom: 'id',
    nameFrom: 'name',
    fields: { environment: 'tags.environment' },
    attributes: {
      resourceType: 'type',
      location: 'location',
      resourceGroup: 'resourceGroup',
      subscriptionId: 'subscriptionId',
    },
  },
};

/**
 * AWS resources, from an inventory export rather than from the API directly.
 *
 * Deliberate, and worth saying plainly: AWS authenticates with SigV4 request
 * signing, and the gateway attaches a credential as one header
 * (ADR-0023). Signing would have to happen inside the gateway, where every
 * outbound call is built — a gateway change, not an assets one — and a signer
 * written here could not be verified against anything in this repository. An
 * unverifiable signer that fails only against live AWS is worse than an honest
 * gap.
 *
 * So this consumes what AWS is already good at producing: an AWS Config
 * snapshot or a Resource Groups Tagging export, delivered to an HTTPS endpoint
 * the gateway may reach. The mapping matches Config's `configurationItems`
 * shape.
 *
 * Kept now that `aws_api` exists, and not as a legacy: a Config snapshot is
 * *richer* than the live tagging API — it carries resource types, regions and
 * the relationships AWS already knows about — and plenty of accounts will hand
 * over an export bucket long before they hand over signing keys.
 */
const aws: Preset = {
  method: 'GET',
  recordsPath: 'configurationItems',
  credentialHeader: 'authorization',
  expectsClasses: ['cloud_resource'],
  note: 'Reads an AWS Config snapshot or tagging export; AWS SigV4 signing belongs in the gateway.',
  mapping: {
    classKey: 'cloud_resource',
    externalKeyFrom: 'ARN',
    nameFrom: 'resourceName',
    fields: { environment: 'tags.environment' },
    attributes: {
      resourceType: 'resourceType',
      location: 'awsRegion',
      accountId: 'awsAccountId',
      availabilityZone: 'availabilityZone',
    },
    relationships: [
      // AWS Config already records what a resource is related to. Proposed,
      // never written: a relationship the platform invented is exactly what
      // ADR-0027 refuses, and an inferred edge is worse than a missing one
      // because somebody will act on it during an incident.
      { type: 'runs_on', from: 'relationships[0].resourceId', direction: 'outgoing' },
    ],
  },
};

/**
 * AWS resources from the live API, signed.
 *
 * The Resource Groups Tagging API's `GetResources` returns every resource in
 * the account with its tags, in plain JSON — no nested string payloads to
 * unpick, which is what makes it the right first live endpoint. It is broad and
 * shallow: an ARN and tags for everything. The `aws` export kind above is
 * narrow and deep, and a tenant that wants both runs both.
 *
 * The URL carries the region, so there is no default: a source is refused at
 * creation time if it does not supply one, which is better than a placeholder
 * that fails at two in the morning. The credential is one stored value holding
 * `{"accessKeyId":…,"secretAccessKey":…}`, so both halves rotate together.
 */
const awsApi: Preset = {
  method: 'POST',
  body: {},
  recordsPath: 'ResourceTagMappingList',
  credentialHeader: 'authorization',
  signing: { kind: 'aws_sigv4', region: 'eu-west-2', service: 'tagging' },
  expectsClasses: ['cloud_resource'],
  note: 'Set url to https://tagging.<region>.amazonaws.com/ and signing.region to match; the credential is JSON holding accessKeyId and secretAccessKey.',
  mapping: {
    classKey: 'cloud_resource',
    // The ARN is the identifier AWS itself uses, and it is stable across
    // renames and re-tagging in a way no tag is.
    externalKeyFrom: 'ResourceARN',
    nameFrom: 'ResourceARN',
    attributes: { arn: 'ResourceARN' },
  },
};

const PRESETS: Partial<Record<SourceKind, Preset>> = { intune, azure, aws, aws_api: awsApi };

export function presetFor(kind: SourceKind): Preset {
  return PRESETS[kind] ?? {};
}

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}
