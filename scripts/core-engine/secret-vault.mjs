/**
 * Seguridad: Redactor de Credenciales y Bóveda Cifrada AES-256-GCM — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/secret-vault.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REDACTED_PLACEHOLDER } from "./constants.mjs";

export class SecretRedactor {
  constructor(knownSecrets = []) {
    this.knownSecrets = knownSecrets
      .filter((s) => typeof s === 'string' && s.trim().length >= 4)
      .sort((a, b) => b.length - a.length);
  }

  static isSensitiveHeaderName(name) {
    const lower = String(name || '').trim().toLowerCase();
    return [
      'authorization',
      'proxy-authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'api-key',
      'x-auth-token',
      'x-secret-key',
    ].includes(lower);
  }

  static isSensitiveParamName(name) {
    const lower = String(name || '').trim().toLowerCase();
    return (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('api_key') ||
      lower.includes('apikey')
    );
  }

  redactText(input) {
    if (typeof input !== 'string' || !input) return '';
    let out = input;
    for (const secret of this.knownSecrets) {
      if (secret && out.includes(secret)) {
        out = out.split(secret).join(REDACTED_PLACEHOLDER);
      }
    }
    out = out.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, `$1${REDACTED_PLACEHOLDER}`);
    out = out.replace(/(Basic\s+)[A-Za-z0-9+/]+=*/gi, `$1${REDACTED_PLACEHOLDER}`);
    out = out.replace(/(https?:\/\/[^/:@\s]+:)([^@\s]+)(@)/gi, `$1${REDACTED_PLACEHOLDER}$3`);
    return out;
  }

  sanitizeRequestForHistory(req) {
    const clone = JSON.parse(JSON.stringify(req));
    clone.url = this.redactText(clone.url || '');
    if (Array.isArray(clone.headers)) {
      clone.headers = clone.headers.map((h) => ({
        ...h,
        value:
          h.isSecret || SecretRedactor.isSensitiveHeaderName(h.key)
            ? REDACTED_PLACEHOLDER
            : this.redactText(h.value || ''),
      }));
    }
    if (Array.isArray(clone.params)) {
      clone.params = clone.params.map((p) => ({
        ...p,
        value:
          p.isSecret || SecretRedactor.isSensitiveParamName(p.key)
            ? REDACTED_PLACEHOLDER
            : this.redactText(p.value || ''),
      }));
    }
    if (clone.auth) {
      if (clone.auth.bearerToken) clone.auth.bearerToken = REDACTED_PLACEHOLDER;
      if (clone.auth.basicPassword) clone.auth.basicPassword = REDACTED_PLACEHOLDER;
      if (clone.auth.apiKeyValue) clone.auth.apiKeyValue = REDACTED_PLACEHOLDER;
    }
    if (clone.body && typeof clone.body.raw === 'string') {
      clone.body.raw = this.redactText(clone.body.raw);
    }
    return clone;
  }
}

// ---------------------------------------------------------------------------
// 2. Seguridad: Bóveda de Secretos Cifrada AES-256-GCM (`SecretVault`)
// ---------------------------------------------------------------------------
export class SecretVault {
  constructor(storageDir) {
    this.storageDir = storageDir;
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.vaultFile = path.join(this.storageDir, 'vault.enc.json');
    const machineSeed = process.env.ELTRANSPORTADOR_MASTER_KEY || 'eltransportador-local-os-key-v1';
    this.key = crypto.scryptSync(machineSeed, 'com.eltransportador.desktop.salt', 32);
    this.cache = new Map();
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.vaultFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.vaultFile, 'utf-8'));
      const iv = Buffer.from(raw.iv, 'base64');
      const tag = Buffer.from(raw.tag, 'base64');
      const encrypted = Buffer.from(raw.ciphertext, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
      const entries = JSON.parse(decrypted);
      for (const [k, v] of Object.entries(entries)) {
        this.cache.set(k, String(v));
      }
    } catch {
      this.cache.clear();
    }
  }

  _persist() {
    const plainObj = Object.fromEntries(this.cache.entries());
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(plainObj), 'utf-8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = {
      version: 1,
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    const tmpFile = `${this.vaultFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, this.vaultFile);
  }

  setSecret(key, value) {
    if (!key || typeof key !== 'string') throw new Error('Nombre de secreto inválido');
    this.cache.set(key.trim(), String(value));
    this._persist();
  }

  getSecret(key) {
    return this.cache.get(String(key || '').trim()) ?? null;
  }

  deleteSecret(key) {
    const existed = this.cache.delete(String(key || '').trim());
    this._persist();
    return existed;
  }

  listSecretKeys() {
    return Array.from(this.cache.keys());
  }

  getAllSecretValuesForRedaction() {
    return Array.from(this.cache.values());
  }
}

