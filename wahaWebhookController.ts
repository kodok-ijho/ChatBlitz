import type { Request, Response } from 'express';

import {
  MessageDirection,
  type ChatMessageRecord,
  type ChatMessageRole,
  type ChatSessionContext,
  type JsonValue,
  type UUID,
  type WahaMessagePayload,
  type WahaWebhookEvent,
  type WorkflowDag,
  type WorkflowRecord,
} from './types.ts';
import {
  getOrCreateSession,
  getSupabaseAdminClient,
  releaseSessionLock,
  SessionLockedError,
} from './sessionService.ts';
import { processWorkflowStep, type WorkflowStepOptions, type WorkflowStepResult } from './workflowEngine.ts';
import { sendTextMessageToChatId } from './wahaSenderService.ts';

const MAX_WORKFLOW_STEPS_PER_MESSAGE = 6;
const CHAT_HISTORY_LIMIT = 15;
const PLACEHOLDER_TENANT_ID = 'will_be_generated_by_script';

interface ControllerResponseBody {
  ok: boolean;
  accepted?: boolean;
  ignored?: boolean;
  reason?: string;
  tenantId?: UUID;
  messageId?: string;
}

interface InboundWahaMessageJob {
  event: WahaWebhookEvent;
  tenantId: UUID;
  payload: WahaMessagePayload;
  waMessageId: string;
  waPhoneE164: string;
  contactJid: string;
  replyChatId: string;
  customerName?: string;
  userMessage: string;
}

type ConversationHistoryMessage = Pick<
  ChatMessageRecord,
  'id' | 'created_at' | 'contact_jid' | 'role' | 'content'
>;

interface LegacyChatMessageContext {
  sessionId: UUID;
  customerId: UUID;
  waMessageId?: string;
}

export function handleWahaWebhook(req: Request, res: Response): void {
  const event = req.body as WahaWebhookEvent;
  console.info('[wahaWebhookController] Received WAHA webhook', {
    event: event.event,
    session: event.session,
  });

  const tenantId = resolveWebhookTenantId(event, req);

  if (!tenantId) {
    res.status(400).json({
      ok: false,
      accepted: false,
      reason: 'Missing VITE_MVP_TENANT_ID, x-tenant-id, or metadata.tenantId',
    } satisfies ControllerResponseBody);
    return;
  }

  if (!isInboundMessageEvent(event)) {
    res.status(200).json({
      ok: true,
      accepted: false,
      ignored: true,
      reason: 'Unsupported, non-message, or outbound WAHA event',
      tenantId,
    } satisfies ControllerResponseBody);
    return;
  }

  const payload = event.payload;
  const waMessageId = payload.id;
  const senderJid = payload.participant ?? payload.from;
  const replyChatId = payload.from;

  if (!waMessageId || !senderJid || !replyChatId) {
    res.status(200).json({
      ok: true,
      accepted: false,
      ignored: true,
      reason: 'Missing WAHA message id or sender chatId',
      tenantId,
    } satisfies ControllerResponseBody);
    return;
  }

  const waPhoneE164 = normalizeWahaJidToE164(senderJid);
  const contactJid = extractContactJid(payload, senderJid);
  const userMessage = payload.body ?? '';
  const profileName = extractCustomerName(payload);
  const selfIntroducedName = extractSelfIntroducedName(userMessage);
  const customerName = selfIntroducedName ?? profileName;

  res.status(200).json({
    ok: true,
    accepted: true,
    tenantId,
    messageId: waMessageId,
  } satisfies ControllerResponseBody);

  console.info('[wahaWebhookController] Accepted inbound message', {
    tenantId,
    messageId: waMessageId,
    from: senderJid,
    selfIntroducedName,
  });

  void processInboundWahaMessage({
    event,
    tenantId,
    payload,
    waMessageId,
    waPhoneE164,
    contactJid,
    replyChatId,
    customerName,
    userMessage,
  }).catch((error: unknown) => {
    console.error('[wahaWebhookController] Unhandled async webhook error', error);
  });
}

