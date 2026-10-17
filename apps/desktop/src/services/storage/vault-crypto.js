/**
 * Cifrado Único Independiente por Secreto y Administración de Contraseña — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/services/storage/vault-crypto.js
 */
import { ADMIN_PASSWORD_STORAGE_KEY, ENCRYPTED_PREFIX } from "./constants.js";

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomBytes(len) {
  const buf = new Uint8Array(len);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return buf;
}

function deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIndex) {
  const seedStr = `${uniqueKeyHex}|${saltHex}|${ivHex}|${blockIndex}|ELTRANSPORTADOR_UNIQUE_SECRET_CIPHER_V1`;
  const state = new Uint32Array(8);
  state[0] = 0x6a09e667;
  state[1] = 0xbb67ae85;
  state[2] = 0x3c6ef372;
  state[3] = 0xa54ff53a;
  state[4] = 0x510e527f;
  state[5] = 0x9b05688c;
  state[6] = 0x1f83d9ab;
  state[7] = 0x5be0cd19;

  for (let i = 0; i < seedStr.length; i++) {
    const code = seedStr.charCodeAt(i);
    const idx = i & 7;
    state[idx] = Math.imul(state[idx] ^ code, 0x01000193) >>> 0;
    state[(idx + 3) & 7] = (state[(idx + 3) & 7] + ((state[idx] << 13) | (state[idx] >>> 19))) >>> 0;
  }

  for (let round = 0; round < 512; round++) {
    for (let j = 0; j < 8; j++) {
      const a = state[j];
      const b = state[(j + 1) & 7];
      const c = (a + b + round) >>> 0;
      state[j] = ((c << 7) | (c >>> 25)) ^ state[(j + 4) & 7];
    }
  }

  const out = new Uint8Array(32);
  for (let j = 0; j < 8; j++) {
    const v = state[j];
    out[j * 4] = v & 0xff;
    out[j * 4 + 1] = (v >>> 8) & 0xff;
    out[j * 4 + 2] = (v >>> 16) & 0xff;
    out[j * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

function computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes) {
  const macKey = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, 0xffffffff);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) tag[i] = macKey[i];
  for (let i = 0; i < cipherBytes.length; i++) {
    const idx = i & 15;
    tag[idx] = (tag[idx] ^ cipherBytes[i] ^ macKey[(i + 16) & 31]) & 0xff;
    tag[(idx + 5) & 15] = (tag[(idx + 5) & 15] + tag[idx] + (i & 0xff)) & 0xff;
  }
  return bytesToHex(tag);
}

/**
 * Cifra un secreto generando una llave aleatoria de 256 bits, sal de 128 bits e IV de 96 bits
 * exclusivos y únicos para ese secreto individual (sin usar la contraseña de administración).
 */
export function encryptSecretValue(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === "") return "";
  const str = String(plaintext);
  if (str.startsWith(ENCRYPTED_PREFIX)) return str;

  const uniqueKeyHex = bytesToHex(randomBytes(32));
  const saltHex = bytesToHex(randomBytes(16));
  const ivHex = bytesToHex(randomBytes(12));

  const utf8Bytes = new TextEncoder().encode(str);
  const cipherBytes = new Uint8Array(utf8Bytes.length);

  let blockIdx = 1;
  let streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
  let offsetInBlock = 0;

  for (let i = 0; i < utf8Bytes.length; i++) {
    if (offsetInBlock >= 32) {
      blockIdx++;
      streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
      offsetInBlock = 0;
    }
    cipherBytes[i] = utf8Bytes[i] ^ streamBlock[offsetInBlock];
    offsetInBlock++;
  }

  const tagHex = computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes);
  return `${ENCRYPTED_PREFIX}${uniqueKeyHex}:${saltHex}:${ivHex}:${tagHex}:${bytesToHex(cipherBytes)}`;
}

/**
 * Descifra en memoria un valor cifrado con `encryptSecretValue` verificando primero su etiqueta de integridad MAC.
 */
export function decryptSecretValue(encoded) {
  if (!encoded || typeof encoded !== "string") return "";
  if (!encoded.startsWith(ENCRYPTED_PREFIX)) return encoded;
  const rest = encoded.slice(ENCRYPTED_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 5) return "";
  const [uniqueKeyHex, saltHex, ivHex, tagHex, cipherHex] = parts;
  const cipherBytes = hexToBytes(cipherHex);
  const expectedTag = computeAuthTagHex(uniqueKeyHex, saltHex, ivHex, cipherBytes);
  if (expectedTag !== tagHex) {
    return "";
  }

  const plainBytes = new Uint8Array(cipherBytes.length);
  let blockIdx = 1;
  let streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
  let offsetInBlock = 0;

  for (let i = 0; i < cipherBytes.length; i++) {
    if (offsetInBlock >= 32) {
      blockIdx++;
      streamBlock = deriveKeystreamBlock(uniqueKeyHex, saltHex, ivHex, blockIdx);
      offsetInBlock = 0;
    }
    plainBytes[i] = cipherBytes[i] ^ streamBlock[offsetInBlock];
    offsetInBlock++;
  }

  return new TextDecoder().decode(plainBytes);
}

