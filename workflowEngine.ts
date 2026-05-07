import {
  SessionState,
  WorkflowEdgeConditionOperator,
  WorkflowNodeType,
  type AINodeData,
  type ChatSessionContext,
  type ConditionNodeData,
  type JsonValue,
  type ToolCallPayload,
  type ToolCallResult,
  type TriggerNodeData,
  type WorkflowDag,
  type WorkflowNode,
  type WorkflowNodeData,
} from './types.ts';
import { callLlmRouter, callLlmRouterWithToolResults } from './llmService.ts';
import { buildAvailableToolDefinitions, executeTool } from './toolExecutorService.ts';

export interface WorkflowStepOptions {
  tenantId?: string;
  userMessage?: string;
}

export interface WorkflowStepResult {
  ok: boolean;
  handledNodeId?: string;
  handledNodeType?: WorkflowNodeType;
  nextNodeId?: string;
  nextState?: SessionState;
  updatedContext: ChatSessionContext;
  logs: string[];
  replyText?: string;
  toolCalls?: ToolCallPayload[];
  toolResults?: ToolCallResult[];
  dummyResponse?: string;
}

export async function processWorkflowStep(
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
  options: WorkflowStepOptions = {},
): Promise<WorkflowStepResult> {
  const logs: string[] = [];
  const currentNode = resolveCurrentNode(sessionContext, currentDag);

  if (!currentNode) {
    logs.push('No workflow node found. Returning context unchanged.');

    return {
      ok: false,
      updatedContext: sessionContext,
      logs,
      replyText: 'Workflow belum tersedia.',
      dummyResponse: 'No workflow node available.',
    };
  }

  logs.push(`Processing workflow node ${currentNode.id} (${currentNode.type}).`);

  switch (currentNode.type) {
    case WorkflowNodeType.Trigger:
      return handleTriggerNode(currentNode as WorkflowNode<TriggerNodeData>, sessionContext, currentDag, logs);

    case WorkflowNodeType.AI:
      return handleAINode(currentNode as WorkflowNode<AINodeData>, sessionContext, currentDag, logs, options);

    case WorkflowNodeType.Condition:
      return handleConditionNode(currentNode as WorkflowNode<ConditionNodeData>, sessionContext, currentDag, logs);

    default:
      logs.push(`Node type ${currentNode.type} is not implemented in the MVP dispatcher.`);

      return {
        ok: true,
        handledNodeId: currentNode.id,
        handledNodeType: currentNode.type,
        updatedContext: {
          ...sessionContext,
          previousNodeId: sessionContext.currentNodeId,
          currentNodeId: currentNode.id,
        },
        logs,
        replyText: undefined,
        dummyResponse: `MVP dispatcher skipped ${currentNode.type} node.`,
      };
  }
}

function resolveCurrentNode(
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
): WorkflowNode<WorkflowNodeData> | undefined {
  if (sessionContext.currentNodeId) {
    const explicitNode = currentDag.nodes.find((node) => node.id === sessionContext.currentNodeId);

    if (explicitNode) {
      return explicitNode;
    }
  }

  return currentDag.nodes.find((node) => node.type === WorkflowNodeType.Trigger);
}

function handleTriggerNode(
  node: WorkflowNode<TriggerNodeData>,
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
  logs: string[],
): WorkflowStepResult {
  const nextNodeId = findFirstNextNodeId(currentDag, node.id);

  logs.push('Trigger node accepted inbound webhook event.');

  return {
    ok: true,
    handledNodeId: node.id,
    handledNodeType: WorkflowNodeType.Trigger,
    nextNodeId,
    nextState: node.data.initialState ?? SessionState.Init,
    updatedContext: {
      ...sessionContext,
      previousNodeId: sessionContext.currentNodeId,
      currentNodeId: nextNodeId ?? node.id,
    },
    logs,
    dummyResponse: 'Trigger handled. Workflow is ready for the next node.',
  };
}

