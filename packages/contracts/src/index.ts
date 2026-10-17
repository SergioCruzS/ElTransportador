/**
 * @eltransportador/contracts
 * Contratos explícitos y tipados entre el frontend React, el backend Tauri/Rust y la CLI.
 * Identificador de aplicación: com.eltransportador.desktop
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValueItem {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  isSecret?: boolean;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface AuthConfig {
  type: AuthType;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: 'header' | 'query';
}

export type BodyMode = 'none' | 'json' | 'text' | 'urlencoded' | 'multipart';

export interface MultipartField {
  id: string;
  key: string;
  value: string;
  contentType?: string;
  enabled: boolean;
}

export interface RequestBodySpec {
  mode: BodyMode;
  raw?: string;
  urlencoded?: KeyValueItem[];
  multipart?: MultipartField[];
}

export interface RequestExecutionSettings {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  verifyTls: boolean;
  maxResponseBytes: number;
  proxyUrl?: string;
  allowPrivateNetworkRedirects?: boolean;
}

export type AssertionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'less_than'
  | 'greater_than'
  | 'is_type';

export type AssertionTarget =
  | 'status'
  | 'header'
  | 'json_path'
  | 'body_text'
  | 'duration_ms';

export interface AssertionRule {
  id: string;
  enabled: boolean;
  target: AssertionTarget;
  property?: string; // Nombre de header o ruta JSON (ej. "data.user.id")
  operator: AssertionOperator;
  expected: string;
}

export interface VariableExtractionRule {
  id: string;
  enabled: boolean;
  variableName: string;
  source: 'json_path' | 'header' | 'status';
  path: string;
}

export interface HttpRequestSpec {
  id: string;
  name: string;
  folderId?: string | null;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  auth: AuthConfig;
  body: RequestBodySpec;
  settings: RequestExecutionSettings;
  assertions: AssertionRule[];
  extractions?: VariableExtractionRule[];
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RedirectHop {
  hop: number;
  fromUrl: string;
  toUrl: string;
  status: number;
  crossOrigin: boolean;
  strippedHeaders: string[];
}

export interface CookieInfo {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

export interface AssertionResult {
  ruleId: string;
  passed: boolean;
  target: AssertionTarget;
  property?: string;
  operator: AssertionOperator;
  expected: string;
  actual: string;
  message: string;
}

export interface HttpResponseData {
  requestId: string;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  cookies: CookieInfo[];
  body: string;
  isJson: boolean;
  truncated: boolean;
  redirects: RedirectHop[];
  unresolvedVariables: string[];
  assertionResults: AssertionResult[];
  extractedVariables: Record<string, string>;
  timestamp: string;
  error?: StructuredError | null;
}

export interface StructuredError {
  code:
    | 'INVALID_URL'
    | 'BLOCKED_SCHEME'
    | 'SSRF_REDIRECT_BLOCKED'
    | 'MAX_REDIRECTS_EXCEEDED'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'TLS_ERROR'
    | 'NETWORK_ERROR'
    | 'RESPONSE_TOO_LARGE'
    | 'STORAGE_ERROR'
    | 'VALIDATION_ERROR';
  message: string;
  details?: string;
  recoverable: boolean;
}

export interface CollectionFolder {
  id: string;
  name: string;
  parentId?: string | null;
  description?: string;
}

export interface CollectionVariable {
  key: string;
  value: string;
  enabled: boolean;
  isSecret: boolean;
  secretRef?: string;
}

export interface CollectionFile {
  $schema: string;
  schemaVersion: number;
  kind: 'eltransportador.collection';
  metadata: {
    id: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    appVersion: string;
  };
  defaults: {
    timeoutMs: number;
    followRedirects: boolean;
    maxRedirects: number;
    verifyTls: boolean;
    headers: KeyValueItem[];
  };
  variables: CollectionVariable[];
  folders: CollectionFolder[];
  requests: HttpRequestSpec[];
}

export interface EnvironmentProfile {
  id: string;
  name: string;
  isActive: boolean;
  variables: CollectionVariable[];
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  requestId: string;
  method: HttpMethod;
  url: string; // Con secretos redactados
  status: number;
  durationMs: number;
  sizeBytes: number;
  timestamp: string;
  requestSnapshot: HttpRequestSpec; // Con credenciales redactadas
}

export interface AppSettings {
  theme: 'dark' | 'light';
  language: 'es' | 'en';
  defaultTimeoutMs: number;
  maxRedirects: number;
  verifyTlsByDefault: boolean;
  maxHistoryEntries: number;
  historyRetentionDays: number;
  maxResponseSizeBytes: number;
  proxyUrl: string;
  redactSecretsInLogs: boolean;
  blockCrossZoneRedirects: boolean;
}

export interface ImportReport {
  sourceFormat: 'eltransportador.v1' | 'openapi.v3';
  collection: CollectionFile;
  preservedFields: string[];
  transformedFields: string[];
  discardedFields: string[];
  warnings: string[];
}
