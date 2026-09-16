import { HEADLINES, STATUS_LABELS, type ComponentStatus } from '../domain/status.js';
import type { PublicStatus } from './public-service.js';

/**
 * The page, as HTML.
 *
 * Served by the API for the same reason the survey page is: there is no
 * public web application in this repository, and a status URL has to show a
 * person something when they open it. Everything from the database is
 * escaped; nothing is executable; the page is static apart from a subscribe
 * form that posts back to the same path.
 */

function escape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const COLOURS: Record<ComponentStatus, string> = {
  operational: '#2e7d32',
  degraded: '#f9a825',
  partial_outage: '#ef6c00',
  major_outage: '#c62828',
  maintenance: '#1565c0',
};

const STYLE = `
  body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fafafa}
  h1{font-size:1.6rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:2rem 0 .75rem}.muted{color:#555}
  .headline{padding:1rem 1.25rem;border-radius:.5rem;color:#fff;font-weight:600;margin:1.5rem 0}
  .component{display:flex;justify-content:space-between;padding:.6rem .25rem;border-bottom:1px solid #e5e5e5}
  .group{font-weight:600;margin-top:1rem}.badge{font-weight:600}
  .incident{border:1px solid #ddd;border-radius:.5rem;padding:1rem;margin:.75rem 0;background:#fff}
  .update{margin:.5rem 0 0;padding-left:.75rem;border-left:3px solid #ddd}.update time{font-size:.85rem;color:#555;display:block}
  form{margin:2rem 0}input[type=email]{padding:.55rem;border:1px solid #bbb;border-radius:.4rem;font:inherit;width:60%}
  button{background:#1a5fb4;color:#fff;border:0;border-radius:.4rem;padding:.6rem 1rem;font:inherit;cursor:pointer;margin-left:.5rem}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function when(iso: string): string {
  return escape(iso.replace('T', ' ').slice(0, 16) + ' UTC');
}

export function renderStatusPage(status: PublicStatus, message?: string): string {
  const overall = status.overall;
  const headline = `<div class="headline" style="background:${COLOURS[overall]}">${escape(HEADLINES[overall])}</div>`;

  const groups = new Map<string, PublicStatus['components']>();
  for (const component of status.components) {
    const key = component.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), component]);
  }
  const components = [...groups]
    .map(([group, list]) => {
      const rows = list
        .map(
          (component) =>
            `<div class="component"><span>${escape(component.name)}${component.description ? ` <span class="muted">— ${escape(component.description)}</span>` : ''}</span><span class="badge" style="color:${COLOURS[component.status]}">${escape(STATUS_LABELS[component.status])}</span></div>`,
        )
        .join('');
      return `${group ? `<div class="group">${escape(group)}</div>` : ''}${rows}`;
    })
    .join('');

  const incident = (item: PublicStatus['incidents'][number]) =>
    `<div class="incident"><strong>${escape(item.title)}</strong> <span class="muted">· ${escape(item.impact)} · ${escape(item.status)}</span>${item.components.length ? `<div class="muted">Affects ${escape(item.components.join(', '))}</div>` : ''}${item.updates
      .map((update) => `<div class="update"><strong>${escape(update.status)}</strong> — ${escape(update.body)}<time>${when(update.postedAt)}</time></div>`)
      .join('')}</div>`;

  const active = status.incidents.filter((item) => item.status !== 'resolved');
  const recent = status.incidents.filter((item) => item.status === 'resolved');

  const maintenance = status.maintenance
    .map(
      (window) =>
        `<div class="incident"><strong>${escape(window.title)}</strong> <span class="muted">· ${escape(window.status)}</span><div class="muted">${when(window.startsAt)} to ${when(window.endsAt)}${window.components.length ? ` · ${escape(window.components.join(', '))}` : ''}</div>${window.body ? `<p>${escape(window.body)}</p>` : ''}</div>`,
    )
    .join('');

  const notice = message ? `<p class="muted">${escape(message)}</p>` : '';

  return shell(
    `${status.page.name} status`,
    `<h1>${escape(status.page.name)}</h1>${status.page.description ? `<p class="muted">${escape(status.page.description)}</p>` : ''}${headline}${notice}` +
      `<h2>Components</h2>${components || '<p class="muted">Nothing listed yet.</p>'}` +
      `<h2>Active incidents</h2>${active.map(incident).join('') || '<p class="muted">None.</p>'}` +
      `<h2>Scheduled maintenance</h2>${maintenance || '<p class="muted">None scheduled.</p>'}` +
      `<h2>Recently resolved</h2>${recent.map(incident).join('') || '<p class="muted">Nothing in the last seven days.</p>'}` +
      `<form method="post" action="${escape(status.page.path)}/subscribe" accept-charset="utf-8"><label for="email">Get updates by email</label><br><input type="email" id="email" name="email" required placeholder="you@example.com"><button type="submit">Subscribe</button></form>` +
      (status.page.supportUrl ? `<p class="muted">Need help? <a href="${escape(status.page.supportUrl)}">Contact support</a>.</p>` : '') +
      `<p class="muted">Last updated ${when(status.generatedAt)}.</p>`,
  );
}

export function renderNotice(title: string, message: string, backTo?: string): string {
  return shell(title, `<h1>${escape(title)}</h1><p>${escape(message)}</p>${backTo ? `<p><a href="${escape(backTo)}">Back to the status page</a></p>` : ''}`);
}