async function handleAINode(
  node: WorkflowNode<AINodeData>,
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
  logs: string[],
  options: WorkflowStepOptions,
): Promise<WorkflowStepResult> {
  const nextNodeId = findFirstNextNodeId(currentDag, node.id);
  const nextState = node.data.nextState ?? SessionState.InfoGathering;
  const userMessage = options.userMessage ?? extractUserMessageFromContext(sessionContext);
  const availableTools = buildAvailableToolDefinitions(node.data.allowedTools);
  const systemPrompt = buildLaundrySystemPrompt(node.data.systemPrompt);

  logs.push('AI node reached. Calling LLM router.');

  const firstLlmResult = await callLlmRouter(sessionContext, userMessage, systemPrompt, availableTools);

  if (firstLlmResult.kind === 'text') {
    logs.push(`LLM returned text with finish reason ${firstLlmResult.finishReason}.`);

    return {
      ok: true,
      handledNodeId: node.id,
      handledNodeType: WorkflowNodeType.AI,
      nextNodeId,
      nextState,
      updatedContext: {
        ...sessionContext,
        previousNodeId: sessionContext.currentNodeId,
        currentNodeId: nextNodeId ?? node.id,
        variables: {
          ...sessionContext.variables,
          lastLlmFinishReason: firstLlmResult.finishReason,
        },
      },
      logs,
      replyText: firstLlmResult.text,
    };
  }

  if (!options.tenantId) {
    logs.push('LLM requested tool calls, but tenantId was not supplied to workflow engine.');

    return {
      ok: false,
      handledNodeId: node.id,
      handledNodeType: WorkflowNodeType.AI,
      nextNodeId,
      nextState,
      updatedContext: {
        ...sessionContext,
        pendingToolCall: firstLlmResult.toolCalls[0],
      },
      logs,
      toolCalls: firstLlmResult.toolCalls,
      replyText: 'Maaf, sistem belum bisa menjalankan tool karena tenant belum teridentifikasi.',
    };
  }

  logs.push(`LLM requested ${firstLlmResult.toolCalls.length} tool call(s).`);

  const toolResults = await Promise.all(
    firstLlmResult.toolCalls.map((toolCall) => executeTool(toolCall, options.tenantId as string)),
  );

  logs.push('Tool execution completed. Calling LLM router again for final reply.');

  const finalLlmResult = await callLlmRouterWithToolResults(
    sessionContext,
    userMessage,
    systemPrompt,
    availableTools,
    firstLlmResult.toolCalls,
    toolResults,
    { allowToolCalls: false },
  );

  const replyText = finalLlmResult.kind === 'text' && finalLlmResult.text.trim().length > 0
    ? finalLlmResult.text
    : buildReplyFromToolResults(toolResults);

  return {
    ok: true,
    handledNodeId: node.id,
    handledNodeType: WorkflowNodeType.AI,
    nextNodeId,
    nextState,
    updatedContext: {
      ...sessionContext,
      previousNodeId: sessionContext.currentNodeId,
      currentNodeId: nextNodeId ?? node.id,
      pendingToolCall: undefined,
      lastToolResult: toolResults[toolResults.length - 1],
      variables: {
        ...sessionContext.variables,
        lastLlmFinishReason: finalLlmResult.finishReason,
      },
    },
    logs,
    replyText,
    toolCalls: firstLlmResult.toolCalls,
    toolResults,
  };
}

