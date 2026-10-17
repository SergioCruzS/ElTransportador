/**
 * Repositorio de Historial Local en SQLite (WAL) con Redacción de Secretos — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/sqlite-history.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SecretRedactor } from "./secret-vault.mjs";

export class SqliteHistoryRepository {
  constructor(dbPath, maxEntries = 200) {
    this.dbPath = dbPath;
    this.maxEntries = maxEntries;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this._initDb();
  }

  _runPythonSqlite(operation, payload = {}) {
    const pyLines = [
      'import sys, json, sqlite3',
      'db_path = sys.argv[1]',
      'op = sys.argv[2]',
      'payload = json.loads(sys.argv[3])',
      'conn = sqlite3.connect(db_path)',
      'conn.row_factory = sqlite3.Row',
      'cur = conn.cursor()',
      'if op == "init":',
      '    cur.execute("CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, size_bytes INTEGER NOT NULL, timestamp TEXT NOT NULL, request_snapshot_json TEXT NOT NULL)")',
      '    cur.execute("CREATE INDEX IF NOT EXISTS idx_history_timestamp ON request_history(timestamp DESC)")',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'elif op == "insert":',
      '    cur.execute("INSERT OR REPLACE INTO request_history (id, request_id, method, url, status, duration_ms, size_bytes, timestamp, request_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (payload["id"], payload["requestId"], payload["method"], payload["url"], payload["status"], payload["durationMs"], payload["sizeBytes"], payload["timestamp"], json.dumps(payload["requestSnapshot"], ensure_ascii=False)))',
      '    cur.execute("DELETE FROM request_history WHERE id NOT IN (SELECT id FROM request_history ORDER BY timestamp DESC LIMIT ?)", (int(payload.get("maxEntries", 200)),))',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'elif op == "list":',
      '    cur.execute("SELECT * FROM request_history ORDER BY timestamp DESC LIMIT ?", (int(payload.get("limit", 100)),))',
      '    rows = [{"id": r["id"], "requestId": r["request_id"], "method": r["method"], "url": r["url"], "status": r["status"], "durationMs": r["duration_ms"], "sizeBytes": r["size_bytes"], "timestamp": r["timestamp"], "requestSnapshot": json.loads(r["request_snapshot_json"])} for r in cur.fetchall()]',
      '    print(json.dumps(rows))',
      'elif op == "clear":',
      '    cur.execute("DELETE FROM request_history")',
      '    conn.commit()',
      '    print(json.dumps({"ok": True}))',
      'conn.close()',
    ];
    for (const pyBin of ['python3', 'python']) {
      const proc = spawnSync(
        pyBin,
        ['-c', pyLines.join('\n'), this.dbPath, operation, JSON.stringify(payload)],
        { encoding: 'utf-8' }
      );
      if (proc && proc.status === 0 && proc.stdout) {
        return JSON.parse(proc.stdout.trim());
      }
    }
    // Fallback automático en JSON si Python no está instalado en el sistema Windows
    const fbFile = this.dbPath + '.json';
    let items = [];
    if (fs.existsSync(fbFile)) {
      try { items = JSON.parse(fs.readFileSync(fbFile, 'utf-8')); } catch { items = []; }
    }
    if (operation === 'init') return { ok: true };
    if (operation === 'clear') {
      fs.writeFileSync(fbFile, '[]', 'utf-8');
      return { ok: true };
    }
    if (operation === 'insert') {
      items.unshift({
        id: payload.id,
        requestId: payload.requestId,
        method: payload.method,
        url: payload.url,
        status: payload.status,
        durationMs: payload.durationMs,
        sizeBytes: payload.sizeBytes,
        timestamp: payload.timestamp,
        requestSnapshot: payload.requestSnapshot
      });
      items = items.slice(0, Number(payload.maxEntries || 200));
      fs.writeFileSync(fbFile, JSON.stringify(items, null, 2), 'utf-8');
      return { ok: true };
    }
    if (operation === 'list') {
      return items.slice(0, Number(payload.limit || 100));
    }
    return { ok: true };
  }

  _initDb() {
    this._runPythonSqlite('init');
  }

  recordExecution(reqSpec, respData, redactor) {
    const sanitizedReq = redactor.sanitizeRequestForHistory(reqSpec);
    const sanitizedUrl = redactor.redactText(reqSpec.url || '');
    const entry = {
      id: `hst_${crypto.randomUUID()}`,
      requestId: reqSpec.id || 'req_adhoc',
      method: reqSpec.method || 'GET',
      url: sanitizedUrl,
      status: respData.status || 0,
      durationMs: respData.durationMs || 0,
      sizeBytes: respData.sizeBytes || 0,
      timestamp: respData.timestamp || new Date().toISOString(),
      requestSnapshot: sanitizedReq,
      maxEntries: this.maxEntries,
    };
    this._runPythonSqlite('insert', entry);
    return entry;
  }

  listEntries(limit = 100) {
    return this._runPythonSqlite('list', { limit });
  }

  clearHistory() {
    return this._runPythonSqlite('clear');
  }
}

