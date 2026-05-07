import { createClient } from '@supabase/supabase-js';

interface SchemaProbeRow {
  id: string;
  created_at: string;
  tenant_id: string;
  contact_jid: string;
  role: 'user' | 'assistant';
  content: string;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, created_at, tenant_id, contact_jid, role, content')
    .limit(1);

  if (error) {
    const message = error.message.toLowerCase();

    if (
      error.code === 'PGRST204' ||
      message.includes('schema cache') ||
      message.includes('contact_jid') ||
      message.includes('role') ||
      message.includes('content')
    ) {
      console.error('Chat memory schema is NOT active in Supabase/PostgREST yet.');
      console.error('Run this migration in Supabase SQL Editor or your migration pipeline:');
      console.error('  supabase/migrations/003_chat_messages_memory.sql');
      console.error('');
      console.error('After running it, execute this in SQL Editor if needed:');
      console.error("  NOTIFY pgrst, 'reload schema';");
      process.exitCode = 1;
      return;
    }

    throw new Error(`Failed to check chat memory schema: ${error.message}`);
  }

  const rows = (data ?? []) as SchemaProbeRow[];
  console.log('Chat memory schema is active.');
  console.log(`Probe rows returned: ${rows.length}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown chat memory schema check error';
  console.error(message);
  process.exitCode = 1;
});