async function processInboundWahaMessage(job: InboundWahaMessageJob): Promise<void> {
  let sessionLock:
    | Awaited<ReturnType<typeof getOrCreateSession>>
    | undefined;
  let nextContext: ChatSessionContext | undefined;
  let processedMessageId: string | undefined;

  try {
    sessionLock = await getOrCreateSession(job.tenantId, job.waPhoneE164, job.customerName);

    if (sessionLock.session.last_message_id === job.waMessageId) {
      nextContext = sessionLock.session.context;
      console.info(`[wahaWebhookController] Ignored duplicate WAHA message ${job.waMessageId}`);
      return;
    }

    const savedUserMessage = await saveChatMessage({
      tenantId: job.tenantId,
      contactJid: job.contactJid,
      role: 'user',
      content: job.userMessage,
      legacy: {
        sessionId: sessionLock.session.id,
        customerId: sessionLock.customer.id,
        waMessageId: job.waMessageId,
      },
    });
    processedMessageId = job.waMessageId;
    const conversationHistory = await fetchConversationHistory(
      job.tenantId,
      job.contactJid,
      savedUserMessage.id,
      sessionLock.customer.id,
    );
    const conversationHistoryText = formatConversationHistory(conversationHistory);
    console.info('[wahaWebhookController] Loaded conversation memory', {
      contactJid: job.contactJid,
      historyCount: conversationHistory.length,
    });
    const activeWorkflow = await getActiveWorkflow(job.tenantId);

    if (!activeWorkflow) {
      nextContext = {
        ...sessionLock.session.context,
        customerName: resolveCustomerNameForContext(
          job.userMessage,
          job.customerName,
          sessionLock.session.context,
        ),
        lastUserMessageId: job.waMessageId,
        variables: {
          ...sessionLock.session.context.variables,
          contactJid: job.contactJid,
          conversationHistory: conversationHistoryToJson(conversationHistory),
          conversationHistoryText,
          lastUserMessageText: job.userMessage,
        },
      };

      console.info(`[wahaWebhookController] No active workflow for tenant ${job.tenantId}`);
      return;
    }

    const sessionContext: ChatSessionContext = {
      ...sessionLock.session.context,
      customerName: resolveCustomerNameForContext(
        job.userMessage,
        job.customerName,
        sessionLock.session.context,
      ),
      activeWorkflowId: activeWorkflow.id,
      activeWorkflowVersion: activeWorkflow.version_number,
      previousNodeId: sessionLock.session.context.currentNodeId,
      currentNodeId: undefined,
      lastUserMessageId: job.waMessageId,
      variables: {
        ...sessionLock.session.context.variables,
        contactJid: job.contactJid,
        conversationHistory: conversationHistoryToJson(conversationHistory),
        conversationHistoryText,
        lastUserMessageText: job.userMessage,
      },
    };

    const workflowResult = await processWorkflowUntilReply(
      sessionContext,
      activeWorkflow.dag_json,
      {
        tenantId: job.tenantId,
        userMessage: job.userMessage,
      },
    );
    nextContext = workflowResult.updatedContext;

    if (workflowResult.replyText) {
      await sendTextMessageToChatId(job.replyChatId, workflowResult.replyText);
      try {
        const savedAssistantMessage = await saveChatMessage({
          tenantId: job.tenantId,
          contactJid: job.contactJid,
          role: 'assistant',
          content: workflowResult.replyText,
          legacy: {
            sessionId: sessionLock.session.id,
            customerId: sessionLock.customer.id,
            waMessageId: `assistant_${job.waMessageId}`,
          },
        });
        nextContext = {
          ...nextContext,
          lastAssistantMessageId: savedAssistantMessage.id,
        };
      } catch (saveAssistantError) {
        console.error('[wahaWebhookController] Failed to persist assistant reply', saveAssistantError);
      }
      console.info(`[wahaWebhookController] Sent reply for WAHA message ${job.waMessageId}`);
    } else {
      console.info('[wahaWebhookController] Workflow completed without reply', {
        messageId: job.waMessageId,
        logs: workflowResult.logs,
      });
    }
  } catch (error) {
    if (error instanceof SessionLockedError) {
      console.info(`[wahaWebhookController] Ignored locked session: ${error.message}`);
      return;
    }

    console.error('[wahaWebhookController] Failed to process inbound WAHA message', error);
  } finally {
    if (sessionLock) {
      try {
        await releaseSessionLock(job.tenantId, sessionLock.session.id, sessionLock.lockOwner, {
          context: nextContext,
          lastMessageId: processedMessageId,
        });
      } catch (releaseError) {
        console.error('[wahaWebhookController] Failed to release session lock', releaseError);
      }
    }
  }
}

