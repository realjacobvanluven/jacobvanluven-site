/**
 * Shared GLSL. One analytic blue-hour sky is used for the sky dome, glass reflections, water and fog,
 * so every surface agrees with the sky behind it.
 */

/** Sun ~6° below the horizon, toward the west-northwest (left of the downtown view). World: X east, Z south. */
export const SUN_AZIMUTH_DEG = 298;
export const SUN_ELEVATION_DEG = -6;

export function sunDirection() {
  const az = (SUN_AZIMUTH_DEG * Math.PI) / 180, el = (SUN_ELEVATION_DEG * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

export const skyGlsl = /* glsl */ `
uniform vec3 uSunDir;

// Linear HDR sky radiance for a world-space direction.
vec3 skyColor(vec3 d) {
  float y = d.y;
  float h = max(y, 0.0);
  vec3 zenith = vec3(0.003, 0.008, 0.042);
  vec3 mid = vec3(0.007, 0.022, 0.095);
  vec3 horizon = vec3(0.028, 0.050, 0.135);
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.16, h));
  c = mix(c, zenith, smoothstep(0.12, 0.75, h));

  // Warm afterglow low in the west-northwest, fading with height and with angle from the sun.
  vec2 dh = normalize(d.xz + 1e-6);
  vec2 sh = normalize(uSunDir.xz);
  float toward = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0); // clamp: pow() of a tiny negative is NaN
  float band = exp(-h * 11.0);
  // Amber-orange, hugging the horizon; deep navy stays overhead.
  c += vec3(1.00, 0.50, 0.12) * pow(toward, 5.0) * exp(-h * 16.0) * 0.8;
  c += vec3(1.00, 0.60, 0.22) * pow(toward, 3.0) * exp(-h * 12.0) * 0.06;

  if (y < 0.0) {
    // Below the horizon (only seen in reflections and haze): darker, still tinted by the glow.
    c = mix(horizon * 0.55, vec3(0.012, 0.016, 0.03), smoothstep(0.0, 0.25, -y))
      + vec3(1.0, 0.38, 0.10) * pow(toward, 7.0) * 0.25 * exp(y * 18.0);
  }
  return c;
}

// Haze colour: the horizon sky in the direction of view.
vec3 hazeColor(vec3 viewDir) {
  return skyColor(normalize(vec3(viewDir.x, 0.015, viewDir.z)));
}
`;

export const hashGlsl = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Exponential distance fog toward the horizon colour. */
export const fogGlsl = /* glsl */ `
uniform float uFogDensity;
vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - cameraPosition;
  float dist = length(v);
  float f = 1.0 - exp(-dist * uFogDensity);
  return mix(col, hazeColor(v / dist), f);
}
`;
