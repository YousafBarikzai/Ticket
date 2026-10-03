import type { ReactNode } from 'react';
import { SHOT_ALT } from '../landing/content.js';
import { ShotPreview } from '../landing/HeroPreview.js';
import { SHOT_MANIFEST } from '../landing/shots/manifest.js';
import type { ShotAsset, ShotId } from '../landing/shots.config.js';

/** How wide the picture is drawn, per place it appears (A5 §5.3), so the browser picks the right file. */
const SIZES = {
  spot: '(min-width: 1280px) 690px, (min-width: 900px) 55vw, 100vw',
  card: '(min-width: 1024px) 360px, (min-width: 768px) 45vw, 100vw',
} as const;

export interface ShotProps {
  readonly id: ShotId;
  /** A spotlight's large picture or a feature card's small one. */
  readonly variant: keyof typeof SIZES;
  /** The manifest to read; the generated one by default (a parameter so a test can hand it a captured shot). */
  readonly manifest?: Readonly<Partial<Record<ShotId, ShotAsset>>>;
}

const srcSet = (sources: ShotAsset['avif']): string => sources.map((source) => `${source.src} ${source.width}w`).join(', ');

/**
 * A picture of the product (A5 §5.3–§5.4; X-M9).
 *
 * Once the final wave has captured it, a `<picture>` with AVIF and WebP at
 * three widths, lazy (nothing above the fold is a picture: the hero is live
 * markup), with its width and height set so it moves nothing as it loads.
 * Until then — the manifest starts empty — a small server-rendered picture of
 * the same screen from the sample data, labelled "Sample data", in the same
 * frame: never a "coming soon" box a prospect could be shown.
 */
export function Shot({ id, variant, manifest = SHOT_MANIFEST }: ShotProps): ReactNode {
  const asset = manifest[id];
  if (!asset || asset.webp.length === 0) return <ShotPreview id={id} />;
  const fallback = asset.webp[Math.min(1, asset.webp.length - 1)]!;
  return (
    <picture className="app-Shot" data-shot={id}>
      {asset.avif.length > 0 ? <source type="image/avif" srcSet={srcSet(asset.avif)} sizes={SIZES[variant]} /> : null}
      <source type="image/webp" srcSet={srcSet(asset.webp)} sizes={SIZES[variant]} />
      <img src={fallback.src} width={asset.width} height={asset.height} alt={SHOT_ALT[id]} loading="lazy" decoding="async" />
    </picture>
  );
}