async function processWorkflowUntilReply(
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
  options: WorkflowStepOptions,
): Promise<WorkflowStepResult> {
  let context = sessionContext;
  let lastResult: WorkflowStepResult | undefined;
  const logs: string[] = [];

  for (let step = 0; step < MAX_WORKFLOW_STEPS_PER_MESSAGE; step += 1) {
    const result = await processWorkflowStep(context, currentDag, options);
    logs.push(...result.logs);
    context = result.updatedContext;
    lastResult = {
      ...result,
      updatedContext: context,
      logs: [...logs],
    };

    if (!result.ok || result.replyText || !result.nextNodeId) {
      return lastResult;
    }
  }

  if (lastResult) {
    return {
      ...lastResult,
      updatedContext: context,
      logs: [
        ...logs,
        `Stopped workflow after ${MAX_WORKFLOW_STEPS_PER_MESSAGE} step(s) without a final reply.`,
      ],
    };
  }

  return {
    ok: false,
    updatedContext: context,
    logs: ['Workflow did not execute any step.'],
    replyText: undefined,
  };
}

export function normalizeWahaJidToE164(jid: string): string {
  const phonePart = jid.split('@')[0] ?? jid;
  const normalized = phonePart.replace(/[^\d+]/g, '');

  if (normalized.startsWith('+')) {
    return normalized;
  }

  return `+${normalized}`;
}

export function resolveWebhookTenantId(event: WahaWebhookEvent, req: Request): UUID | undefined {
  const envTenantId = process.env.VITE_MVP_TENANT_ID?.trim();

  if (envTenantId && envTenantId !== PLACEHOLDER_TENANT_ID) {
    return envTenantId;
  }

  return extractTenantId(event, req);
}

export function extractTenantId(event: WahaWebhookEvent, req: Request): UUID | undefined {
  const metadataTenantId = event.metadata?.tenantId;

  if (typeof metadataTenantId === 'string' && metadataTenantId.length > 0) {
    return metadataTenantId;
  }

  const headerTenantId = req.headers['x-tenant-id'];

  if (Array.isArray(headerTenantId)) {
    return headerTenantId[0];
  }

  return typeof headerTenantId === 'string' ? headerTenantId : undefined;
}

function isInboundMessageEvent(event: WahaWebhookEvent): event is WahaWebhookEvent & { payload: WahaMessagePayload } {
  if (event.event !== 'message' && event.event !== 'message.any') {
    return false;
  }

  const payload = event.payload as Partial<WahaMessagePayload>;

  return typeof payload.id === 'string' &&
    typeof payload.from === 'string' &&
    payload.fromMe !== true;
}

function extractCustomerName(payload: WahaMessagePayload): string | undefined {
  const rawData = payload._data;

  if (rawData && typeof rawData === 'object' && 'notifyName' in rawData) {
    const notifyName = (rawData as { notifyName?: unknown }).notifyName;

    if (typeof notifyName === 'string' && notifyName.trim().length > 0) {
      return notifyName.trim();
    }
  }

  return undefined;
}

function resolveCustomerNameForContext(
  userMessage: string,
  incomingName: string | undefined,
  existingContext: ChatSessionContext,
): string | undefined {
  const selfIntroducedName = extractSelfIntroducedName(userMessage);

  if (selfIntroducedName) {
    return selfIntroducedName;
  }

  return existingContext.customerName ?? incomingName;
}

