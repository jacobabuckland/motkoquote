alter table knowledge_chunks add column source_id uuid;
create index knowledge_chunks_source_idx on knowledge_chunks (contractor_id, source_type, source_id);

create or replace function match_knowledge_chunks(
  p_contractor_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 3
)
returns table (id uuid, content text, similarity float)
language sql stable
as $$
  select id, content, 1 - (embedding <=> p_query_embedding) as similarity
  from knowledge_chunks
  where contractor_id = p_contractor_id
  order by embedding <=> p_query_embedding
  limit p_match_count;
$$;
