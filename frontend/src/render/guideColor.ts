import { Color } from 'three';

/** Contrast is measured in linear light, matching Three's working color space. */
export function guideColor(felt: string): Color {
  const color=new Color(felt);
  const luminance=.2126*color.r+.7152*color.g+.0722*color.b;
  return color.lerp(new Color(luminance>.22?'black':'white'),luminance>.22?.84:.76);
}
