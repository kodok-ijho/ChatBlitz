ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS contact_jid text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS content text;

UPDATE public.chat_messages AS cm
SET
  contact_jid = COALESCE(
    cm.contact_jid,
    regexp_replace(c.wa_phone_e164, '[^0-9]', '', 'g') || '@s.whatsapp.net'
  ),
  role = COALESCE(
    cm.role,
    CASE
      WHEN cm.direction = 'inbound' THEN 'user'
      ELSE 'assistant'
    END
  ),
  content = COALESCE(cm.content, cm.message_text)
FROM public.customers AS c
WHERE cm.customer_id = c.id
  AND cm.tenant_id = c.tenant_id;

UPDATE public.chat_messages
SET
  contact_jid = COALESCE(contact_jid, customer_id::text),
  role = COALESCE(
    role,
    CASE
      WHEN direction = 'inbound' THEN 'user'
      ELSE 'assistant'
    END
  ),
  content = COALESCE(content, message_text, '')
WHERE contact_jid IS NULL
   OR role IS NULL
   OR content IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.chat_messages ALTER COLUMN session_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.chat_messages ALTER COLUMN customer_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'direction'
  ) THEN
    ALTER TABLE public.chat_messages ALTER COLUMN direction DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'wa_message_id'
  ) THEN
    ALTER TABLE public.chat_messages ALTER COLUMN wa_message_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.chat_messages
  ALTER COLUMN contact_jid SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN content SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_messages_role_chk'
      AND conrelid = 'public.chat_messages'::regclass
  ) THEN
    ALTER TABLE public.chat_messages
      ADD CONSTRAINT chat_messages_role_chk CHECK (role IN ('user', 'assistant'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS chat_messages_tenant_contact_created_idx
  ON public.chat_messages(tenant_id, contact_jid, created_at DESC);

NOTIFY pgrst, 'reload schema';
