// GLSL for the reveal. All animation runs here from per-instance birth times, so a
// frame costs a few uniform updates. Positions are world units (one ring = 1); u_view maps world
// to clip space and u_px is one CSS pixel in clip units, so sizes are set in CSS pixels.

const COMMON = `#version 300 es
uniform vec3 u_viewX;
uniform vec3 u_viewY;
uniform vec2 u_px;
uniform float u_time;
uniform float u_reduced;
vec2 toClip(vec2 p) { return vec2(dot(u_viewX, vec3(p, 1.0)), dot(u_viewY, vec3(p, 1.0))); }
// 1 - (1 + 7t) e^(-7t) over 700 ms from birth [S3]; in place with a 150 ms fade when reduced
float flight(float birth) {
  float t = clamp((u_time - birth) / 700.0, 0.0, 1.0);
  return u_reduced > 0.5 ? 1.0 : 1.0 - (1.0 + 7.0 * t) * exp(-7.0 * t);
}
float fadeIn(float birth) {
  return smoothstep(0.0, u_reduced > 0.5 ? 150.0 : 175.0, u_time - birth);
}
`;

// Layer 1: front nodes. a_style = side + 2 * depth + 32 * density step (0–31, see renderer.ts).
export const NODE_VS = `${COMMON}
in vec2 a_pos; in vec2 a_from; in float a_birth; in float a_style;
uniform float u_dim;
out vec2 v_uv; out float v_r; out float v_alpha; out float v_side;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  float depth = mod(floor(a_style / 2.0), 16.0);
  float dens = floor(a_style / 32.0) / 31.0;
  float e = flight(a_birth);
  vec2 p = mix(a_from, a_pos, e);
  // radius in CSS px: 2.1 on the first ring, smaller further out; the roots are course markers
  v_r = depth < 0.5 ? 0.0 : max(1.1, 2.4 - 0.3 * depth) * (0.45 + 0.55 * e);
  v_uv = corner * (v_r + 0.75);
  gl_Position = vec4(toClip(p) + v_uv * u_px, 0.0, 1.0);
  v_alpha = fadeIn(a_birth) * u_dim * dens * 0.95 / (0.7 + 0.3 * depth);
  v_side = mod(a_style, 2.0);
}`;

export const EDGE_VS = `${COMMON}
in vec2 a_pos; in vec2 a_from; in float a_birth; in float a_style;
uniform float u_dim;
out float v_alpha; out float v_side;
void main() {
  float depth = mod(floor(a_style / 2.0), 16.0);
  float dens = floor(a_style / 32.0) / 31.0;
  vec2 head = mix(a_from, a_pos, flight(a_birth));
  vec2 a = toClip(a_from), b = toClip(head);
  vec2 dir = (b - a) / u_px;
  float len = max(length(dir), 1e-4);
  vec2 n = vec2(-dir.y, dir.x) / len;
  float along = float(gl_VertexID >> 1);
  float across = float(gl_VertexID & 1) * 2.0 - 1.0;
  gl_Position = vec4(mix(a, b, along) + n * across * 0.5 * u_px, 0.0, 1.0);
  v_alpha = depth < 0.5 ? 0.0 : 0.13 * fadeIn(a_birth) * u_dim * dens / (0.75 + 0.25 * depth);
  v_side = mod(a_style, 2.0);
}`;

// Front nodes: the side's colour, premultiplied, blended additively so the band where the
// fronts overlap brightens.
export const FRONT_FS = `#version 300 es
precision mediump float;
uniform vec3 u_start; uniform vec3 u_finish;
in vec2 v_uv; in float v_r; in float v_alpha; in float v_side;
out vec4 o;
void main() {
  float a = v_alpha * (1.0 - smoothstep(v_r - 0.75, v_r + 0.75, length(v_uv)));
  vec3 c = mix(u_start, u_finish, v_side);
  o = vec4(c * a, a);
}`;

export const EDGE_FS = `#version 300 es
precision mediump float;
uniform vec3 u_start; uniform vec3 u_finish;
in float v_alpha; in float v_side;
out vec4 o;
void main() { vec3 c = mix(u_start, u_finish, v_side); o = vec4(c * v_alpha, v_alpha); }`;

// Layer 2: DAG nodes (a_style = side + 2 * meeting) and edges, faded in by u_alpha.
export const DAG_NODE_VS = `${COMMON}
in vec2 a_pos; in float a_style;
uniform float u_alpha;
out vec2 v_uv; out float v_alpha; out float v_side; out float v_meet;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  v_side = mod(a_style, 2.0);
  v_meet = floor(a_style / 2.0);
  float size = v_meet > 0.5 ? 3.2 : 2.8;
  gl_Position = vec4(toClip(a_pos) + corner * (size + 0.75) * u_px, 0.0, 1.0);
  v_uv = corner * (size + 0.75) / size;
  v_alpha = u_alpha;
}`;