function computeAdminPasswordHash(password, saltHex) {
  const block1 = deriveKeystreamBlock(String(password), saltHex, "ADMIN_PWD_VERIFY_1", 1001);
  const block2 = deriveKeystreamBlock(String(password), saltHex, "ADMIN_PWD_VERIFY_2", 2002);
  return bytesToHex(block1) + bytesToHex(block2);
}

function constantTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function hasAdminPasswordConfigured() {
  try {
    const raw = localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.saltHex && parsed.hashHex);
  } catch {
    return false;
  }
}

export function verifyAdminPassword(candidatePassword) {
  if (!candidatePassword || typeof candidatePassword !== "string") return false;
  try {
    const raw = localStorage.getItem(ADMIN_PASSWORD_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.saltHex || !parsed.hashHex) return false;
    const candidateHash = computeAdminPasswordHash(candidatePassword, parsed.saltHex);
    return constantTimeEquals(candidateHash, parsed.hashHex);
  } catch {
    return false;
  }
}

export function setInitialAdminPasswordWithPersist(newPassword, state, persistFn) {
  const clean = String(newPassword || "").trim();
  if (clean.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(clean, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state && typeof persistFn === "function") {
    persistFn(state);
  }
  return { ok: true };
}

export function changeAdminPasswordWithPersist(oldPassword, newPassword, state, persistFn) {
  if (!verifyAdminPassword(oldPassword)) {
    return { ok: false, reason: "WRONG_OLD_PASSWORD" };
  }
  const cleanNew = String(newPassword || "").trim();
  if (cleanNew.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(cleanNew, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state && typeof persistFn === "function") {
    persistFn(state);
  }
  return { ok: true };
}

export function resetForgottenAdminPasswordWithPersist(newPassword, state, persistFn) {
  const cleanNew = String(newPassword || "").trim();
  if (cleanNew.length < 4) {
    return { ok: false, reason: "TOO_SHORT" };
  }
  const saltHex = bytesToHex(randomBytes(16));
  const hashHex = computeAdminPasswordHash(cleanNew, saltHex);
  try {
    localStorage.setItem(
      ADMIN_PASSWORD_STORAGE_KEY,
      JSON.stringify({
        saltHex,
        hashHex,
        updatedAt: new Date().toISOString()
      })
    );
  } catch {}
  if (state) {
    state.secretVault = {};
    state.secretCiphersByKey = {};
    if (typeof persistFn === "function") {
      persistFn(state);
    }
  }
  return { ok: true };
}

export function encryptRequestSensitiveFields(req) {
  const copy = JSON.parse(JSON.stringify(req));
  if (Array.isArray(copy.headers)) {
    for (const h of copy.headers) {
      if (h && h.isSecret && h.value && !String(h.value).startsWith("${secret:")) {
        h.value = encryptSecretValue(h.value);
      }
    }
  }
  if (Array.isArray(copy.params)) {
    for (const p of copy.params) {
      if (p && p.isSecret && p.value && !String(p.value).startsWith("${secret:")) {
        p.value = encryptSecretValue(p.value);
      }
    }
  }
  if (copy.auth && typeof copy.auth === "object") {
    if (copy.auth.bearerToken && !String(copy.auth.bearerToken).startsWith("${secret:")) {
      copy.auth.bearerToken = encryptSecretValue(copy.auth.bearerToken);
    }
    if (copy.auth.basicPassword && !String(copy.auth.basicPassword).startsWith("${secret:")) {
      copy.auth.basicPassword = encryptSecretValue(copy.auth.basicPassword);
    }
    if (copy.auth.apiKeyValue && !String(copy.auth.apiKeyValue).startsWith("${secret:")) {
      copy.auth.apiKeyValue = encryptSecretValue(copy.auth.apiKeyValue);
    }
  }
  return copy;
}

export function decryptRequestSensitiveFields(req) {
  const copy = JSON.parse(JSON.stringify(req));
  if (Array.isArray(copy.headers)) {
    for (const h of copy.headers) {
      if (h && h.value && String(h.value).startsWith(ENCRYPTED_PREFIX)) {
        h.value = decryptSecretValue(h.value);
      }
    }
  }
  if (Array.isArray(copy.params)) {
    for (const p of copy.params) {
      if (p && p.value && String(p.value).startsWith(ENCRYPTED_PREFIX)) {
        p.value = decryptSecretValue(p.value);
      }
    }
  }
  if (copy.auth && typeof copy.auth === "object") {
    if (copy.auth.bearerToken && String(copy.auth.bearerToken).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.bearerToken = decryptSecretValue(copy.auth.bearerToken);
    }
    if (copy.auth.basicPassword && String(copy.auth.basicPassword).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.basicPassword = decryptSecretValue(copy.auth.basicPassword);
    }
    if (copy.auth.apiKeyValue && String(copy.auth.apiKeyValue).startsWith(ENCRYPTED_PREFIX)) {
      copy.auth.apiKeyValue = decryptSecretValue(copy.auth.apiKeyValue);
    }
  }
  return copy;
}
