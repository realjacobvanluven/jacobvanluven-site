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

  // Light pollution: a faint warm dome low over downtown (north-west of the camera).
  vec2 cityDir = normalize(vec2(-0.5, -0.87)); // world xz toward bearing ~330°
  float towardCity = clamp(dot(dh, cityDir), 0.0, 1.0);
  c += vec3(1.0, 0.58, 0.3) * pow(towardCity, 2.0) * exp(-h * 22.0) * 0.06;

  if (y < 0.0) {
    // Below the horizon (only seen in reflections and haze): darker, still tinted by the glow.
    c = mix(horizon * 0.55, vec3(0.012, 0.016, 0.03), smoothstep(0.0, 0.25, -y))
      + vec3(1.0, 0.38, 0.10) * pow(toward, 7.0) * 0.25 * exp(y * 18.0);
  }
  return c;
}

// Thin cloud layer (sky dome only, so other shaders don't pay for it): value-noise fbm on a plane ~2.5 km
// up, drifting slowly; undersides lit by the city glow and the western afterglow.
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 skyWithClouds(vec3 d, float time) {
  vec3 base = skyColor(d);
  if (d.y < 0.02) return base;
  vec2 p = d.xz / d.y * 2.5 + vec2(time * 0.004, time * 0.0015); // in km on the cloud plane
  float n = 0.0, amp = 0.5;
  vec2 q = p * 0.55;
  for (int o = 0; o < 4; o++) { n += cloudNoise(q) * amp; q *= 2.07; amp *= 0.5; }
  float cover = smoothstep(0.5, 0.78, n);
  // Fade into the haze toward the horizon.
  cover *= smoothstep(0.02, 0.12, d.y) * 0.75;
  vec2 dh = normalize(d.xz + 1e-6);
  float west = pow(clamp(dot(dh, normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0), 4.0);
  float city = pow(clamp(dot(dh, normalize(vec2(-0.5, -0.87))), 0.0, 1.0), 1.5);
  vec3 cloudCol = vec3(0.012, 0.016, 0.035)               // unlit body
    + vec3(1.0, 0.45, 0.15) * west * 0.10 * exp(-d.y * 4.0) // afterglow on the western clouds
    + vec3(1.0, 0.6, 0.32) * city * 0.035;                 // city light on the undersides
  return mix(base, cloudCol, cover);
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

/**
 * Smooth value noise and the colour of open ground (asphalt, paving, lawn): organic broad patches with finer variation,
 * not the square lots the first version used. Needs hashGlsl.
 */
export const groundGlsl = /* glsl */ `
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gfbm(vec2 p) { return gnoise(p) * 0.55 + gnoise(p * 2.13 + 7.1) * 0.3 + gnoise(p * 4.7 + 13.3) * 0.15; }
vec3 groundColor(vec2 p) {
  float broad = gfbm(p / 70.0);
  float mid = gfbm(p / 11.0);
  float fine = gfbm(p * 0.9);
  float lawn = smoothstep(0.42, 0.56, gfbm(p / 45.0 + 3.0));
  vec3 paved = vec3(0.020, 0.021, 0.025);
  vec3 grass = vec3(0.014, 0.027, 0.015);
  vec3 col = mix(paved, grass, lawn) * (0.72 + 0.5 * mid) * (0.88 + 0.24 * fine);
  return col + vec3(0.006, 0.004, 0.002) * broad;
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
