/*!
 * decoder.js — pure, parameterised unsealing of MESH VAULT containers.
 *
 * No secrets live here. The method parameters are injected by unseal.js.
 * Byte-identical with canon/tools/vaultkit.py; if you change one, change both.
 * Needs `crypto.subtle` and `TextEncoder` (every browser, Node 18+).
 */

function fnv1a(s) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

function xs(x) {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function keystream(seed, n) {
  let x = seed;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x = xs(x);
    out[i] = x & 0xff;
  }
  return out;
}

function perm(seed, block) {
  let x = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const p = Array.from({ length: block }, (_, i) => i);
  for (let i = block - 1; i > 0; i--) {
    x = xs(x);
    const j = x % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

function unpermute(data, p) {
  const b = p.length;
  const out = new Uint8Array(data);
  for (let s = 0; s + b <= data.length; s += b) {
    for (let i = 0; i < b; i++) out[s + p[i]] = data[s + i];
  }
  return out;
}

function unb64custom(text, alphabet) {
  const lut = new Map();
  for (let i = 0; i < 64; i++) lut.set(alphabet[i], i);
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of text) {
    const v = lut.get(ch);
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Split a container into its header fields and its body text. */
export function parseContainer(container) {
  const idx = container.indexOf("\n\n");
  const head = container.slice(0, idx);
  const rest = container.slice(idx + 2);
  const meta = {};
  for (const line of head.split("\n")) {
    const c = line.indexOf(":");
    if (c > 0) meta[line.slice(0, c).trim()] = line.slice(c + 1).trim();
  }
  const body = rest.split("-----END MESH VAULT-----")[0].replace(/\n/g, "");
  return { meta: { v: meta.v, id: meta.id, sha256: meta.sha256, len: Number(meta.len) }, body };
}

// `crypto.subtle` only exists in a secure context (https, localhost). A phone
// on a LAN address or a file:// page has none, and without this fallback the
// vault would fail its integrity check there and the story would go silent.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 in plain JS, for engines without `crypto.subtle`. */
export function sha256hexSync(bytes) {
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  padded[padded.length - 4] = (bits >>> 24) & 0xff;
  padded[padded.length - 3] = (bits >>> 16) & 0xff;
  padded[padded.length - 2] = (bits >>> 8) & 0xff;
  padded[padded.length - 1] = bits & 0xff;
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}

async function sha256hex(data) {
  const subtle = typeof crypto !== "undefined" && crypto.subtle;
  if (!subtle) return sha256hexSync(data);
  const d = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Decode a sealed container into plaintext. Throws on integrity failure.
 * @param {string} container
 * @param {{salt:string, block:number, alphabet:string, wrap:number}} m
 */
export async function decode(container, m) {
  const { meta, body } = parseContainer(container);
  const seed = fnv1a(meta.id + "\x1f" + m.salt);
  const p = perm(seed, m.block);
  const enc = unb64custom(body, m.alphabet);
  const ks = keystream(seed, enc.length);
  const xored = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) xored[i] = enc[i] ^ ks[i];
  const raw = unpermute(xored, p);
  if (meta.sha256 && (await sha256hex(raw)) !== meta.sha256) {
    throw new Error("vault integrity check failed: " + meta.id);
  }
  return new TextDecoder().decode(raw);
}
