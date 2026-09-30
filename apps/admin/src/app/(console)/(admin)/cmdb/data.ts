import 'server-only';
import type { Admin, CiClassRow, CiRow, Me } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import { holds } from '../../../../permissions.js';
import { personFrom, resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';
import {
  ciFilters,
  ciView,
  classAndDescendants,
  classTree,
  isUuid,
  mergeCis,
  type CiQuery,
  type CiView,
} from '../../../../components/cmdb/presentation.js';

/**
 * What the Configuration items page loads, made serialisable for its client
 * view: the classes, the items that match the URL's query (the chosen class
 * with the classes below it, since the API matches one class exactly), the
 * catalogue's services by name when this person may list them, and — on a
 * hard load of `?open=ci:<id>` — that item, which may be retired or filtered
 * out of the list.
 *
 * Each read fails on its own (SPEC §4.10): without the classes the list still
 * shows, without the services the Service column is left out, and a failed
 * list keeps the header and the class tree.
 */
export interface CmdbData {
  readonly classes: readonly CiClassRow[];
  readonly classesProblem?: Problem;
  readonly rows: readonly CiView[];
  readonly problem?: Problem;
  /** The URL named a class that does not exist (any more); the list is unfiltered by class. */
  readonly unknownClass: boolean;
  /** More matched than the API returns: "search or filter to narrow". */
  readonly capped: boolean;
  /** Services by id → name; null when this person cannot list the catalogue. */
  readonly services: readonly { readonly id: string; readonly name: string }[] | null;
  readonly detail?: CiView;
  /** The drawer's item could not be read (gone, or never existed). */
  readonly detailMissing?: boolean;
}

export async function loadCmdb(api: Admin, me: Me, query: CiQuery, drawerId: string | null): Promise<CmdbData> {
  const mayListServices = holds(me, 'catalogue.manage');
  const [classes, services, detail] = await Promise.all([
    read(() => api.observe.estate.classes()),
    mayListServices ? read(() => api.configure.catalogue.services()) : Promise.resolve(null),
    isUuid(drawerId) ? read(() => api.observe.estate.ci(drawerId)) : Promise.resolve(null),
  ]);

  const classRows = classes.ok ? classes.value : [];
  const tree = classTree(classRows);
  const known = query.classKey !== null && classRows.some((row) => row.key === query.classKey);
  const unknownClass = query.classKey !== null && classes.ok && !known;
  // Unknown class: list every class and say so, rather than an empty page.
  const keys = known ? classAndDescendants(tree, query.classKey!) : null;
  const filters = ciFilters(query, keys);
  const lists = await Promise.all(filters.map((filter) => read(() => api.observe.estate.cis(filter))));
  const failed = lists.find((list) => !list.ok);
  const rows: CiRow[] = failed ? [] : mergeCis(lists.map((list) => (list.ok ? list.value : [])));
  const capped = !failed && lists.some((list) => list.ok && list.value.length >= (filters[0]?.limit ?? 100));

  const detailRow = detail?.ok ? detail.value : null;
  const people = await resolvePeople(api, [...rows.map((row) => row.ownerId), detailRow?.ownerId]);
  const serviceList = services?.ok ? services.value.map((service) => ({ id: service.id, name: service.name })) : null;
  const serviceNames = new Map((serviceList ?? []).map((service) => [service.id, service.name]));
  const context = {
    classes: classRows,
    serviceName: (id: string) => serviceNames.get(id) ?? null,
    person: (id: string | null) => personFrom(people, id),
  };

  return {
    classes: classRows,
    ...(classes.ok ? {} : { classesProblem: classes.problem }),
    rows: rows.map((row) => ciView(row, context)),
    ...(failed && !failed.ok ? { problem: failed.problem } : {}),
    unknownClass,
    capped,
    services: serviceList,
    ...(detailRow ? { detail: ciView(detailRow, context) } : {}),
    ...(drawerId && detail && !detail.ok ? { detailMissing: detail.problem.status === 404 || detail.problem.status === 422 } : {}),
    ...(drawerId && !isUuid(drawerId) ? { detailMissing: true } : {}),
  };
}
