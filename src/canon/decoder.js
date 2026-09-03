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

async function sha256hex(data) {
  const d = await crypto.subtle.digest("SHA-256", data);
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
