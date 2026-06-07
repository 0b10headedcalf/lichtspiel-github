/**
 * GLSL (WebGL1 / GLSL ES 1.00) for the audio-reactive distortion overlay.
 *
 * The distortion fragment shader samples the live p5 frame (`uScene`) plus the
 * previous output frame (`uPrev`, for feedback echo) and warps the image with a
 * stack of effects whose strengths are driven by audio: a radial bulge, a
 * traveling sine warp, turbulent ripple, kaleidoscope fold, vertical slice
 * desync, block/datamosh glitch, chromatic RGB split, hue rotation, scanlines,
 * and a beat bloom. Every uniform at 0 → an exact passthrough of `uScene`.
 *
 * The copy shader is a trivial blit used to present the rendered FBO to screen.
 */

/** Full-screen quad. uv derived from clip position; the scene texture is
 *  uploaded with UNPACK_FLIP_Y so it lands upright. */
export const FULLSCREEN_VERT = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const DISTORT_FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uTime;
uniform float uBulge;
uniform float uWarp;
uniform float uRipple;
uniform float uChroma;
uniform float uGlitch;
uniform float uShift;
uniform float uDesync;
uniform float uFeedback;
uniform float uScan;
uniform float uHue;
uniform float uBloom;
uniform float uKaleido;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 hueRotate(vec3 col, float a) {
  const mat3 toYIQ = mat3(0.299, 0.587, 0.114, 0.596, -0.274, -0.322, 0.211, -0.523, 0.312);
  const mat3 toRGB = mat3(1.0, 0.956, 0.621, 1.0, -0.272, -0.647, 1.0, -1.106, 1.703);
  vec3 yiq = toYIQ * col;
  float c = cos(a), s = sin(a);
  yiq = vec3(yiq.x, yiq.y * c - yiq.z * s, yiq.y * s + yiq.z * c);
  return toRGB * yiq;
}

// Fold uv into mirrored angular wedges around the center.
vec2 kaleido(vec2 uv, float segsF) {
  float segs = floor(2.0 + segsF * 8.0);
  vec2 p = uv - 0.5;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float seg = 6.2831853 / segs;
  ang = abs(mod(ang, seg) - seg * 0.5);
  return vec2(cos(ang), sin(ang)) * r + 0.5;
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // Radial bulge / pinch.
  uv += c * uBulge * (0.6 - r2) * 1.6;

  // Kaleidoscope fold.
  if (uKaleido > 0.001) uv = mix(uv, kaleido(uv, uKaleido), clamp(uKaleido, 0.0, 1.0));

  // Large-scale traveling warp (bass).
  float t = uTime;
  uv.x += sin(uv.y * 8.0 + t * 1.7) * 0.03 * uWarp;
  uv.y += cos(uv.x * 7.0 + t * 1.3) * 0.03 * uWarp;

  // Fine turbulent ripple (mid).
  if (uRipple > 0.001) {
    float nx = noise(uv * 9.0 + t * 0.8);
    float ny = noise(uv * 9.0 - t * 0.6);
    uv += (vec2(nx, ny) - 0.5) * 0.05 * uRipple;
  }

  // Per-band vertical slice desync (VHS tracking error).
  if (uDesync > 0.001) {
    float band = floor(uv.y * 24.0);
    float jitter = hash(band + floor(t * 12.0)) - 0.5;
    uv.x += jitter * 0.08 * uDesync;
  }

  // Block / datamosh glitch — random blocks tear sideways.
  if (uGlitch > 0.001) {
    vec2 bs = vec2(0.06, 0.10);
    vec2 block = floor(uv / bs);
    float g = hash2(block + floor(t * 15.0));
    if (g > 1.0 - uGlitch * 0.6) {
      uv.x += (hash2(block * 1.7) - 0.5) * 0.3 * uGlitch;
      uv += (vec2(hash2(block + 3.1), hash2(block + 7.7)) - 0.5) * 0.05 * uGlitch;
    }
  }

  // Chromatic split + beat tear — sample R/G/B at horizontal offsets.
  float shift = uShift * 0.06 + uChroma * 0.015;
  vec3 col;
  col.r = texture2D(uScene, uv + vec2(shift, 0.0)).r;
  col.g = texture2D(uScene, uv).g;
  col.b = texture2D(uScene, uv - vec2(shift, 0.0)).b;

  // Feedback echo — blend a slowly zooming sample of the previous output.
  if (uFeedback > 0.001) {
    vec2 fuv = (uv - 0.5) * 0.988 + 0.5;
    vec3 prev = texture2D(uPrev, fuv).rgb;
    col = max(col, prev * (0.6 + 0.38 * uFeedback));
  }

  // Hue rotation (centroid / brightness).
  if (uHue > 0.001) col = hueRotate(col, uHue * 3.1416);

  // Scanlines + vignette (CRT veil).
  if (uScan > 0.001) {
    float sl = 0.5 + 0.5 * sin(uv.y * uRes.y * 1.6);
    col *= 1.0 - uScan * 0.35 * (1.0 - sl);
    float vig = smoothstep(1.1, 0.2, length(c) * 1.6);
    col *= mix(1.0, vig, uScan * 0.6);
  }

  // Beat bloom.
  col += col * uBloom * 0.6;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const COPY_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  gl_FragColor = texture2D(uTex, vUv);
}
`;
