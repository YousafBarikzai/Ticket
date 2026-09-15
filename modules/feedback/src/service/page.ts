import type { OpenedInvitation } from './response-service.js';
import { questionsOf } from '../domain/survey-document.js';

/**
 * The page behind the link, as HTML.
 *
 * The platform has no portal application in this repository, and a link in
 * somebody's inbox has to land on something a person can use. So the API
 * serves a small page: the questions, a form, a thank-you. Everything from the
 * document and the ticket is escaped; nothing in it is executable; the form
 * posts back to the same URL. When a portal exists, it renders the JSON this
 * route also returns and this page becomes the fallback.
 */

function escape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fafafa}
  h1{font-size:1.5rem}fieldset{border:0;padding:0;margin:0 0 1.5rem}legend,label{display:block;font-weight:600;margin-bottom:.5rem}
  .scale{display:flex;gap:.5rem}.scale label{flex:1;text-align:center;border:1px solid #bbb;border-radius:.5rem;padding:.75rem 0;font-weight:500;cursor:pointer}
  .scale input{position:absolute;opacity:0}.scale input:checked+span{background:#1a5fb4;color:#fff;border-radius:.4rem;padding:.4rem .8rem}
  textarea,input[type=text],input[type=number],select{width:100%;padding:.6rem;border:1px solid #bbb;border-radius:.4rem;font:inherit}
  button{background:#1a5fb4;color:#fff;border:0;border-radius:.5rem;padding:.75rem 1.5rem;font:inherit;cursor:pointer}
  .muted{color:#555}.error{color:#a51d2d}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function renderSurveyPage(opened: OpenedInvitation, errors: Record<string, string> = {}): string {
  const document = opened.survey.document;

  if (opened.status !== 'pending') {
    const message =
      opened.status === 'responded'
        ? 'Thank you — you have already answered this one.'
        : opened.status === 'expired'
          ? 'This survey has closed. Thank you for looking.'
          : 'This survey is no longer open.';
    return shell(document.title, `<h1>${escape(document.title)}</h1><p class="muted">${escape(message)}</p>`);
  }

  const fields = questionsOf(document)
    .map((question) => {
      const error = errors[question.field] ? `<p class="error">${escape(errors[question.field])}</p>` : '';
      const name = escape(question.field);
      const label = `${escape(question.label)}${question.required ? '' : ' <span class="muted">(optional)</span>'}`;

      if (question.control === 'number' && question.min !== undefined && question.max !== undefined && question.max - question.min <= 10) {
        const options: string[] = [];
        for (let value = question.min; value <= question.max; value += 1) {
          options.push(`<label><input type="radio" name="${name}" value="${value}"${question.required ? ' required' : ''}><span>${value}</span></label>`);
        }
        return `<fieldset><legend>${label}</legend><div class="scale">${options.join('')}</div>${error}</fieldset>`;
      }
      if (question.control === 'longtext') {
        return `<fieldset><label for="${name}">${label}</label><textarea id="${name}" name="${name}" rows="4"${question.required ? ' required' : ''}></textarea>${error}</fieldset>`;
      }
      if ((question.control === 'select' || question.control === 'multiselect') && question.options) {
        const options = question.options.map((option) => `<option value="${escape(option.value)}">${escape(option.label)}</option>`).join('');
        return `<fieldset><label for="${name}">${label}</label><select id="${name}" name="${name}"${question.control === 'multiselect' ? ' multiple' : ''}${question.required ? ' required' : ''}><option value=""></option>${options}</select>${error}</fieldset>`;
      }
      if (question.control === 'checkbox') {
        return `<fieldset><label><input type="checkbox" name="${name}" value="true"> ${label}</label>${error}</fieldset>`;
      }
      const type = question.control === 'number' ? 'number' : 'text';
      return `<fieldset><label for="${name}">${label}</label><input type="${type}" id="${name}" name="${name}"${question.required ? ' required' : ''}></fieldset>${error}`;
    })
    .join('');

  const about = opened.ticketNumber ? `<p class="muted">About ${escape(opened.ticketNumber)}.</p>` : '';
  const description = document.description ? `<p>${escape(document.description)}</p>` : '';
  return shell(
    document.title,
    `<h1>${escape(document.title)}</h1>${about}${description}<form method="post" accept-charset="utf-8">${fields}<button type="submit">Send</button></form>`,
  );
}

export function renderThanksPage(title: string, thanks: string): string {
  return shell(title, `<h1>${escape(title)}</h1><p>${escape(thanks)}</p>`);
}
