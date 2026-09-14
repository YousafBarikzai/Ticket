/**
 * The React Native rendering of the tokens.
 *
 * `apps/mobile` cannot read CSS custom properties, so the same token data is
 * projected into the shapes React Native's style system expects: absolute
 * pixel line heights instead of ratios, letter spacing in points instead of
 * em, numeric font weights as strings, and shadows split into the iOS
 * (`shadow*`) and Android (`elevation`) props.
 *
 * This module deliberately declares its own structural types rather than
 * importing from `react-native`: the design-system package must typecheck in
 * the web apps and in CI without the Expo toolchain installed. The shapes are
 * assignable to `ViewStyle` and `TextStyle` where they are used.
 */
import {
  breakpoint,
  borderWidth,
  colour,
  controlHeight,
  duration,
  easing,
  elevation,
  focusRing,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  spacing,
  textStyle,
  themeNames,
  zIndex,
  type ColourTheme,
  type ElevationToken,
  type TextStyleToken,
  type ThemeName,
} from './tokens.js';

export interface NativeTextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  /** Absolute, in points: React Native has no unitless line height. */
  readonly lineHeight: number;
  readonly fontWeight: '400' | '500' | '600' | '700';
  readonly letterSpacing: number;
}

export interface NativeShadowStyle {
  readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  /** Android's single-number approximation of the same depth. */
  readonly elevation: number;
}

export interface NativeTheme {
  readonly name: ThemeName;
  /** `dark` drives the status bar and the native keyboard appearance. */
  readonly scheme: 'light' | 'dark';
  readonly colour: ColourTheme;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly borderWidth: typeof borderWidth;
  readonly controlHeight: typeof controlHeight;
  readonly focusRing: typeof focusRing;
  readonly zIndex: typeof zIndex;
  readonly breakpoint: typeof breakpoint;
  readonly text: Readonly<Record<TextStyleToken, NativeTextStyle>>;
  readonly shadow: Readonly<Record<ElevationToken, NativeShadowStyle>>;
  readonly motion: {
    readonly duration: typeof duration;
    /** Bezier control points, ready for `Easing.bezier(...easing.standard)`. */
    readonly easing: typeof easing;
  };
}

function nativeTextStyle(token: TextStyleToken): NativeTextStyle {
  const style = textStyle[token];
  const size = fontSize[style.size];
  const family = fontFamily[style.family][0];
  return {
    // The first entry of the stack is the face Expo bundles; the rest are web
    // fallbacks that mean nothing to React Native.
    fontFamily: family,
    fontSize: size,
    lineHeight: Math.round(size * lineHeight[style.lineHeight]),
    fontWeight: String(fontWeight[style.weight]) as NativeTextStyle['fontWeight'],
    letterSpacing: Number((letterSpacing[style.letterSpacing] * size).toFixed(2)),
  };
}

function nativeShadow(level: ElevationToken, shadowColour: string): NativeShadowStyle {
  const layers = elevation[level];
  if (layers.length === 0) {
    return { shadowColor: shadowColour, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 };
  }
  // React Native draws one shadow, so the deepest layer wins and the others'
  // opacity is folded in — the visual weight matters more than the geometry.
  const deepest = layers.reduce((a, b) => (b.blur > a.blur ? b : a));
  const combinedOpacity = Math.min(1, layers.reduce((sum, l) => sum + l.opacity, 0));
  return {
    shadowColor: shadowColour,
    shadowOffset: { width: 0, height: deepest.offsetY },
    shadowOpacity: Number(combinedOpacity.toFixed(3)),
    shadowRadius: deepest.blur / 2,
    elevation: Math.round(deepest.offsetY + deepest.blur / 4),
  };
}

export function createNativeTheme(name: ThemeName): NativeTheme {
  const palette = colour[name];
  const text = {} as Record<TextStyleToken, NativeTextStyle>;
  for (const token of Object.keys(textStyle) as TextStyleToken[]) text[token] = nativeTextStyle(token);

  const shadow = {} as Record<ElevationToken, NativeShadowStyle>;
  for (const level of Object.keys(elevation) as ElevationToken[]) shadow[level] = nativeShadow(level, palette.shadow);

  return {
    name,
    scheme: name === 'dark' ? 'dark' : 'light',
    colour: palette,
    spacing,
    radius,
    borderWidth,
    controlHeight,
    focusRing,
    zIndex,
    breakpoint,
    text,
    shadow,
    motion: { duration, easing },
  };
}

/** Every theme, built once — themes are immutable data, so there is nothing to rebuild per render. */
export const nativeThemes: Readonly<Record<ThemeName, NativeTheme>> = Object.fromEntries(
  themeNames.map((name) => [name, createNativeTheme(name)]),
) as Record<ThemeName, NativeTheme>;
