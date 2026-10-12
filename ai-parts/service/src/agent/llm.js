// Клиент Claude. В тестах подменяется через setClientFactory().
import Anthropic from '@anthropic-ai/sdk';
import { getIntegration } from '../integrations.js';

let factory = (apiKey) => new Anthropic({ apiKey, maxRetries: 3, timeout: 10 * 60 * 1000 });

export function setClientFactory(f) {
  factory = f;
}

export function llmFor(workshopId) {
  const it = getIntegration(workshopId, 'anthropic');
  if (!it.values.api_key) throw new Error('Не задан API key Claude в разделе «Интеграции»');
  return { client: factory(it.values.api_key), model: it.values.model || 'claude-sonnet-5-5' };
}
