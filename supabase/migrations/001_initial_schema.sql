CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  owner_name text,
  phone_e164 text,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_phone_e164_format_chk
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  dag_json jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT workflows_version_number_chk CHECK (version_number > 0),
  CONSTRAINT workflows_status_chk CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT workflows_id_tenant_id_unique UNIQUE (id, tenant_id)
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  wa_phone_e164 text NOT NULL,
  display_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_wa_phone_e164_format_chk
    CHECK (wa_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customers_tenant_wa_phone_unique UNIQUE (tenant_id, wa_phone_e164),
  CONSTRAINT customers_id_tenant_id_unique UNIQUE (id, tenant_id)
);

CREATE TABLE public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'INIT',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_id text,
  locked_until timestamptz,
  lock_owner text,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_sessions_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT chat_sessions_tenant_customer_unique UNIQUE (tenant_id, customer_id),
  CONSTRAINT chat_sessions_id_tenant_id_unique UNIQUE (id, tenant_id),
  CONSTRAINT chat_sessions_state_chk CHECK (
    state IN (
      'INIT',
      'INFO_GATHERING',
      'CALCULATING_PRICE',
      'AWAITING_CONFIRMATION',
      'ORDER_CREATED',
      'HUMAN_HANDOFF',
      'CLOSED'
    )
  ),
  CONSTRAINT chat_sessions_lock_owner_chk
    CHECK (locked_until IS NULL OR lock_owner IS NOT NULL)
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  direction text NOT NULL,
  message_text text NOT NULL DEFAULT '',
  wa_message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_session_tenant_fk
    FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.chat_sessions(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT chat_messages_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT chat_messages_direction_chk
    CHECK (direction IN ('inbound', 'outbound', 'system')),
  CONSTRAINT chat_messages_tenant_wa_message_unique UNIQUE (tenant_id, wa_message_id)
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  order_code text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  payment_status text NOT NULL DEFAULT 'unpaid',
  service_type text,
  weight_kg numeric(10,2),
  price_per_kg numeric(12,2),
  total_price numeric(12,2) NOT NULL DEFAULT 0,
  pickup_address text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT orders_customer_tenant_fk
    FOREIGN KEY (customer_id, tenant_id)
    REFERENCES public.customers(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT orders_tenant_order_code_unique UNIQUE (tenant_id, order_code),
  CONSTRAINT orders_status_chk
    CHECK (status IN ('draft', 'confirmed', 'processing', 'ready', 'completed', 'cancelled')),
  CONSTRAINT orders_payment_status_chk
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  CONSTRAINT orders_weight_kg_chk
    CHECK (weight_kg IS NULL OR weight_kg > 0),
  CONSTRAINT orders_price_per_kg_chk
    CHECK (price_per_kg IS NULL OR price_per_kg >= 0),
  CONSTRAINT orders_total_price_chk
    CHECK (total_price >= 0)
);

CREATE TABLE public.knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL,
  raw_content text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_bases_source_type_chk
    CHECK (source_type IN ('text', 'url', 'file')),
  CONSTRAINT knowledge_bases_id_tenant_id_unique UNIQUE (id, tenant_id)
);

CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kb_id uuid NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_chunks_kb_tenant_fk
    FOREIGN KEY (kb_id, tenant_id)
    REFERENCES public.knowledge_bases(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX tenants_owner_user_id_idx
  ON public.tenants(owner_user_id);

CREATE INDEX workflows_tenant_id_idx
  ON public.workflows(tenant_id);

CREATE UNIQUE INDEX workflows_one_active_per_tenant_idx
  ON public.workflows(tenant_id)
  WHERE is_active = true;

CREATE INDEX customers_tenant_last_seen_idx
  ON public.customers(tenant_id, last_seen_at DESC);

CREATE INDEX chat_sessions_tenant_last_interaction_idx
  ON public.chat_sessions(tenant_id, last_interaction_at DESC);

CREATE INDEX chat_sessions_tenant_locked_until_idx
  ON public.chat_sessions(tenant_id, locked_until);

CREATE INDEX chat_messages_session_created_idx
  ON public.chat_messages(tenant_id, session_id, created_at DESC);

CREATE INDEX chat_messages_customer_created_idx
  ON public.chat_messages(tenant_id, customer_id, created_at DESC);

CREATE INDEX orders_tenant_customer_created_idx
  ON public.orders(tenant_id, customer_id, created_at DESC);

CREATE INDEX orders_tenant_status_idx
  ON public.orders(tenant_id, status);

CREATE INDEX orders_tenant_payment_status_idx
  ON public.orders(tenant_id, payment_status);

CREATE INDEX knowledge_bases_tenant_active_idx
  ON public.knowledge_bases(tenant_id, is_active);

CREATE INDEX knowledge_chunks_tenant_kb_idx
  ON public.knowledge_chunks(tenant_id, kb_id);

CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_chat_sessions_updated_at
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_knowledge_bases_updated_at
  BEFORE UPDATE ON public.knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION private.is_tenant_owner(target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE id = target_tenant_id
      AND owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE ALL ON FUNCTION private.is_tenant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_tenant_owner(uuid) TO authenticated;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_select_own
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY tenants_insert_own
  ON public.tenants
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY tenants_update_own
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY tenants_delete_own
  ON public.tenants
  FOR DELETE
  TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY workflows_tenant_access
  ON public.workflows
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY customers_tenant_access
  ON public.customers
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY chat_sessions_tenant_access
  ON public.chat_sessions
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY chat_messages_tenant_access
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY orders_tenant_access
  ON public.orders
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY knowledge_bases_tenant_access
  ON public.knowledge_bases
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

CREATE POLICY knowledge_chunks_tenant_access
  ON public.knowledge_chunks
  FOR ALL
  TO authenticated
  USING (private.is_tenant_owner(tenant_id))
  WITH CHECK (private.is_tenant_owner(tenant_id));

COMMENT ON TABLE public.tenants IS
  'Laundry business tenant owned by one authenticated Supabase user.';
COMMENT ON COLUMN public.tenants.owner_user_id IS
  'Supabase auth.users id that owns this tenant and scopes RLS access.';
COMMENT ON COLUMN public.tenants.phone_e164 IS
  'Canonical tenant WhatsApp or business phone number in E.164 format.';

COMMENT ON TABLE public.workflows IS
  'Workflow definitions saved from React Flow as JSON DAG documents.';
COMMENT ON COLUMN public.workflows.dag_json IS
  'Directed acyclic graph JSON containing workflow nodes, edges, and node configuration.';
COMMENT ON COLUMN public.workflows.is_active IS
  'Marks the single active workflow used by the inbound webhook execution engine.';

COMMENT ON TABLE public.customers IS
  'Laundry customers discovered from inbound WhatsApp conversations.';
COMMENT ON COLUMN public.customers.wa_phone_e164 IS
  'Canonical WhatsApp phone number in E.164 format, unique per tenant.';
COMMENT ON COLUMN public.customers.metadata IS
  'Flexible customer attributes such as address hints, preferences, or imported CRM fields.';

COMMENT ON TABLE public.chat_sessions IS
  'Finite state machine session per tenant/customer pair.';
COMMENT ON COLUMN public.chat_sessions.state IS
  'Current FSM state, for example INIT, INFO_GATHERING, CALCULATING_PRICE, or AWAITING_CONFIRMATION.';
COMMENT ON COLUMN public.chat_sessions.context IS
  'JSON conversation context used by routing, workflow execution, and tool calls.';
COMMENT ON COLUMN public.chat_sessions.last_message_id IS
  'Latest WhatsApp message id seen by the session processor.';
COMMENT ON COLUMN public.chat_sessions.locked_until IS
  'Temporary lock expiry used by webhook workers to avoid race conditions during rapid inbound messages.';
COMMENT ON COLUMN public.chat_sessions.lock_owner IS
  'Worker identifier that owns the current session lock.';

COMMENT ON TABLE public.chat_messages IS
  'Append-only chat log for UI conversation history and webhook idempotency.';
COMMENT ON COLUMN public.chat_messages.direction IS
  'Message direction: inbound from customer, outbound from agent, or system.';
COMMENT ON COLUMN public.chat_messages.wa_message_id IS
  'WAHA/WhatsApp message id, unique per tenant to prevent duplicate webhook processing.';

COMMENT ON TABLE public.orders IS
  'Laundry order and transaction records associated with WhatsApp customers.';
COMMENT ON COLUMN public.orders.payment_status IS
  'Payment state for the order: unpaid, partial, or paid. Defaults to unpaid.';
COMMENT ON COLUMN public.orders.metadata IS
  'Flexible order payload for service-specific details not represented as first-class columns.';

COMMENT ON TABLE public.knowledge_bases IS
  'Tenant-owned knowledge base source documents used for RAG.';
COMMENT ON COLUMN public.knowledge_bases.source_type IS
  'Knowledge source type: text, url, or file.';
COMMENT ON COLUMN public.knowledge_bases.raw_content IS
  'Raw extracted text from the source before chunking and embedding.';
COMMENT ON COLUMN public.knowledge_bases.is_active IS
  'Controls whether this source should be considered during retrieval.';

COMMENT ON TABLE public.knowledge_chunks IS
  'Chunked knowledge text with pgvector embeddings for semantic retrieval.';
COMMENT ON COLUMN public.knowledge_chunks.chunk_text IS
  'Searchable text fragment sent to the LLM as RAG context.';
COMMENT ON COLUMN public.knowledge_chunks.embedding IS
  '1536-dimensional embedding vector indexed with HNSW cosine distance.';
