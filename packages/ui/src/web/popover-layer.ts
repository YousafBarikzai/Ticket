'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads `PopoverLayer` — the popover library behind `Combobox` and
 * `DatePicker`, and the calendar — on the first sign that someone wants it.
 *
 * The field is drawn at once, without it; the layer is fetched when the field
 * takes focus or the pointer arrives (a preload, so it is usually there
 * before the first key), and at the latest when the list or calendar is
 * asked to open. Once fetched it is kept here, so every later field renders
 * it straight away.
 *
 * A fetch that fails is forgotten, so the next focus or opening tries again;
 * nothing throws into the page. On the server nothing is ever loaded, and the
 * first client render matches it.
 */

type LayerModule = typeof import('./PopoverLayer.js');

let loaded: LayerModule | null = null;
let pending: Promise<LayerModule> | null = null;

/** Fetches the layer once. Resolves at once when it is already here. */
export function loadPopoverLayer(): Promise<LayerModule> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('./PopoverLayer.js').then(
    (module) => {
      loaded = module;
      pending = null;
      return module;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

export interface PopoverLayerState {
  /** The layer's module once it has arrived; `null` before (and on the server). */
  readonly layer: LayerModule | null;
  /** Starts fetching it: call on focus and pointer arrival. Safe to call often. */
  readonly preload: () => void;
}

/** The popover layer for one control. `wanted` (the popup should be open) fetches it if nothing has yet. */
export function usePopoverLayer(wanted: boolean): PopoverLayerState {
  const [layer, setLayer] = useState<LayerModule | null>(loaded);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const preload = useCallback(() => {
    if (loaded) {
      setLayer(loaded);
      return;
    }
    loadPopoverLayer().then(
      (module) => {
        if (alive.current) setLayer(module);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (wanted && layer === null) preload();
  }, [wanted, layer, preload]);

  // Another field may have fetched it since this one last rendered.
  return { layer: layer ?? loaded, preload };
}

/**
 * Escape for a popup that was asked for and has not arrived yet.
 *
 * Once loaded, the popup is on the overlay stack and closes first on Escape,
 * before any dialog or sheet around the field (SPEC §4.3). In the moment
 * before it lands it is on no stack, and a dialog's own listener would take
 * the key and close the dialog instead. So while `active`, a key press whose
 * target the control `owns` is taken here first — at the window, in the
 * capture phase, ahead of every layer's listener — and closes the popup.
 */
export function useEscapeBeforeLayer(active: boolean, owns: (target: EventTarget | null) => boolean, onEscape: () => void): void {
  const latest = useRef({ owns, onEscape });
  latest.current = { owns, onEscape };
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !latest.current.owns(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onEscape();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}
