/**
 * Persistencia Atómica de Colecciones (.etp.json) con Respaldo .bak — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/collection-storage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION, SCHEMA_URI } from "./constants.mjs";

export class CollectionStorage {
  constructor(collectionsDir) {
    this.collectionsDir = collectionsDir;
    fs.mkdirSync(this.collectionsDir, { recursive: true });
  }

  static sanitizeFileName(name) {
    const raw = String(name || '').trim();
    if (!raw || raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
      throw new Error('Ruta o nombre de archivo no permitido por política de aislamiento de filesystem.');
    }
    return raw.endsWith('.etp.json') ? raw : `${raw}.etp.json`;
  }

  static migrateAndValidate(rawObj) {
    if (!rawObj || typeof rawObj !== 'object') {
      throw new Error('El contenido de la colección no es un objeto JSON válido.');
    }
    const migrated = JSON.parse(JSON.stringify(rawObj));

    if (!migrated.schemaVersion || migrated.schemaVersion === 0) {
      migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
      migrated.$schema = SCHEMA_URI;
      migrated.kind = 'eltransportador.collection';
      migrated.defaults = migrated.defaults || {
        timeoutMs: 10000,
        followRedirects: true,
        maxRedirects: 5,
        verifyTls: true,
        headers: [],
      };
    }

    if (migrated.kind !== 'eltransportador.collection') {
      throw new Error(`Tipo de documento inválido: '${migrated.kind}'. Se esperaba 'eltransportador.collection'.`);
    }
    if (migrated.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Versión de esquema (${migrated.schemaVersion}) no soportada por esta versión (máx v${CURRENT_SCHEMA_VERSION}).`
      );
    }
    if (!migrated.metadata || !migrated.metadata.id || !migrated.metadata.name) {
      throw new Error('La colección carece de metadatos obligatorios (metadata.id, metadata.name).');
    }

    migrated.variables = Array.isArray(migrated.variables) ? migrated.variables : [];
    migrated.folders = Array.isArray(migrated.folders) ? migrated.folders : [];
    migrated.requests = Array.isArray(migrated.requests) ? migrated.requests : [];

    for (const v of migrated.variables) {
      if (v.isSecret) {
        v.secretRef = v.secretRef || v.key;
        v.value = '';
      }
    }

    return migrated;
  }

  saveCollection(fileName, collectionObj) {
    const safeName = CollectionStorage.sanitizeFileName(fileName);
    const validated = CollectionStorage.migrateAndValidate(collectionObj);
    validated.metadata.updatedAt = new Date().toISOString();

    const fullPath = path.join(this.collectionsDir, safeName);
    const tmpPath = `${fullPath}.tmp.${process.pid}`;
    const bakPath = `${fullPath}.bak`;

    const serialized = JSON.stringify(validated, null, 2) + '\n';
    const fd = fs.openSync(tmpPath, 'w', 0o644);
    fs.writeFileSync(fd, serialized, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    if (fs.existsSync(fullPath)) {
      fs.copyFileSync(fullPath, bakPath);
    }
    fs.renameSync(tmpPath, fullPath);
    return { path: fullPath, collection: validated };
  }

  loadCollection(fileName) {
    const safeName = CollectionStorage.sanitizeFileName(fileName);
    const fullPath = path.join(this.collectionsDir, safeName);
    const bakPath = `${fullPath}.bak`;

    const tryParse = (target) => {
      const content = fs.readFileSync(target, 'utf-8');
      const obj = JSON.parse(content);
      return CollectionStorage.migrateAndValidate(obj);
    };

    try {
      return { recoveredFromBackup: false, collection: tryParse(fullPath) };
    } catch (primaryErr) {
      if (fs.existsSync(bakPath)) {
        return { recoveredFromBackup: true, collection: tryParse(bakPath) };
      }
      throw primaryErr;
    }
  }

  listCollections() {
    if (!fs.existsSync(this.collectionsDir)) return [];
    const files = fs
      .readdirSync(this.collectionsDir)
      .filter((f) => f.endsWith('.etp.json') && !f.includes('.tmp.'));
    const results = [];
    for (const f of files) {
      try {
        const loaded = this.loadCollection(f);
        results.push({ fileName: f, ...loaded });
      } catch {
        // Ignorar archivos corruptos sin respaldo válido en el listado general
      }
    }
    return results;
  }
}

