CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_tenant_id uuid
)
RETURNS TABLE (
  chunk_text text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kc.chunk_text,
    (1 - (kc.embedding <=> query_embedding))::float AS similarity
  FROM public.knowledge_chunks AS kc
  INNER JOIN public.knowledge_bases AS kb
    ON kb.id = kc.kb_id
   AND kb.tenant_id = kc.tenant_id
  WHERE kc.tenant_id = p_tenant_id
    AND kb.is_active = true
    AND (1 - (kc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector(1536), float, int, uuid) TO authenticated;

COMMENT ON FUNCTION public.match_knowledge_chunks(vector(1536), float, int, uuid) IS
  'Tenant-scoped semantic search over active knowledge base chunks using cosine similarity.';
