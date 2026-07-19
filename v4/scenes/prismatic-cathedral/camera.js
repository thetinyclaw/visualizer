export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}

export function lookAt(out, eye, center, up) {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zl; const z1 = zy / zl; const z2 = zz / zl;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  const xl = Math.hypot(x0, x1, x2) || 1;
  x0 /= xl; x1 /= xl; x2 /= xl;
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

export function multiplyMat4(out, a, b) {
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function cathedralCamera(out, time, audio = {}) {
  const bands = audio.bands || audio.envelopedBands || [];
  const flux = audio.positiveSpectralFlux || 0;
  const onset = audio.onsetImpulse || 0;
  out[0] = Math.sin(time * 0.18) * (0.36 + (bands[8] || 0) * 0.22) + Math.sin(time * 0.71) * flux * 0.22;
  out[1] = 0.70 + (bands[5] || 0) * 0.20 + onset * 0.08;
  out[2] = 4.85 + Math.cos(time * 0.11) * 0.22 - flux * 0.18;
  return out;
}

export function cathedralMvp(out, { width = 1, height = 1, time = 0, audio = null } = {}) {
  const aspect = Math.max(0.1, width / Math.max(1, height));
  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const eye = cathedralCamera(new Float32Array(3), time, audio || {});
  perspective(proj, 50 * Math.PI / 180, aspect, 0.05, 80);
  lookAt(view, eye, new Float32Array([0, 0.10, -1.55]), new Float32Array([0, 1, 0]));
  return multiplyMat4(out, proj, view);
}