export const DAG_NODE_FS = `#version 300 es
precision mediump float;
uniform vec3 u_start; uniform vec3 u_finish;
in vec2 v_uv; in float v_alpha; in float v_side; in float v_meet;
out vec4 o;
void main() {
  float a = v_alpha * (1.0 - smoothstep(0.82, 1.15, length(v_uv)));
  // meeting articles, where the two fronts touched, lean towards white
  vec3 c = mix(mix(u_start, u_finish, v_side), vec3(1.0), v_meet * 0.25);
  o = vec4(c * a, a);
}`;

export const DAG_EDGE_VS = `${COMMON}
in vec2 a_a; in vec2 a_b; in float a_style;
uniform float u_alpha;
out float v_alpha; out float v_side;
void main() {
  vec2 a = toClip(a_a), b = toClip(a_b);
  vec2 dir = (b - a) / u_px;
  float len = max(length(dir), 1e-4);
  vec2 n = vec2(-dir.y, dir.x) / len;
  float along = float(gl_VertexID >> 1);
  float across = float(gl_VertexID & 1) * 2.0 - 1.0;
  gl_Position = vec4(mix(a, b, along) + n * across * 0.6 * u_px, 0.0, 1.0);
  v_alpha = 0.42 * u_alpha;
  v_side = a_style;
}`;

// Layer 3: a course. Legs are 3 px; leg i of n shows as u_progress passes i / n.
export const LEG_VS = `${COMMON}
in vec2 a_a; in vec2 a_b; in float a_leg;
uniform float u_progress; uniform float u_legs; uniform float u_width; uniform float u_fade;
out float v_alpha;
void main() {
  float f = clamp(u_progress * u_legs - a_leg, 0.0, 1.0);
  f = 1.0 - pow(1.0 - f, 3.0);
  vec2 a = toClip(a_a), b = toClip(mix(a_a, a_b, f));
  vec2 dir = (b - a) / u_px;
  float len = max(length(dir), 1e-4);
  vec2 n = vec2(-dir.y, dir.x) / len;
  float along = float(gl_VertexID >> 1);
  float across = float(gl_VertexID & 1) * 2.0 - 1.0;
  gl_Position = vec4(mix(a, b, along) + n * across * 0.5 * u_width * u_px, 0.0, 1.0);
  v_alpha = f > 0.0 ? u_fade : 0.0;
}`;

export const LEG_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
in float v_alpha;
out vec4 o;
void main() { o = vec4(u_color * v_alpha, v_alpha); }`;

// Stops: a_kind 0 = stop (dot punched out of the legs by a void ring), 1 = start (filled dot),
// 2 = finish (dot with a ring). a_index orders the reveal; the start and finish markers use -1
// so they show from the beginning.
export const STOP_VS = `${COMMON}
in vec2 a_pos; in float a_kind; in float a_index;
uniform float u_progress; uniform float u_legs; uniform float u_fade;
out vec2 v_uv; out float v_kind; out float v_alpha; out float v_r;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  // a stop appears as the leg into it arrives, growing to full size
  float shown = a_index < 0.0 ? 1.0 : clamp((u_progress * u_legs - a_index) * 4.0 + 1.0, 0.0, 1.0);
  float grow = u_reduced > 0.5 ? 1.0 : 1.0 - pow(1.0 - shown, 3.0);
  v_r = (a_kind > 1.5 ? 10.5 : a_kind > 0.5 ? 8.0 : 5.5) + 1.0;
  float scale = mix(0.4, 1.0, grow);
  gl_Position = vec4(toClip(a_pos) + corner * v_r * scale * u_px, 0.0, 1.0);
  // the fragment shader works in unscaled px, so the growth scales the whole symbol
  v_uv = corner * v_r;
  v_kind = a_kind;
  v_alpha = shown * (a_index < 0.0 ? 1.0 : u_fade);
}`;

export const STOP_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color; uniform vec3 u_void; uniform vec3 u_start; uniform vec3 u_finish;
in vec2 v_uv; in float v_kind; in float v_alpha; in float v_r;
out vec4 o;
float disc(float d, float r) { return 1.0 - smoothstep(r - 0.6, r + 0.6, d); }
void main() {
  float d = length(v_uv);
  vec3 c;
  float a;
  if (v_kind > 1.5) {
    // finish: magenta dot, void gap, white ring
    a = disc(d, 10.5);
    c = mix(mix(vec3(1.0), u_void, disc(d, 8.6)), u_finish, disc(d, 6.0));
  } else if (v_kind > 0.5) {
    // start: emerald dot in a void ring
    a = disc(d, 8.0);
    c = mix(u_void, u_start, disc(d, 6.0));
  } else {
    // stop: the course colour, punched out of the legs by a void ring
    a = disc(d, 5.5);
    c = mix(u_void, u_color, disc(d, 3.6));
  }
  a *= v_alpha;
  o = vec4(c * a, a);
}`;
