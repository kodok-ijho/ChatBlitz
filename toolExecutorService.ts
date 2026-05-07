import { randomUUID } from 'node:crypto';

import { generateEmbedding } from './embeddingService.ts';
import { getSupabaseAdminClient } from './sessionService.ts';
import {
  PaymentStatus,
  type CreateOrderToolArguments,
  type JsonObject,
  type JsonValue,
  type SearchKnowledgeBaseToolArguments,
  type ToolCallPayload,
  type ToolCallResult,
  type ToolDefinition,
  type WorkflowToolName,
} from './types.ts';

type SearchKnowledgeBaseArgumentsWithAlias = SearchKnowledgeBaseToolArguments & {
  search_query?: string;
};

interface KnowledgeChunkMatch {
  chunk_text?: string;
  content?: string;
  similarity?: number;
  kb_id?: string;
  id?: string;
}

const ALL_TOOL_DEFINITIONS: Record<WorkflowToolName, ToolDefinition> = {
  create_order: {
    name: 'create_order',
    description: 'Create a laundry order draft from extracted customer order details.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        serviceType: { type: 'string' },
        weightKg: { type: 'number' },
        pricePerKg: { type: 'number' },
        totalPrice: { type: 'number' },
        pickupAddress: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['customerId'],
      additionalProperties: true,
    },
  },
  update_order_payment: {
    name: 'update_order_payment',
    description: 'Update payment status for an existing laundry order.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        orderCode: { type: 'string' },
        paymentStatus: {
          type: 'string',
          enum: [PaymentStatus.Unpaid, PaymentStatus.Partial, PaymentStatus.Paid],
        },
        paidAmount: { type: 'number' },
      },
      required: ['paymentStatus'],
      additionalProperties: true,
    },
  },
  search_knowledge_base: {
    name: 'search_knowledge_base',
    description: 'Search tenant laundry knowledge base for pricing, services, policy, or FAQ answers.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        query: { type: 'string' },
        search_query: { type: 'string' },
        knowledgeBaseIds: {
          type: 'array',
          items: { type: 'string' },
        },
        topK: { type: 'number' },
        minSimilarity: { type: 'number' },
      },
      required: ['query'],
      additionalProperties: true,
    },
  },
  handoff_to_human: {
    name: 'handoff_to_human',
    description: 'Escalate the session to a human operator with a concise reason and optional summary.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        sessionId: { type: 'string' },
        reason: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['tenantId', 'sessionId', 'reason'],
      additionalProperties: true,
    },
  },
};

export function buildAvailableToolDefinitions(allowedTools?: WorkflowToolName[]): ToolDefinition[] {
  const toolNames = allowedTools && allowedTools.length > 0
    ? allowedTools
    : (Object.keys(ALL_TOOL_DEFINITIONS) as WorkflowToolName[]);

  return toolNames.map((toolName) => ALL_TOOL_DEFINITIONS[toolName]);
}

export async function executeTool(
  toolCall: ToolCallPayload,
  tenantId: string,
): Promise<ToolCallResult> {
  try {
    switch (toolCall.name) {
      case 'create_order':
        return executeCreateOrder(toolCall as ToolCallPayload<'create_order'>);

      case 'search_knowledge_base':
        return executeSearchKnowledgeBase(toolCall as ToolCallPayload<'search_knowledge_base'>, tenantId);

      case 'update_order_payment':
      case 'handoff_to_human':
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          ok: false,
          error: {
            code: 'TOOL_NOT_IMPLEMENTED',
            message: `Tool ${toolCall.name} is registered but not implemented in Tahap 4.`,
          },
          completedAt: new Date().toISOString(),
        };
    }
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      ok: false,
      error: {
        code: 'TOOL_EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown tool execution error',
      },
      completedAt: new Date().toISOString(),
    };
  }
}

function executeCreateOrder(toolCall: ToolCallPayload<'create_order'>): ToolCallResult<'create_order'> {
  const args = toolCall.arguments as CreateOrderToolArguments;
  const orderCode = `ORD-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  return {
    toolCallId: toolCall.id,
    name: 'create_order',
    ok: true,
    result: removeUndefinedValues({
      orderCode,
      status: 'draft',
      paymentStatus: PaymentStatus.Unpaid,
      customerId: args.customerId,
      serviceType: args.serviceType,
      weightKg: args.weightKg,
      pricePerKg: args.pricePerKg,
      totalPrice: args.totalPrice,
      pickupAddress: args.pickupAddress,
      notes: args.notes,
      message: 'Dummy order created successfully. Real database order insert will be added in the next phase.',
    }),
    completedAt: new Date().toISOString(),
  };
}

async function executeSearchKnowledgeBase(
  toolCall: ToolCallPayload<'search_knowledge_base'>,
  tenantId: string,
): Promise<ToolCallResult<'search_knowledge_base'>> {
  const args = toolCall.arguments as SearchKnowledgeBaseArgumentsWithAlias;
  const query = args.query ?? args.search_query;

  if (!query) {
    return {
      toolCallId: toolCall.id,
      name: 'search_knowledge_base',
      ok: false,
      error: {
        code: 'MISSING_QUERY',
        message: 'search_knowledge_base requires query or search_query.',
      },
      completedAt: new Date().toISOString(),
    };
  }

  const supabase = getSupabaseAdminClient();
  const queryEmbedding = await generateEmbedding(query);
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: queryEmbedding,
    match_threshold: args.minSimilarity ?? 0.7,
    match_count: args.topK ?? 5,
    p_tenant_id: tenantId,
  });

  if (error) {
    return {
      toolCallId: toolCall.id,
      name: 'search_knowledge_base',
      ok: false,
      error: {
        code: 'RAG_RPC_ERROR',
        message: error.message,
      },
      completedAt: new Date().toISOString(),
    };
  }

  const matches = Array.isArray(data) ? (data as KnowledgeChunkMatch[]) : [];
  const answer = matches
    .map((match) => match.chunk_text ?? match.content)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n\n');

  return {
    toolCallId: toolCall.id,
    name: 'search_knowledge_base',
    ok: true,
    result: {
      query,
      matchesFound: matches.length,
      answer: answer || 'Tidak ada knowledge chunk yang cocok. Ini fallback dummy RAG Tahap 4.',
    },
    completedAt: new Date().toISOString(),
  };
}

function removeUndefinedValues(values: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}
