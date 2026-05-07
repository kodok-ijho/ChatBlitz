import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  SessionState,
  type ChatSessionContext,
  type ChatSessionRecord,
  type CustomerRecord,
  type ISODateTimeString,
  type UUID,
} from './types.ts';

const DEFAULT_LOCK_DURATION_MS = 30_000;

let cachedSupabaseAdminClient: SupabaseClient | null = null;

export class SessionLockedError extends Error {
  constructor(
    public readonly sessionId: UUID,
    public readonly lockedUntil: ISODateTimeString,
  ) {
    super(`Chat session ${sessionId} is locked until ${lockedUntil}`);
    this.name = 'SessionLockedError';
  }
}

export interface GetOrCreateSessionResult {
  customer: CustomerRecord;
  session: ChatSessionRecord;
  lockOwner: string;
  lockedUntil: ISODateTimeString;
  createdSession: boolean;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (cachedSupabaseAdminClient) {
    return cachedSupabaseAdminClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  cachedSupabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedSupabaseAdminClient;
}

export async function getOrCreateSession(
  tenantId: UUID,
  waPhoneE164: string,
  customerName?: string,
  lockDurationMs = DEFAULT_LOCK_DURATION_MS,
): Promise<GetOrCreateSessionResult> {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + lockDurationMs).toISOString();
  const lockOwner = `webhook-${process.pid}-${randomUUID()}`;

  const customer = await upsertCustomer(supabase, tenantId, waPhoneE164, customerName, nowIso);
  const existingSession = await findSessionByCustomer(supabase, tenantId, customer.id);

  if (!existingSession) {
    const session = await createLockedSession(
      supabase,
      tenantId,
      customer.id,
      customerName,
      lockOwner,
      lockedUntil,
      nowIso,
    );

    return {
      customer,
      session,
      lockOwner,
      lockedUntil,
      createdSession: true,
    };
  }

  if (isSessionLocked(existingSession, now)) {
    throw new SessionLockedError(existingSession.id, existingSession.locked_until as ISODateTimeString);
  }

  const lockedSession = await acquireSessionLock(
    supabase,
    tenantId,
    existingSession.id,
    lockOwner,
    lockedUntil,
    nowIso,
  );

  if (!lockedSession) {
    throw new SessionLockedError(
      existingSession.id,
      existingSession.locked_until ?? lockedUntil,
    );
  }

  return {
    customer,
    session: lockedSession,
    lockOwner,
    lockedUntil,
    createdSession: false,
  };
}

export async function releaseSessionLock(
  tenantId: UUID,
  sessionId: UUID,
  lockOwner: string,
  updates?: {
    context?: ChatSessionContext;
    lastMessageId?: string;
    state?: SessionState;
  },
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  const payload: Record<string, unknown> = {
    locked_until: null,
    lock_owner: null,
    updated_at: new Date().toISOString(),
  };

  if (updates?.context) {
    payload.context = updates.context;
  }

  if (updates?.lastMessageId) {
    payload.last_message_id = updates.lastMessageId;
  }

  if (updates?.state) {
    payload.state = updates.state;
  }

  const { error } = await supabase
    .from('chat_sessions')
    .update(payload)
    .eq('tenant_id', tenantId)
    .eq('id', sessionId)
    .eq('lock_owner', lockOwner);

  if (error) {
    throw new Error(`Failed to release chat session lock: ${error.message}`);
  }
}

function isSessionLocked(session: ChatSessionRecord, now: Date): boolean {
  if (!session.locked_until) {
    return false;
  }

  return new Date(session.locked_until).getTime() > now.getTime();
}

async function upsertCustomer(
  supabase: SupabaseClient,
  tenantId: UUID,
  waPhoneE164: string,
  customerName: string | undefined,
  nowIso: ISODateTimeString,
): Promise<CustomerRecord> {
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    wa_phone_e164: waPhoneE164,
    last_seen_at: nowIso,
  };

  if (customerName) {
    payload.display_name = customerName;
  }

  const { data, error } = await supabase
    .from('customers')
    .upsert(payload, { onConflict: 'tenant_id,wa_phone_e164' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to upsert customer: ${error.message}`);
  }

  return data as CustomerRecord;
}

async function findSessionByCustomer(
  supabase: SupabaseClient,
  tenantId: UUID,
  customerId: UUID,
): Promise<ChatSessionRecord | null> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find chat session: ${error.message}`);
  }

  return data ? (data as ChatSessionRecord) : null;
}

async function createLockedSession(
  supabase: SupabaseClient,
  tenantId: UUID,
  customerId: UUID,
  customerName: string | undefined,
  lockOwner: string,
  lockedUntil: ISODateTimeString,
  nowIso: ISODateTimeString,
): Promise<ChatSessionRecord> {
  const context: ChatSessionContext = {};

  if (customerName) {
    context.customerName = customerName;
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      state: SessionState.Init,
      context,
      locked_until: lockedUntil,
      lock_owner: lockOwner,
      last_interaction_at: nowIso,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create chat session: ${error.message}`);
  }

  return data as ChatSessionRecord;
}

async function acquireSessionLock(
  supabase: SupabaseClient,
  tenantId: UUID,
  sessionId: UUID,
  lockOwner: string,
  lockedUntil: ISODateTimeString,
  nowIso: ISODateTimeString,
): Promise<ChatSessionRecord | null> {
  const unlockedOrExpiredFilter = `locked_until.is.null,locked_until.lt.${nowIso}`;

  const { data, error } = await supabase
    .from('chat_sessions')
    .update({
      locked_until: lockedUntil,
      lock_owner: lockOwner,
      last_interaction_at: nowIso,
    })
    .eq('tenant_id', tenantId)
    .eq('id', sessionId)
    .or(unlockedOrExpiredFilter)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to acquire chat session lock: ${error.message}`);
  }

  return data ? (data as ChatSessionRecord) : null;
}
