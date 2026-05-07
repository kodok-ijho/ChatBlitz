interface WahaSession {
  name: string;
  status?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_WAHA_URL = 'http://localhost:3000';
const DEFAULT_SESSION = 'default';
const DEFAULT_WEBHOOK_URL = 'http://host.docker.internal:3001/api/webhook/waha';
const DEFAULT_WEBHOOK_EVENTS = ['message', 'session.status'] as const;

async function main(): Promise<void> {
  const wahaUrl = (process.env.WAHA_URL ?? DEFAULT_WAHA_URL).replace(/\/+$/u, '');
  const sessionName = process.env.WAHA_SESSION ?? DEFAULT_SESSION;
  const webhookUrl = process.env.WAHA_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  const webhookEvents = resolveWebhookEvents();
  const apiKey = resolveWahaApiKey();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  const existingSession = await getSession(wahaUrl, sessionName, headers);
  const body = {
    name: sessionName,
    start: true,
    config: {
      ...(existingSession?.config ?? {}),
      webhooks: [
        {
          url: webhookUrl,
          events: webhookEvents,
        },
      ],
    },
  };

  const method = existingSession ? 'PUT' : 'POST';
  const url = existingSession
    ? `${wahaUrl}/api/sessions/${encodeURIComponent(sessionName)}`
    : `${wahaUrl}/api/sessions`;

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to configure WAHA webhook: ${response.status} ${await response.text()}`);
  }

  const configuredSession = await response.json() as WahaSession;

  console.log('WAHA webhook configured.');
  console.log(`Session: ${configuredSession.name}`);
  console.log(`Webhook URL: ${webhookUrl}`);
  console.log(`Events: ${webhookEvents.join(',')}`);

  await restartSession(wahaUrl, sessionName, headers);
}

async function getSession(
  wahaUrl: string,
  sessionName: string,
  headers: Record<string, string>,
): Promise<WahaSession | null> {
  const response = await fetch(`${wahaUrl}/api/sessions/${encodeURIComponent(sessionName)}`, {
    method: 'GET',
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get WAHA session: ${response.status} ${await response.text()}`);
  }

  return await response.json() as WahaSession;
}

async function restartSession(
  wahaUrl: string,
  sessionName: string,
  headers: Record<string, string>,
): Promise<void> {
  const response = await fetch(`${wahaUrl}/api/sessions/${encodeURIComponent(sessionName)}/restart`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    console.warn(`WAHA session restart failed: ${response.status} ${await response.text()}`);
    return;
  }

  console.log(`Session restart requested: ${sessionName}`);
}

function resolveWahaApiKey(): string | undefined {
  return process.env.WAHA_API_KEY_PLAIN?.trim() ||
    process.env.WAHA_API_KEY?.trim() ||
    process.env.WHATSAPP_API_KEY?.trim() ||
    undefined;
}

function resolveWebhookEvents(): string[] {
  const rawEvents = process.env.WAHA_WEBHOOK_EVENTS?.trim();

  if (!rawEvents) {
    return [...DEFAULT_WEBHOOK_EVENTS];
  }

  return rawEvents
    .split(',')
    .map((eventName) => eventName.trim())
    .filter((eventName) => eventName.length > 0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown WAHA webhook configuration error';
  console.error(message);
  process.exitCode = 1;
});
