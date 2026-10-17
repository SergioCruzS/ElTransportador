/**
 * Servicio de Importación OpenAPI 3.0 y Exportación cURL Redactada — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/import-export.mjs
 */
import crypto from "node:crypto";
import { CURRENT_SCHEMA_VERSION, SCHEMA_URI, REDACTED_PLACEHOLDER } from "./constants.mjs";
import { SecretRedactor } from "./secret-vault.mjs";
import { CollectionStorage } from "./collection-storage.mjs";

export class ImportExportService {
  static importData(rawJsonString) {
    if (typeof rawJsonString !== 'string' || rawJsonString.length > 5 * 1024 * 1024) {
      throw new Error('El archivo de importación excede el tamaño máximo permitido (5 MB) o es inválido.');
    }
    const parsed = JSON.parse(rawJsonString);

    if (parsed.kind === 'eltransportador.collection') {
      const discarded = [];
      for (const req of parsed.requests || []) {
        if (req.script || req.preRequestScript || req.postResponseScript) {
          delete req.script;
          delete req.preRequestScript;
          delete req.postResponseScript;
          discarded.push(`requests[${req.name}].scripts (bloqueado por política de seguridad)`);
        }
      }
      const validated = CollectionStorage.migrateAndValidate(parsed);
      return {
        sourceFormat: 'eltransportador.v1',
        collection: validated,
        preservedFields: ['metadata', 'defaults', 'variables', 'folders', 'requests', 'assertions'],
        transformedFields: parsed.schemaVersion === 0 ? ['schemaVersion (0 -> 1)'] : [],
        discardedFields: discarded,
        warnings: discarded.length > 0 ? ['Se descartaron scripts importados por seguridad.'] : [],
      };
    }

    if (typeof parsed.openapi === 'string' && parsed.openapi.startsWith('3.')) {
      const baseUrl =
        Array.isArray(parsed.servers) && parsed.servers[0]?.url
          ? parsed.servers[0].url
          : 'http://localhost:8080';
      const requests = [];
      const discardedFields = [];

      for (const k of Object.keys(parsed)) {
        if (k.startsWith('x-')) {
          discardedFields.push(k);
        }
      }

      for (const [routePath, pathItem] of Object.entries(parsed.paths || {})) {
        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
          if (!pathItem[method]) continue;
          const op = pathItem[method];
          const params = [];
          for (const p of op.parameters || []) {
            if (p.in === 'query') {
              params.push({
                id: `prm_${crypto.randomUUID().slice(0, 8)}`,
                key: p.name,
                value: p.schema?.default !== undefined ? String(p.schema.default) : '',
                description: p.description || '',
                enabled: true,
              });
            }
          }
          let body = { mode: 'none' };
          const jsonExample = op.requestBody?.content?.['application/json']?.example;
          if (jsonExample !== undefined) {
            body = {
              mode: 'json',
              raw: JSON.stringify(jsonExample, null, 2),
            };
          }

          requests.push({
            id: `req_${op.operationId || crypto.randomUUID().slice(0, 8)}`,
            name: op.summary || `${method.toUpperCase()} ${routePath}`,
            folderId: null,
            method: method.toUpperCase(),
            url: `\${base_url}${routePath}`,
            params,
            headers: [
              { id: 'hdr_accept', key: 'Accept', value: 'application/json', enabled: true },
            ],
            auth: { type: 'none' },
            body,
            settings: {
              timeoutMs: 10000,
              followRedirects: true,
              maxRedirects: 5,
              verifyTls: true,
              maxResponseBytes: 5242880,
            },
            assertions: [
              {
                id: `ast_${crypto.randomUUID().slice(0, 8)}`,
                enabled: true,
                target: 'status',
                operator: 'less_than',
                expected: '400',
              },
            ],
            extractions: [],
          });
        }
      }

      const collection = CollectionStorage.migrateAndValidate({
        $schema: SCHEMA_URI,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        kind: 'eltransportador.collection',
        metadata: {
          id: `col_${crypto.randomUUID().slice(0, 8)}`,
          name: parsed.info?.title || 'Colección OpenAPI Importada',
          description: parsed.info?.description || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appVersion: '1.0.0',
        },
        defaults: {
          timeoutMs: 10000,
          followRedirects: true,
          maxRedirects: 5,
          verifyTls: true,
          headers: [],
        },
        variables: [{ key: 'base_url', value: baseUrl, enabled: true, isSecret: false }],
        folders: [],
        requests,
      });

      return {
        sourceFormat: 'openapi.v3',
        collection,
        preservedFields: [
          'info.title',
          'info.description',
          'servers[0].url',
          'paths.*',
          'parameters(query)',
          'requestBody.example',
        ],
        transformedFields: ['servers[0].url -> variables.base_url', 'paths -> requests[]'],
        discardedFields,
        warnings: discardedFields.length
          ? [`Se ignoraron extensiones propietarias no auditadas: ${discardedFields.join(', ')}`]
          : [],
      };
    }

    throw new Error(
      'Formato de importación no reconocido. Se soporta eltransportador.collection/v1 y OpenAPI 3.x.'
    );
  }

  static exportToCurl(requestSpec, redactSecrets = true) {
    const redactor = new SecretRedactor();
    const method = String(requestSpec.method || 'GET').toUpperCase();
    let urlStr = requestSpec.url || 'http://localhost';
    if (redactSecrets) urlStr = redactor.redactText(urlStr);

    const lines = [`curl -X ${method} '${urlStr.replace(/'/g, "'\\''")}'`];

    for (const h of requestSpec.headers || []) {
      if (!h || !h.enabled || !h.key) continue;
      const val =
        redactSecrets && (h.isSecret || SecretRedactor.isSensitiveHeaderName(h.key))
          ? REDACTED_PLACEHOLDER
          : h.value || '';
      lines.push(`  -H '${h.key}: ${val}'`);
    }

    if (requestSpec.auth?.type === 'bearer' && requestSpec.auth.bearerToken) {
      const tok = redactSecrets ? REDACTED_PLACEHOLDER : requestSpec.auth.bearerToken;
      lines.push(`  -H 'Authorization: Bearer ${tok}'`);
    }

    if (requestSpec.body?.mode === 'json' && requestSpec.body.raw) {
      const bodyText = redactSecrets ? redactor.redactText(requestSpec.body.raw) : requestSpec.body.raw;
      lines.push(`  -H 'Content-Type: application/json'`);
      lines.push(`  --data-raw '${bodyText.replace(/'/g, "'\\''")}'`);
    }

    return lines.join(' \\\n');
  }
}

