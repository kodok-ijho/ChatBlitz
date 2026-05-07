import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { generateEmbedding } from '../embeddingService.ts';
import type { UUID } from '../types.ts';

const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_OWNER_EMAIL = 'owner+nara-mvp@example.com';
const TENANT_BUSINESS_NAME = 'NARA Laundry MVP';
const KNOWLEDGE_BASE_TITLE = 'FAQ Laundry NARA';

const laundryChunks = [
  'Harga cuci komplit reguler adalah Rp 6.000 per kg, selesai dalam 2 hari.',
  'Harga cuci kilat adalah Rp 10.000 per kg, selesai dalam 1 hari.',
  'Jam operasional laundry adalah setiap hari pukul 08:00 hingga 20:00.',
  'Layanan antar jemput tersedia untuk area sekitar toko dengan minimal order 5 kg.',
  'Pembayaran dapat dilakukan tunai, transfer bank, atau QRIS setelah cucian selesai ditimbang.',
  'Estimasi berat akan dikonfirmasi ulang setelah pakaian diterima dan ditimbang oleh petugas.',
] as const;

interface TenantRow {
  id: UUID;
  business_name: string;
}

interface KnowledgeBaseRow {
  id: UUID;
  tenant_id: UUID;
  title: string;
}

interface KnowledgeChunkInsert {
  tenant_id: UUID;
  kb_id: UUID;
  chunk_text: string;
  embedding: string;
}

async function main(): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const ownerUserId = await resolveOwnerUserId(supabase);
  const tenant = await upsertTenant(supabase, ownerUserId);
  const knowledgeBase = await upsertKnowledgeBase(supabase, tenant.id);

  await replaceKnowledgeChunks(supabase, tenant.id, knowledgeBase.id);

  console.log('Laundry RAG data ingestion completed.');
  console.log(`Tenant: ${tenant.business_name} (${tenant.id})`);
  console.log(`Knowledge Base: ${knowledgeBase.title} (${knowledgeBase.id})`);
  console.log(`VITE_MVP_TENANT_ID=${tenant.id}`);
}

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveOwnerUserId(supabase: SupabaseClient): Promise<UUID> {
  const explicitOwnerUserId = process.env.NARA_MVP_OWNER_USER_ID?.trim();

  if (explicitOwnerUserId) {
    return explicitOwnerUserId;
  }

  const ownerEmail = process.env.NARA_MVP_OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL;
  const existingUser = await findUserByEmail(supabase, ownerEmail);

  if (existingUser) {
    return existingUser.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
    user_metadata: {
      name: 'NARA MVP Owner',
    },
  });

  if (error || !data.user) {
    throw new Error(`Failed to create dummy owner user: ${error?.message ?? 'missing user data'}`);
  }

  return data.user.id;
}

async function findUserByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }

    const foundUser = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);

    if (foundUser) {
      return foundUser;
    }

    if (data.users.length < 1000) {
      return null;
    }
  }

  return null;
}

async function upsertTenant(supabase: SupabaseClient, ownerUserId: UUID): Promise<TenantRow> {
  const tenantId = process.env.NARA_MVP_TENANT_ID?.trim() || DEFAULT_TENANT_ID;

  const { data, error } = await supabase
    .from('tenants')
    .upsert(
      {
        id: tenantId,
        owner_user_id: ownerUserId,
        business_name: TENANT_BUSINESS_NAME,
        owner_name: 'NARA MVP Owner',
        phone_e164: '+6281234567890',
        timezone: 'Asia/Jakarta',
      },
      { onConflict: 'id' },
    )
    .select('id, business_name')
    .single();

  if (error) {
    throw new Error(`Failed to upsert tenant: ${error.message}`);
  }

  return data as TenantRow;
}

async function upsertKnowledgeBase(
  supabase: SupabaseClient,
  tenantId: UUID,
): Promise<KnowledgeBaseRow> {
  const rawContent = laundryChunks.join('\n\n');

  const { data: existingKnowledgeBases, error: findError } = await supabase
    .from('knowledge_bases')
    .select('id, tenant_id, title')
    .eq('tenant_id', tenantId)
    .eq('title', KNOWLEDGE_BASE_TITLE)
    .limit(1);

  if (findError) {
    throw new Error(`Failed to find knowledge base: ${findError.message}`);
  }

  const existingKnowledgeBase = existingKnowledgeBases?.[0] as KnowledgeBaseRow | undefined;

  if (existingKnowledgeBase) {
    const { data, error } = await supabase
      .from('knowledge_bases')
      .update({
        source_type: 'text',
        raw_content: rawContent,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', existingKnowledgeBase.id)
      .select('id, tenant_id, title')
      .single();

    if (error) {
      throw new Error(`Failed to update knowledge base: ${error.message}`);
    }

    return data as KnowledgeBaseRow;
  }

  const { data, error } = await supabase
    .from('knowledge_bases')
    .insert({
      tenant_id: tenantId,
      title: KNOWLEDGE_BASE_TITLE,
      source_type: 'text',
      raw_content: rawContent,
      is_active: true,
    })
    .select('id, tenant_id, title')
    .single();

  if (error) {
    throw new Error(`Failed to insert knowledge base: ${error.message}`);
  }

  return data as KnowledgeBaseRow;
}

async function replaceKnowledgeChunks(
  supabase: SupabaseClient,
  tenantId: UUID,
  knowledgeBaseId: UUID,
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('kb_id', knowledgeBaseId);

  if (deleteError) {
    throw new Error(`Failed to delete existing knowledge chunks: ${deleteError.message}`);
  }

  const rows: KnowledgeChunkInsert[] = [];

  for (const [index, chunkText] of laundryChunks.entries()) {
    console.log(`Generating embedding ${index + 1}/${laundryChunks.length}`);
    const embedding = await generateEmbedding(chunkText);

    rows.push({
      tenant_id: tenantId,
      kb_id: knowledgeBaseId,
      chunk_text: chunkText,
      embedding: formatEmbeddingForPgVector(embedding),
    });
  }

  const { error: insertError } = await supabase
    .from('knowledge_chunks')
    .insert(rows);

  if (insertError) {
    throw new Error(`Failed to insert knowledge chunks: ${insertError.message}`);
  }
}

function formatEmbeddingForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown ingestion error';
  console.error(`Laundry RAG data ingestion failed: ${message}`);
  process.exitCode = 1;
});
