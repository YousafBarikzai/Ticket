/**
 * The pre-paint theme script.
 *
 * A theme chosen in the product has to be on `<html>` before the first pixel
 * is drawn, or a person who chose dark sees a white page flash on every load.
 * A React effect is too late — it runs after paint — and a cookie would need
 * the server to render per person and make every page uncacheable. So each
 * root layout puts this script first in `<head>`, inline and blocking: it
 * reads `localStorage`, works out the attributes and sets them, in well under
 * a millisecond, before the stylesheet has been applied to anything.
 *
 * It is a string rather than a function because it runs outside React and
 * outside the bundle. It is written by hand, small (under 1 kB), in ES5, and
 * wrapped in `try` so that no storage failure, missing API or odd stored value
 * can stop the page: the worst case is the attributes the stylesheet would
 * have chosen anyway. `theme-script.test.ts` runs it against the same matrix
 * as `preferenceAttributes()` in `prefs.ts`, so the two cannot drift.
 *
 * Content Security Policy: the apps allow inline scripts today. A nonce-based
 * policy would need a `nonce` passed through here (ADR-0052).
 */
import { legacyThemeStorageKey, normalisePrefs, prefValues, prefsStorageKey, type AppName, type Prefs } from './prefs.js';

export interface ThemeInitScriptOptions {
  /** The storage key; `itsm-prefs` unless an app has a reason to differ. */
  readonly storageKey?: string;
  readonly app: AppName;
  /** This app's defaults, where they differ from the system's. */
  readonly defaults?: Partial<Prefs>;
}

/**
 * JSON that is safe inside an inline `<script>`: `<` is escaped, so no value
 * can close the element early (`</script>`) or open a comment.
 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The script, as the text of an inline `<script>` element.
 *
 * Readable form of what it does:
 *
 *   1. Read `itsm-prefs`. If it is absent, read the legacy `itsm-theme` string
 *      and translate it as `migrateLegacyTheme` does. The script only reads:
 *      `ThemeProvider` stores the translation under the new key and removes
 *      the old one on its first mount, so the two never race to write.
 *   2. For each preference, take the stored value if it is one of the allowed
 *      values, otherwise this app's default.
 *   3. If appearance or contrast is set to something other than "system",
 *      resolve the theme — asking `matchMedia` only for the axis still on
 *      "system" — and set `data-itsm-theme`. With both on "system" the
 *      attribute stays off and the stylesheet's media queries decide, live.
 *   4. Set density, motion, transparency, the collapsed sidebar and (in the
 *      workbench) the inspector; then the platform, for ⌘ versus Ctrl.
 */
export function themeInitScript({ storageKey = prefsStorageKey, app, defaults = {} }: ThemeInitScriptOptions): string {
  // Sanitised as the provider sanitises them, so a stray `undefined` or an
  // unrecognised default cannot reach the generated code.
  const effective = normalisePrefs({}, defaults);
  const q = inlineJson;

  // Each preference is checked by code generated for its allowed values and
  // this app's default, rather than by a lookup table the script would have to
  // carry: the bytes are paid on every page. A stored value that is not
  // allowed reads as the default, as it does in `sanitisePrefs`.
  const choice = (name: 'density' | 'inspector'): string => {
    const other = prefValues[name].find((value) => value !== effective[name])!;
    return `p.${name}==${q(other)}?${q(other)}:${q(effective[name])}`;
  };
  // The on/off attributes are present only for their "on" value.
  const flag = (name: 'motion' | 'transparency' | 'nav'): string => {
    const [off, on] = prefValues[name];
    const test = effective[name] === on ? `p.${name}!=${q(off)}` : `p.${name}==${q(on)}`;
    return `${test}&&t(${q(name)},${q(on)});`;
  };
  // The theme axes. With a default of "system" an axis is pinned only when it
  // holds one of its explicit values; with an explicit default, anything but
  // "system" pins it, and anything unrecognised reads as that default.
  const axis = (name: 'appearance' | 'contrast', v: string, pinnedAs: string): string => {
    const explicit = prefValues[name].filter((option) => option !== 'system');
    const isExplicit = explicit.map((option) => `${v}==${q(option)}`).join('||');
    return effective[name] === 'system'
      ? `${v}=p.${name},${pinnedAs}=${isExplicit}`
      : `${v}=p.${name},${pinnedAs}=${v}!="system",${v}=${isExplicit}?${v}:${q(effective[name])}`;
  };

  return (
    '(function(){try{var d=document.documentElement,p,s,S;' +
    // 1. Storage. Its own `try`: a denied or corrupt store still leaves every
    //    other attribute to be set. The legacy key is read here and migrated
    //    for good by `ThemeProvider` (`readStoredPrefs`), which owns writes.
    `try{S=localStorage;s=S.getItem(${q(storageKey)});if(s)p=JSON.parse(s);else{s=S.getItem(${q(legacyThemeStorageKey)});` +
    'p=s=="apple"||s=="light"?{appearance:"light"}:s=="apple-dark"||s=="dark"?{appearance:"dark"}:s=="high-contrast"?{contrast:"more"}:{}}' +
    // `Object()` turns a stored `null` into an object; a stored string or
    // number simply has none of the properties read below.
    '}catch(e){}p=Object(p);' +
    'function m(q){try{return matchMedia(q).matches}catch(e){}}' +
    'function t(n,v){d.setAttribute("data-itsm-"+n,v)}' +
    // 2. The theme, only when an axis is pinned; the device answers for the other.
    `var ${axis('appearance', 'a', 'x')},${axis('contrast', 'c', 'y')};` +
    'if(x||y)t("theme",((y?c=="more":m("(prefers-contrast: more)"))?"high-contrast":"apple")+' +
    '((x?a=="dark":m("(prefers-color-scheme: dark)"))?"-dark":""));' +
    // 3. Everything else, then the platform.
    `t("density",${choice('density')});` +
    flag('motion') +
    flag('transparency') +
    flag('nav') +
    (app === 'workbench' ? `t("inspector",${choice('inspector')});` : '') +
    's=navigator;s=s.platform||s.userAgent;' +
    't("os",/mac|^ip/i.test(s)?"apple":/win/i.test(s)?"windows":"other")' +
    '}catch(e){}})();'
  );
}
