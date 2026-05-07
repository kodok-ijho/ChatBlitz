const DEFAULT_LLM_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingResponse {
  data?: Array<{
    embedding?: unknown;
    index?: number;
    object?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const apiKey = process.env.LLM_API_KEY;
  const embeddingConfig = resolveEmbeddingConfig();

  if (!apiKey) {
    throw new Error('Missing LLM_API_KEY environment variable');
  }

  const response = await fetch(embeddingConfig.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embeddingConfig.model,
      input: trimmedText,
      encoding_format: 'float',
      dimensions: embeddingConfig.dimensions,
    }),
  });

  const responseJson = await parseEmbeddingResponse(response);

  if (!response.ok) {
    throw new Error(responseJson.error?.message ?? `Embedding request failed with status ${response.status}`);
  }

  const embedding = responseJson.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === 'number')) {
    throw new Error('Embedding response did not contain a numeric vector');
  }

  if (embedding.length !== embeddingConfig.dimensions) {
    throw new Error(
      `Embedding vector dimension mismatch: expected ${embeddingConfig.dimensions}, got ${embedding.length}. ` +
        'Make sure EMBEDDING_MODEL and the knowledge_chunks.embedding vector dimension use the same size.',
    );
  }

  return embedding;
}

function resolveEmbeddingConfig(): {
  apiUrl: string;
  baseUrl: string;
  model: string;
  dimensions: number;
} {
  const baseUrl = resolveEmbeddingBaseUrl(process.env.LLM_API_URL ?? DEFAULT_LLM_API_URL);
  const isOpenRouter = baseUrl.toLowerCase().includes('openrouter');
  const defaultModel = isOpenRouter
    ? DEFAULT_OPENROUTER_EMBEDDING_MODEL
    : DEFAULT_OPENAI_EMBEDDING_MODEL;
  const model = process.env.EMBEDDING_MODEL?.trim() || defaultModel;
  const dimensions = resolveEmbeddingDimensions();

  return {
    apiUrl: `${baseUrl}/embeddings`,
    baseUrl,
    model,
    dimensions,
  };
}

function resolveEmbeddingBaseUrl(rawApiUrl: string): string {
  const trimmedUrl = rawApiUrl.trim() || DEFAULT_LLM_API_URL;

  return trimmedUrl
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/+$/u, '');
}

function resolveEmbeddingDimensions(): number {
  const rawDimensions = process.env.EMBEDDING_DIMENSIONS?.trim();

  if (!rawDimensions) {
    return DEFAULT_EMBEDDING_DIMENSIONS;
  }

  const parsedDimensions = Number.parseInt(rawDimensions, 10);

  if (!Number.isFinite(parsedDimensions) || parsedDimensions <= 0) {
    throw new Error(`Invalid EMBEDDING_DIMENSIONS value: ${rawDimensions}`);
  }

  return parsedDimensions;
}

async function parseEmbeddingResponse(response: Response): Promise<EmbeddingResponse> {
  const parsed: unknown = await response.json();

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Embedding response was not a JSON object');
  }

  return parsed as EmbeddingResponse;
}
