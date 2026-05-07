import type { Request, Response } from 'express';

import { getSupabaseAdminClient } from './sessionService.ts';
import type { UUID, WorkflowDag, WorkflowRecord } from './types.ts';

interface SaveWorkflowRequestBody {
  tenantId?: UUID;
  dagJson?: WorkflowDag;
  name?: string;
  description?: string | null;
}

interface ExistingActiveWorkflow {
  id: UUID;
  version_number: number;
}

export async function saveWorkflow(
  req: Request<unknown, unknown, SaveWorkflowRequestBody>,
  res: Response,
): Promise<void> {
  const { tenantId, dagJson, name, description } = req.body;

  if (!tenantId || typeof tenantId !== 'string') {
    res.status(400).json({ ok: false, error: 'tenantId is required' });
    return;
  }

  if (!isWorkflowDag(dagJson)) {
    res.status(400).json({ ok: false, error: 'dagJson must contain nodes and edges arrays' });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const workflowName = name?.trim() || 'MVP WhatsApp Workflow';

    const { data: activeWorkflow, error: findError } = await supabase
      .from('workflows')
      .select('id, version_number')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();

    if (findError) {
      throw new Error(`Failed to find active workflow: ${findError.message}`);
    }

    if (activeWorkflow) {
      const existing = activeWorkflow as ExistingActiveWorkflow;
      const { data, error } = await supabase
        .from('workflows')
        .update({
          name: workflowName,
          description: description ?? null,
          dag_json: dagJson,
          version_number: existing.version_number + 1,
          status: 'published',
          is_active: true,
          published_at: nowIso,
          updated_at: nowIso,
        })
        .eq('tenant_id', tenantId)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        throw new Error(`Failed to update workflow: ${error.message}`);
      }

      res.status(200).json({ ok: true, workflow: data as WorkflowRecord });
      return;
    }

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        tenant_id: tenantId,
        name: workflowName,
        description: description ?? null,
        dag_json: dagJson,
        version_number: 1,
        status: 'published',
        is_active: true,
        published_at: nowIso,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to insert workflow: ${error.message}`);
    }

    res.status(200).json({ ok: true, workflow: data as WorkflowRecord });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown workflow save error';
    res.status(500).json({ ok: false, error: message });
  }
}

function isWorkflowDag(value: unknown): value is WorkflowDag {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkflowDag>;
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
}
