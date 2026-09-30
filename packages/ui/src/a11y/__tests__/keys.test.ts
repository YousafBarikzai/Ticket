import { describe, expect, it } from 'vitest';
import {
  ariaKeyShortcuts,
  describeShortcut,
  isPlatformNeutral,
  isSingleKeyShortcut,
  matchesCombo,
  parseShortcut,
  type KeyPress,
} from '../keys.js';

/*
 * The notation every shortcut is written in, and the three things read from
 * it: whether a key press matches, how the caps are drawn, and what
 * `aria-keyshortcuts` says. `Kbd`, `useHotkey` and the shortcuts dialog all
 * go through here, so these are the cases that keep them agreeing.
 */

const press = (key: string, init: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe('parseShortcut', () => {
  it('reads combinations, chords and named keys', () => {
    expect(parseShortcut('mod+k')).toEqual([{ modifiers: ['mod'], key: 'k' }]);
    expect(parseShortcut('g m')).toEqual([
      { modifiers: [], key: 'g' },
      { modifiers: [], key: 'm' },
    ]);
    expect(parseShortcut('Mod+Shift+Enter')).toEqual([{ modifiers: ['mod', 'shift'], key: 'enter' }]);
    expect(parseShortcut('esc')).toEqual([{ modifiers: [], key: 'escape' }]);
    expect(parseShortcut('shift+f10')).toEqual([{ modifiers: ['shift'], key: 'f10' }]);
    expect(parseShortcut('alt+up')).toEqual([{ modifiers: ['alt'], key: 'arrowup' }]);
  });

  it('takes a trailing plus as the plus key', () => {
    expect(parseShortcut('mod++')).toEqual([{ modifiers: ['mod'], key: '+' }]);
    expect(parseShortcut('+')).toEqual([{ modifiers: [], key: '+' }]);
  });

  it('returns nothing for a typo rather than a wrong shortcut', () => {
    expect(parseShortcut('mdo+k')).toEqual([]);
    expect(parseShortcut('mod+kk')).toEqual([]);
    expect(parseShortcut('')).toEqual([]);
  });

  it('knows which shortcuts are single-key (WCAG 2.1.4)', () => {
    expect(isSingleKeyShortcut(parseShortcut('c'))).toBe(true);
    expect(isSingleKeyShortcut(parseShortcut('?'))).toBe(true);
    expect(isSingleKeyShortcut(parseShortcut('g m'))).toBe(true);
    expect(isSingleKeyShortcut(parseShortcut('shift+j'))).toBe(true);
    expect(isSingleKeyShortcut(parseShortcut('mod+k'))).toBe(false);
    expect(isSingleKeyShortcut(parseShortcut('escape'))).toBe(false);
    expect(isSingleKeyShortcut(parseShortcut('f6'))).toBe(false);
  });
});

describe('matchesCombo', () => {
  const [modK] = parseShortcut('mod+k');
  const [j] = parseShortcut('j');
  const [shiftJ] = parseShortcut('shift+j');
  const [question] = parseShortcut('?');
  const [slash] = parseShortcut('/');
  const [bracket] = parseShortcut('[');

  it('reads mod as Command on Apple devices and Control elsewhere', () => {
    expect(matchesCombo(press('k', { metaKey: true }), modK!, 'apple')).toBe(true);
    expect(matchesCombo(press('k', { ctrlKey: true }), modK!, 'apple')).toBe(false);
    expect(matchesCombo(press('k', { ctrlKey: true }), modK!, 'windows')).toBe(true);
    expect(matchesCombo(press('k', { metaKey: true }), modK!, 'other')).toBe(false);
  });

  it('tells a letter from its shifted form, whatever Caps Lock says', () => {
    expect(matchesCombo(press('j'), j!, 'other')).toBe(true);
    expect(matchesCombo(press('J'), j!, 'other')).toBe(true);
    expect(matchesCombo(press('J', { shiftKey: true }), j!, 'other')).toBe(false);
    expect(matchesCombo(press('J', { shiftKey: true }), shiftJ!, 'other')).toBe(true);
    expect(matchesCombo(press('j'), shiftJ!, 'other')).toBe(false);
  });

  it('matches symbols on the character typed, so ? and / work on every layout', () => {
    // US: ? is Shift+/. German: ? is Shift+ß, / is Shift+7. The character is what counts.
    expect(matchesCombo(press('?', { shiftKey: true, code: 'Slash' }), question!, 'other')).toBe(true);
    expect(matchesCombo(press('?', { shiftKey: true, code: 'Minus' }), question!, 'other')).toBe(true);
    expect(matchesCombo(press('/', { shiftKey: true, code: 'Digit7' }), slash!, 'other')).toBe(true);
    expect(matchesCombo(press('/', { code: 'Slash' }), slash!, 'other')).toBe(true);
    expect(matchesCombo(press('?', { shiftKey: true }), slash!, 'other')).toBe(false);
  });

  it('accepts the keys a layout needs to type a symbol, and never Command', () => {
    // [ is Option+5 on a German Mac and AltGr+8 (Ctrl+Alt) on a German PC.
    expect(matchesCombo(press('[', { altKey: true }), bracket!, 'apple')).toBe(true);
    expect(matchesCombo(press('[', { ctrlKey: true, altKey: true }), bracket!, 'windows')).toBe(true);
    expect(matchesCombo(press('[', { ctrlKey: true }), bracket!, 'windows')).toBe(false);
    expect(matchesCombo(press('[', { metaKey: true }), bracket!, 'apple')).toBe(false);
  });

  it('falls back to the physical key where the layout types something else', () => {
    // Option+K types ˚ on a Mac; a Cyrillic layout types л on the K key.
    const [altK] = parseShortcut('alt+k');
    expect(matchesCombo(press('˚', { altKey: true, code: 'KeyK' }), altK!, 'apple')).toBe(true);
    expect(matchesCombo(press('л', { ctrlKey: true, code: 'KeyK' }), modK!, 'windows')).toBe(true);
    expect(matchesCombo(press('л', { code: 'KeyK' }), parseShortcut('k')[0]!, 'other')).toBe(true);
    // An ASCII letter from another key is that letter, not the one under it.
    expect(matchesCombo(press('z', { code: 'KeyY' }), parseShortcut('y')[0]!, 'other')).toBe(false);
  });

  it('names Space and Escape as the notation does', () => {
    expect(matchesCombo(press(' '), parseShortcut('space')[0]!, 'other')).toBe(true);
    expect(matchesCombo(press('Escape'), parseShortcut('esc')[0]!, 'other')).toBe(true);
    expect(matchesCombo(press('Enter', { metaKey: true, shiftKey: true }), parseShortcut('mod+shift+enter')[0]!, 'apple')).toBe(true);
  });
});

describe('describeShortcut', () => {
  it('draws Apple glyphs in Apple’s modifier order, and words elsewhere', () => {
    expect(describeShortcut('mod+shift+k', 'apple')).toEqual({ steps: [['⇧', '⌘', 'K']], spoken: 'Shift Command K', text: '⇧⌘K' });
    expect(describeShortcut('mod+shift+k', 'windows')).toEqual({
      steps: [['Ctrl', 'Shift', 'K']],
      spoken: 'Control Shift K',
      text: 'Ctrl+Shift+K',
    });
  });

  it('reads a chord as one step then the next', () => {
    expect(describeShortcut('g m', 'apple')).toEqual({ steps: [['G'], ['M']], spoken: 'G, then M', text: 'G then M' });
  });

  it('gives symbols a spoken name, since a screen reader may skip punctuation', () => {
    expect(describeShortcut('?', 'other').spoken).toBe('Question mark');
    expect(describeShortcut('/', 'other').spoken).toBe('Slash');
    expect(describeShortcut('.', 'other').spoken).toBe('Full stop');
    expect(describeShortcut('mod+enter', 'apple').spoken).toBe('Command Return');
    expect(describeShortcut('mod+enter', 'windows').spoken).toBe('Control Enter');
  });

  it('knows when one rendering serves every platform', () => {
    expect(isPlatformNeutral('g m')).toBe(true);
    expect(isPlatformNeutral('?')).toBe(true);
    expect(isPlatformNeutral('mod+k')).toBe(false);
    expect(isPlatformNeutral('shift+j')).toBe(false);
  });
});

describe('ariaKeyShortcuts', () => {
  it('offers both platforms for mod, because the server cannot know which', () => {
    expect(ariaKeyShortcuts('mod+k')).toBe('Meta+K Control+K');
    expect(ariaKeyShortcuts('mod+shift+enter')).toBe('Shift+Meta+Enter Control+Shift+Enter');
  });

  it('writes plain keys as themselves and leaves chords out', () => {
    expect(ariaKeyShortcuts('?')).toBe('?');
    expect(ariaKeyShortcuts('shift+f10')).toBe('Shift+F10');
    expect(ariaKeyShortcuts('g m')).toBeUndefined();
  });
});
