export interface WahaSendTextResponse {
  id?: string;
  status?: string;
  [key: string]: unknown;
}

export async function sendTextMessage(toE164: string, text: string): Promise<void> {
  return sendTextMessageToChatId(toE164ToWahaChatId(toE164), text);
}

export async function sendTextMessageToChatId(chatId: string, text: string): Promise<void> {
  const wahaUrl = process.env.WAHA_URL;
  const session = process.env.WAHA_SESSION ?? 'default';
  const apiKey = resolveWahaApiKey();

  if (!wahaUrl) {
    throw new Error('Missing WAHA_URL environment variable');
  }

  const trimmedText = text.trim();

  if (!trimmedText) {
    return;
  }

  const trimmedChatId = chatId.trim();

  if (!trimmedChatId) {
    throw new Error('Cannot send WAHA text message to empty chatId');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  const response = await fetch(`${wahaUrl.replace(/\/$/, '')}/api/sendText`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session,
      chatId: trimmedChatId,
      text: trimmedText,
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text();

    if (response.status === 401) {
      throw new Error(
        'WAHA sendText unauthorized. Set WAHA_API_KEY in backend .env to match WAHA_API_KEY in docker-compose.yml. ' +
          `Response: ${responseBody}`,
      );
    }

    throw new Error(`WAHA sendText failed with status ${response.status}: ${responseBody}`);
  }
}

function resolveWahaApiKey(): string | undefined {
  return process.env.WAHA_API_KEY_PLAIN?.trim() ||
    process.env.WAHA_API_KEY?.trim() ||
    process.env.WHATSAPP_API_KEY?.trim() ||
    undefined;
}

export function toE164ToWahaChatId(toE164: string): string {
  const digits = toE164.replace(/[^\d]/g, '');

  if (!digits) {
    throw new Error('Cannot convert empty phone number to WAHA chatId');
  }

  return `${digits}@c.us`;
}