function buildReplyFromToolResults(toolResults: ToolCallResult[]): string {
  const successfulRagResult = toolResults.find((toolResult) =>
    toolResult.name === 'search_knowledge_base' &&
    toolResult.ok &&
    isRecord(toolResult.result) &&
    typeof toolResult.result.answer === 'string' &&
    toolResult.result.answer.trim().length > 0,
  );

  if (
    successfulRagResult &&
    isRecord(successfulRagResult.result) &&
    typeof successfulRagResult.result.answer === 'string'
  ) {
    return successfulRagResult.result.answer.trim();
  }

  const successfulOrderResult = toolResults.find((toolResult) =>
    toolResult.name === 'create_order' &&
    toolResult.ok &&
    isRecord(toolResult.result),
  );

  if (successfulOrderResult && isRecord(successfulOrderResult.result)) {
    const orderCode = typeof successfulOrderResult.result.orderCode === 'string'
      ? successfulOrderResult.result.orderCode
      : undefined;

    return orderCode
      ? `Order laundry sudah saya buat dengan kode ${orderCode}.`
      : 'Order laundry sudah saya buat.';
  }

  const firstError = toolResults.find((toolResult) => !toolResult.ok)?.error;

  if (firstError) {
    return `Maaf, saya belum bisa memproses data itu sekarang. ${firstError.message}`;
  }

  return 'Maaf, saya belum menemukan informasi yang cukup untuk menjawab. Bisa jelaskan kebutuhan laundry Anda lebih detail?';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function handleConditionNode(
  node: WorkflowNode<ConditionNodeData>,
  sessionContext: ChatSessionContext,
  currentDag: WorkflowDag,
  logs: string[],
): WorkflowStepResult {
  const matchedBranch = node.data.branches.find((branch) => evaluateCondition(sessionContext, branch.condition));
  const outgoingEdges = currentDag.edges.filter((edge) => edge.source === node.id);
  const nextNodeId =
    outgoingEdges.find((edge) => edge.sourceHandle === matchedBranch?.id)?.target ??
    outgoingEdges.find((edge) => edge.label === matchedBranch?.label)?.target ??
    outgoingEdges[0]?.target;

  logs.push(
    matchedBranch
      ? `Condition matched branch ${matchedBranch.id}.`
      : 'Condition did not match a branch. Falling back to first outgoing edge.',
  );

  return {
    ok: true,
    handledNodeId: node.id,
    handledNodeType: WorkflowNodeType.Condition,
    nextNodeId,
    updatedContext: {
      ...sessionContext,
      previousNodeId: sessionContext.currentNodeId,
      currentNodeId: nextNodeId ?? node.id,
      variables: {
        ...sessionContext.variables,
        lastConditionBranchId: matchedBranch?.id ?? node.data.defaultBranchId ?? null,
      },
    },
    logs,
    dummyResponse: 'Condition node evaluated with MVP branch logic.',
  };
}

function buildLaundrySystemPrompt(nodeSystemPrompt: string): string {
  return [
    'Anda adalah customer service laundry yang ramah, ringkas, dan akurat.',
    'Gunakan Bahasa Indonesia yang natural.',
    'Jika butuh data harga, layanan, kebijakan, atau FAQ, gunakan tool search_knowledge_base.',
    'Jika detail order sudah cukup, gunakan tool create_order untuk membuat draft order.',
    'Jangan mengarang harga atau kebijakan jika belum ada konteks dari knowledge base.',
    '',
    'Instruksi workflow node:',
    nodeSystemPrompt,
  ].join('\n');
}

function extractUserMessageFromContext(sessionContext: ChatSessionContext): string {
  const candidate = sessionContext.variables?.lastUserMessageText;

  if (typeof candidate === 'string') {
    return candidate;
  }

  return '';
}

function findFirstNextNodeId(currentDag: WorkflowDag, nodeId: string): string | undefined {
  return currentDag.edges.find((edge) => edge.source === nodeId)?.target;
}

function evaluateCondition(
  sessionContext: ChatSessionContext,
  condition: {
    sourcePath?: string;
    operator: WorkflowEdgeConditionOperator;
    value?: JsonValue;
  },
): boolean {
  const actualValue = getValueByPath({ context: sessionContext }, condition.sourcePath);

  switch (condition.operator) {
    case WorkflowEdgeConditionOperator.Always:
      return true;

    case WorkflowEdgeConditionOperator.Exists:
      return actualValue !== undefined && actualValue !== null;

    case WorkflowEdgeConditionOperator.Equals:
      return actualValue === condition.value;

    case WorkflowEdgeConditionOperator.NotEquals:
      return actualValue !== condition.value;

    case WorkflowEdgeConditionOperator.Contains:
      return typeof actualValue === 'string' &&
        typeof condition.value === 'string' &&
        actualValue.includes(condition.value);

    case WorkflowEdgeConditionOperator.GreaterThan:
      return typeof actualValue === 'number' &&
        typeof condition.value === 'number' &&
        actualValue > condition.value;

    case WorkflowEdgeConditionOperator.LessThan:
      return typeof actualValue === 'number' &&
        typeof condition.value === 'number' &&
        actualValue < condition.value;

    default:
      return false;
  }
}

function getValueByPath(source: unknown, path: string | undefined): unknown {
  if (!path) {
    return undefined;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);
}
