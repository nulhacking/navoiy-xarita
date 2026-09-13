/**
 * Double precision 3D vektor va 4x4 matritsa.
 *
 * NIMA UCHUN KERAK: three.js `Vector3` ichida `number` (f64) saqlasa ham,
 * u GPU'ga f32 sifatida uzatiladi va `Matrix4` amallari f32 aniqligiga
 * mo'ljallangan. Yer radiusi ~6.4e6 m — f32 bu kattalikda ~0.5 m aniqlik
 * beradi. Shuning uchun BARCHA dunyo koordinatalari shu yerdagi turlarda,
 * sof JS `number` (IEEE-754 f64, ~1e-9 m aniqlik) bilan hisoblanadi va
 * faqat oxirida, origin'ga nisbatan KICHIK qiymat sifatida three.js'ga beriladi.
 */

export interface Vec3d {
  x: number;
  y: number;
  z: number;
}

/** Column-major 16 elementli matritsa — three.js `Matrix4.elements` bilan bir xil tartib. */
export type Mat4d = Float64Array;

export function vec3d(x = 0, y = 0, z = 0): Vec3d {
  return { x, y, z };
}

export function clone(v: Vec3d): Vec3d {
  return { x: v.x, y: v.y, z: v.z };
}

export function add(a: Vec3d, b: Vec3d, out: Vec3d = vec3d()): Vec3d {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(a: Vec3d, b: Vec3d, out: Vec3d = vec3d()): Vec3d {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(v: Vec3d, s: number, out: Vec3d = vec3d()): Vec3d {
  out.x = v.x * s;
  out.y = v.y * s;
  out.z = v.z * s;
  return out;
}

export function dot(a: Vec3d, b: Vec3d): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3d, b: Vec3d, out: Vec3d = vec3d()): Vec3d {
  // `out` `a` yoki `b` bilan bir xil obyekt bo'lishi mumkin — avval hisoblab olamiz.
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function length(v: Vec3d): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distance(a: Vec3d, b: Vec3d): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function normalize(v: Vec3d, out: Vec3d = vec3d()): Vec3d {
  const len = length(v);
  if (len === 0) {
    out.x = out.y = out.z = 0;
    return out;
  }
  return scale(v, 1 / len, out);
}

/** Yangi birlik matritsa. */
export function mat4d(): Mat4d {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * Nuqtani matritsa bilan almashtirish (w=1 deb, affin).
 * `m` column-major, ya'ni m[12..14] — translatsiya.
 */
export function transformPoint(m: Mat4d, v: Vec3d, out: Vec3d = vec3d()): Vec3d {
  const { x, y, z } = v;
  out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** Yo'nalishni almashtirish (translatsiyasiz, w=0). */
export function transformDirection(m: Mat4d, v: Vec3d, out: Vec3d = vec3d()): Vec3d {
  const { x, y, z } = v;
  out.x = m[0] * x + m[4] * y + m[8] * z;
  out.y = m[1] * x + m[5] * y + m[9] * z;
  out.z = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

/**
 * Qattiq (rigid) almashtirishning teskarisi: R⁻¹ = Rᵀ, t⁻¹ = -Rᵀ·t.
 * Faqat aylanish + translatsiyadan iborat matritsalar uchun (bizda hammasi shunday),
 * to'liq inversiyadan ancha tez va aniqroq.
 */
export function invertRigid(m: Mat4d, out: Mat4d = mat4d()): Mat4d {
  // Aylanish qismini transponirlash.
  const r00 = m[0], r01 = m[4], r02 = m[8];
  const r10 = m[1], r11 = m[5], r12 = m[9];
  const r20 = m[2], r21 = m[6], r22 = m[10];
  const tx = m[12], ty = m[13], tz = m[14];

  out[0] = r00; out[4] = r10; out[8] = r20;
  out[1] = r01; out[5] = r11; out[9] = r21;
  out[2] = r02; out[6] = r12; out[10] = r22;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;

  // -Rᵀ·t
  out[12] = -(r00 * tx + r10 * ty + r20 * tz);
  out[13] = -(r01 * tx + r11 * ty + r21 * tz);
  out[14] = -(r02 * tx + r12 * ty + r22 * tz);
  return out;
}
