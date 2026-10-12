/**
 * IA propia del usuario (BYOK): proveedores predefinidos y tipos de la API /api/ai-credentials.
 *
 * Las URL base de los proveedores estan verificadas contra su documentacion oficial (ver
 * .superpowers/sdd/2026-10-12-operaciones-panel-e-ia-propia-del-usuario/task-K3-report.md). Si un proveedor cambia de
 * dominio, se corrige AQUI y en ningun otro sitio: con un preset el servidor ignora cualquier URL que mande el cliente.
 * El modelo lo escribe el usuario: no hay modelos por defecto que caduquen.
 */

/** Proveedores con URL fija. `custom` (URL propia) solo existe con BYOK_ALLOW_CUSTOM_URLS=true. */
export const AI_PROVIDER_PRESET_IDS = [
  'openai',
  'openrouter',
  'groq',
  'mistral',
  'together',
] as const;
export type AiProviderPresetId = (typeof AI_PROVIDER_PRESET_IDS)[number];
export type AiCredentialPreset = AiProviderPresetId | 'custom';

export const AI_PROVIDER_PRESETS: Record<AiProviderPresetId, { label: string; baseUrl: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  // La documentacion oficial usa api.together.ai (api.together.xyz sigue respondiendo, pero ya no es la documentada)
  together: { label: 'Together AI', baseUrl: 'https://api.together.ai/v1' },
};

/** Limites de la gestion de credenciales (los usa el servidor y, para validar antes de enviar, la interfaz). */
export const AI_CREDENTIAL_MAX_PER_USER = 5;
export const AI_CREDENTIAL_LABEL_MAX = 40;
export const AI_CREDENTIAL_MODEL_MAX = 100;
/** Caracteres que puede llevar el nombre de un modelo (`gpt-4o`, `meta-llama/Llama-3.3-70B:free`, `openai/gpt-4o@v2`...). */
export const AI_CREDENTIAL_MODEL_PATTERN = /^[A-Za-z0-9._:/@+-]{1,100}$/;
/** Largo aceptado de una clave de API (solo para descartar basura; no se interpreta su formato). */
export const AI_CREDENTIAL_KEY_MIN = 8;
export const AI_CREDENTIAL_KEY_MAX = 512;

/** Ultimo fallo conocido de la credencial: el proveedor la rechazo, o no se pudo contactar. */
export type AiCredentialError = 'rejected' | 'unreachable';

/** Lo unico que la API devuelve de una credencial: nunca la clave ni su texto cifrado. */
export interface AiCredentialMeta {
  id: string;
  label: string;
  preset: AiCredentialPreset;
  model: string;
  last4: string;
  createdAt: string;
  lastUsedAt?: string;
  lastError?: AiCredentialError;
}

/** GET /api/ai-credentials/config */
export interface AiCredentialsConfig {
  enabled: boolean;
  allowCustom: boolean;
  presets: Record<AiProviderPresetId, { label: string; baseUrl: string }>;
}

/** POST /api/ai-credentials. `baseUrl` solo cuenta con `preset: 'custom'`. */
export interface CreateAiCredentialRequest {
  label: string;
  preset: AiCredentialPreset;
  baseUrl?: string;
  model: string;
  apiKey: string;
}

/** PATCH /api/ai-credentials/:id */
export interface UpdateAiCredentialRequest {
  label?: string;
  model?: string;
  apiKey?: string;
}
