import crypto from 'crypto';

export function createApiKey(): string {
  return `rf_${crypto.randomBytes(32).toString('hex')}`;
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export function getApiKeyPreview(apiKey: string): string {
  if (apiKey.length <= 10) return apiKey;
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}