function extractSelfIntroducedName(message: string): string | undefined {
  const normalizedMessage = message.trim();

  if (!normalizedMessage) {
    return undefined;
  }

  const introductionPatterns = [
    /\b(?:nama\s+saya|nama\s+aku|saya\s+bernama|aku\s+bernama|perkenalkan\s+(?:nama\s+saya|saya)?)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.' -]{1,40})/iu,
    /\b(?:saya|aku)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.' -]{1,40})(?=\s*,|\s+mau\b|\s+ingin\b|\s+butuh\b|\s+perlu\b|\s+tanya\b|\s+menanyakan\b|$)/iu,
  ];

  for (const pattern of introductionPatterns) {
    const match = normalizedMessage.match(pattern);
    const rawName = match?.[1];

    if (!rawName) {
      continue;
    }

    const name = cleanIntroducedName(rawName);

    if (name) {
      return name;
    }
  }

  return undefined;
}

function cleanIntroducedName(rawName: string): string | undefined {
  const stopWords = new Set([
    'mau',
    'ingin',
    'butuh',
    'perlu',
    'tanya',
    'menanyakan',
    'nanya',
    'pesan',
    'order',
  ]);
  const words = rawName
    .replace(/[^\p{L}.' -]/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  const nameWords: string[] = [];

  for (const word of words) {
    if (stopWords.has(word.toLowerCase())) {
      break;
    }

    nameWords.push(word);
  }

  const name = nameWords
    .slice(0, 3)
    .join(' ')
    .trim();

  if (name.length < 2) {
    return undefined;
  }

  return name
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function extractContactJid(payload: WahaMessagePayload, fallbackJid: string): string {
  const candidates = [
    readNestedString(payload._data, ['from']),
    readNestedString(payload._data, ['author']),
    readNestedString(payload._data, ['id', 'remote']),
    readNestedString(payload._data, ['id', 'participant']),
    payload.participant,
    payload.from,
    fallbackJid,
  ]
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map(normalizeContactJid);

  const phoneJid = candidates.find(isPhoneJid);

  return phoneJid ?? candidates[0] ?? normalizeContactJid(fallbackJid);
}

function normalizeContactJid(jid: string): string {
  const trimmed = jid.trim().toLowerCase();
  const [rawUser, rawDomain] = trimmed.split('@', 2);
  const user = rawUser.replace(/[^\dA-Za-z._-]/g, '');

  if (!user) {
    return trimmed;
  }

  if (!rawDomain) {
    return `${user}@s.whatsapp.net`;
  }

  const domain = rawDomain === 'c.us' ? 's.whatsapp.net' : rawDomain;
  return `${user}@${domain}`;
}

function isPhoneJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') && /^\d+@s\.whatsapp\.net$/u.test(jid);
}

function readNestedString(source: unknown, path: string[]): string | undefined {
  let current: unknown = source;

  for (const segment of path) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

async function saveChatMessage(input: {
  tenantId: UUID;
  contactJid: string;
  role: ChatMessageRole;
  content: string;
  legacy?: LegacyChatMessageContext;
}): Promise<ConversationHistoryMessage> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      tenant_id: input.tenantId,
      contact_jid: input.contactJid,
      role: input.role,
      content: input.content,
    })
    .select('id, created_at, tenant_id, contact_jid, role, content')
    .single();

  if (error) {
    if (isMissingMemorySchemaError(error) && input.legacy) {
      return saveLegacyChatMessage({
        tenantId: input.tenantId,
        contactJid: input.contactJid,
        role: input.role,
        content: input.content,
        legacy: input.legacy,
      });
    }

    throw new Error(`Failed to save ${input.role} chat message: ${error.message}`);
  }

  return parseConversationHistoryMessage(data);
}

async function saveLegacyChatMessage(input: {
  tenantId: UUID;
  contactJid: string;
  role: ChatMessageRole;
  content: string;
  legacy: LegacyChatMessageContext;
}): Promise<ConversationHistoryMessage> {
  const supabase = getSupabaseAdminClient();
  const direction = input.role === 'user'
    ? MessageDirection.Inbound
    : MessageDirection.Outbound;
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      tenant_id: input.tenantId,
      session_id: input.legacy.sessionId,
      customer_id: input.legacy.customerId,
      direction,
      message_text: input.content,
      wa_message_id: input.legacy.waMessageId ?? `${input.role}_${Date.now()}`,
    })
    .select('id, created_at, direction, message_text')
    .single();

  if (error) {
    throw new Error(`Failed to save legacy ${input.role} chat message: ${error.message}`);
  }

  console.warn('[wahaWebhookController] chat_messages memory columns are not visible yet; using legacy columns fallback.');
  return parseLegacyConversationHistoryMessage(data, input.contactJid);
}

