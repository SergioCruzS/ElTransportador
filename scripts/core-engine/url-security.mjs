/**
 * Validador de Seguridad de URLs, Esquemas y Anti-SSRF — ElTransportador v1.0.1
 * Archivo: scripts/core-engine/url-security.mjs
 */
import { URL } from "node:url";

export class UrlSecurityValidator {
  static validateRequestUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: 'La URL de la solicitud no puede estar vacía.',
          recoverable: true,
        },
      };
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: `URL malformada: ${trimmed}`,
          details: err.message,
          recoverable: true,
        },
      };
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        ok: false,
        error: {
          code: 'BLOCKED_SCHEME',
          message: `Esquema de protocolo bloqueado por seguridad (${protocol}). Solo se permite http: y https:.`,
          details: `Protocolo rechazado: ${protocol}`,
          recoverable: true,
        },
      };
    }
    if (!parsed.hostname) {
      return {
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: 'La URL no contiene un nombre de host válido.',
          recoverable: true,
        },
      };
    }
    return { ok: true, url: parsed };
  }

  static isSameOrigin(urlA, urlB) {
    const portA = urlA.port || (urlA.protocol === 'https:' ? '443' : '80');
    const portB = urlB.port || (urlB.protocol === 'https:' ? '443' : '80');
    return (
      urlA.protocol.toLowerCase() === urlB.protocol.toLowerCase() &&
      urlA.hostname.toLowerCase() === urlB.hostname.toLowerCase() &&
      portA === portB
    );
  }

  static isPrivateOrMetadataHost(hostname) {
    const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (
      h === 'localhost' ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h === 'metadata.google.internal' ||
      h === '::1' ||
      h === '0.0.0.0'
    ) {
      return true;
    }
    const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [_, a, b] = ipv4Match.map(Number);
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }
    return false;
  }

  static validateRedirect(fromUrl, toUrl, allowPrivateNetworkRedirects = false) {
    const check = UrlSecurityValidator.validateRequestUrl(toUrl.toString());
    if (!check.ok) return check;

    const fromPrivate = UrlSecurityValidator.isPrivateOrMetadataHost(fromUrl.hostname);
    const toPrivate = UrlSecurityValidator.isPrivateOrMetadataHost(toUrl.hostname);

    const isCloudMetadata =
      toUrl.hostname === '169.254.169.254' || toUrl.hostname === 'metadata.google.internal';
    if (!allowPrivateNetworkRedirects && (isCloudMetadata || (!fromPrivate && toPrivate))) {
      return {
        ok: false,
        error: {
          code: 'SSRF_REDIRECT_BLOCKED',
          message: `Redirección bloqueada por protección anti-SSRF hacia destino interno o metadata (${toUrl.hostname}).`,
          details: `Origen: ${fromUrl.origin} -> Destino bloqueado: ${toUrl.href}`,
          recoverable: true,
        },
      };
    }

    const crossOrigin = !UrlSecurityValidator.isSameOrigin(fromUrl, toUrl);
    return {
      ok: true,
      crossOrigin,
      strippedHeaders: crossOrigin
        ? ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']
        : [],
    };
  }
}