async function fetchConversationHistory(
  tenantId: UUID,
  contactJid: string,
  excludeMessageId?: UUID,
  legacyCustomerId?: UUID,
): Promise<ConversationHistoryMessage[]> {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('chat_messages')
    .select('id, created_at, tenant_id, contact_jid, role, content')
    .eq('tenant_id', tenantId)
    .eq('contact_jid', contactJid)
    .order('created_at', { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);

  if (excludeMessageId) {
    query = query.neq('id', excludeMessageId);
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingMemorySchemaError(error) && legacyCustomerId) {
      return fetchLegacyConversationHistory(tenantId, contactJid, legacyCustomerId, excludeMessageId);
    }

    throw new Error(`Failed to fetch conversation history: ${error.message}`);
  }

  return (data ?? [])
    .map(parseConversationHistoryMessage)
    .reverse();
}

async function fetchLegacyConversationHistory(
  tenantId: UUID,
  contactJid: string,
  customerId: UUID,
  excludeMessageId?: UUID,
): Promise<ConversationHistoryMessage[]> {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('chat_messages')
    .select('id, created_at, direction, message_text')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);

  if (excludeMessageId) {
    query = query.neq('id', excludeMessageId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch legacy conversation history: ${error.message}`);
  }

  console.warn('[wahaWebhookController] chat_messages memory columns are not visible yet; reading legacy history fallback.');
  return (data ?? [])
    .map((row) => parseLegacyConversationHistoryMessage(row, contactJid))
    .reverse();
}

function parseConversationHistoryMessage(row: unknown): ConversationHistoryMessage {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid chat message row returned from Supabase');
  }

  const candidate = row as Partial<ConversationHistoryMessage>;

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.created_at !== 'string' ||
    typeof candidate.contact_jid !== 'string' ||
    !isChatMessageRole(candidate.role) ||
    typeof candidate.content !== 'string'
  ) {
    throw new Error('Chat message row did not match expected memory schema');
  }

  return {
    id: candidate.id,
    created_at: candidate.created_at,
    contact_jid: candidate.contact_jid,
    role: candidate.role,
    content: candidate.content,
  };
}

function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return value === 'user' || value === 'assistant';
}

function parseLegacyConversationHistoryMessage(row: unknown, contactJid: string): ConversationHistoryMessage {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid legacy chat message row returned from Supabase');
  }

  const candidate = row as {
    id?: unknown;
    created_at?: unknown;
    direction?: unknown;
    message_text?: unknown;
  };

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.created_at !== 'string' ||
    typeof candidate.message_text !== 'string'
  ) {
    throw new Error('Legacy chat message row did not match expected schema');
  }

  return {
    id: candidate.id,
    created_at: candidate.created_at,
    contact_jid: contactJid,
    role: candidate.direction === MessageDirection.Inbound ? 'user' : 'assistant',
    content: candidate.message_text,
  };
}

function isMissingMemorySchemaError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? '';

  return error.code === 'PGRST204' ||
    message.includes('schema cache') ||
    message.includes('contact_jid') ||
    message.includes('role') ||
    message.includes('content');
}

function formatConversationHistory(messages: ConversationHistoryMessage[]): string {
  if (messages.length === 0) {
    return '';
  }

  return messages
    .map((message) => {
      const speaker = message.role === 'user' ? 'Customer' : 'NARA';
      return `${speaker}: ${message.content}`;
    })
    .join('\n');
}

function conversationHistoryToJson(messages: ConversationHistoryMessage[]): JsonValue[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
  }));
}

async function getActiveWorkflow(tenantId: UUID): Promise<WorkflowRecord | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active workflow: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    ...(data as Omit<WorkflowRecord, 'dag_json'>),
    dag_json: data.dag_json as WorkflowDag,
  };
}
