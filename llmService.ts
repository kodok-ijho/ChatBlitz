import {
  type ChatSessionContext,
  type JsonObject,
  type ToolArgumentsByName,
  type ToolCallPayload,
  type ToolCallResult,
  type ToolDefinition,
  type WorkflowToolName,
} from './types.ts';

const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | string;

interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatMessage {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiChatCompletionChoice {
  index: number;
  finish_reason: FinishReason;
  message: {
    role: 'assistant';
    content?: string | null;
    tool_calls?: OpenAiToolCall[];
  };
}

interface OpenAiChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: OpenAiChatCompletionChoice[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

interface ChatCompletionOptions {
  allowToolCalls?: boolean;
}

export type LlmToolCall = ToolCallPayload;

export type LlmRouterResult =
  | {
      kind: 'text';
      text: string;
      finishReason: FinishReason;
      rawResponse: OpenAiChatCompletionResponse;
    }
  | {
      kind: 'tool_calls';
      toolCalls: LlmToolCall[];
      assistantToolCalls: OpenAiToolCall[];
      finishReason: 'tool_calls';
      rawResponse: OpenAiChatCompletionResponse;
    };

export async function callLlmRouter(
  sessionContext: ChatSessionContext,
  userMessage: string,
  systemPrompt: string,
  availableTools: ToolDefinition[],
): Promise<LlmRouterResult> {
  const messages: OpenAiChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: buildUserMessageWithContext(sessionContext, userMessage),
    },
  ];

  return callChatCompletions(messages, availableTools);
}

export async function callLlmRouterWithToolResults(
  sessionContext: ChatSessionContext,
  userMessage: string,
  systemPrompt: string,
  availableTools: ToolDefinition[],
  toolCalls: LlmToolCall[],
  toolResults: ToolCallResult[],
  options: ChatCompletionOptions = {},
): Promise<LlmRouterResult> {
  const assistantToolCalls = toolCalls.map(toOpenAiToolCall);
  const toolResultMessages = toolResults.map<OpenAiChatMessage>((toolResult) => ({
    role: 'tool',
    tool_call_id: toolResult.toolCallId,
    content: JSON.stringify(toolResult),
  }));

  const messages: OpenAiChatMessage[] = [
    {
      role: 'system',
      content: options.allowToolCalls === false
        ? buildFinalAnswerSystemPrompt(systemPrompt)
        : systemPrompt,
    },
    {
      role: 'user',
      content: buildUserMessageWithContext(sessionContext, userMessage),
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: assistantToolCalls,
    },
    ...toolResultMessages,
  ];

  return callChatCompletions(
    messages,
    options.allowToolCalls === false ? [] : availableTools,
  );
}

async function callChatCompletions(
  messages: OpenAiChatMessage[],
  availableTools: ToolDefinition[],
): Promise<LlmRouterResult> {
  const llmApiUrl = process.env.LLM_API_URL;
  const llmApiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;

  if (!llmApiUrl || !llmApiKey) {
    throw new Error('Missing LLM_API_URL or LLM_API_KEY environment variable');
  }

  const tools = availableTools.map(toOpenAiTool);
  const requestBody: Record<string, unknown> = {
    model,
    messages,
  };

  if (tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  const response = await fetch(llmApiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llmApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseJson = await parseJsonResponse(response);

  if (!response.ok) {
    const errorMessage = responseJson.error?.message ?? `LLM request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const firstChoice = responseJson.choices?.[0];

  if (!firstChoice) {
    throw new Error('LLM response did not include any choices');
  }

  if (firstChoice.finish_reason === 'tool_calls') {
    const assistantToolCalls = firstChoice.message.tool_calls ?? [];
    const toolCalls = assistantToolCalls.map(parseToolCall);

    return {
      kind: 'tool_calls',
      toolCalls,
      assistantToolCalls,
      finishReason: 'tool_calls',
      rawResponse: responseJson,
    };
  }

  return {
    kind: 'text',
    text: firstChoice.message.content ?? '',
    finishReason: firstChoice.finish_reason,
    rawResponse: responseJson,
  };
}

function toOpenAiTool(tool: ToolDefinition): OpenAiFunctionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function buildFinalAnswerSystemPrompt(systemPrompt: string): string {
  return [
    systemPrompt,
    '',
    'Anda sudah menerima hasil eksekusi tool pada pesan role "tool".',
    'Jangan panggil tool lagi.',
    'Jawab customer sekarang dengan teks final yang ringkas, natural, dan langsung memakai hasil tool tersebut.',
    'Jika hasil tool berisi error atau data tidak ditemukan, jelaskan secara singkat dan minta informasi lanjutan yang diperlukan.',
  ].join('\n');
}

function toOpenAiToolCall(toolCall: LlmToolCall): OpenAiToolCall {
  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function parseToolCall(toolCall: OpenAiToolCall): LlmToolCall {
  if (!isWorkflowToolName(toolCall.function.name)) {
    throw new Error(`LLM requested unsupported tool: ${toolCall.function.name}`);
  }

  const parsedArguments = parseToolArguments(toolCall.function.arguments);
  const normalizedArguments = normalizeToolArguments(toolCall.function.name, parsedArguments);

  return {
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: normalizedArguments as ToolArgumentsByName[typeof toolCall.function.name],
    requestedAt: new Date().toISOString(),
  } as LlmToolCall;
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) {
    return {};
  }

  const parsed: unknown = JSON.parse(rawArguments);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM tool arguments must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function normalizeToolArguments(
  toolName: WorkflowToolName,
  args: Record<string, unknown>,
): ToolArgumentsByName[WorkflowToolName] {
  if (toolName === 'search_knowledge_base' && typeof args.search_query === 'string' && typeof args.query !== 'string') {
    return {
      ...args,
      query: args.search_query,
    } as ToolArgumentsByName['search_knowledge_base'];
  }

  return args as unknown as ToolArgumentsByName[WorkflowToolName];
}

function isWorkflowToolName(value: string): value is WorkflowToolName {
  return value === 'create_order' ||
    value === 'update_order_payment' ||
    value === 'search_knowledge_base' ||
    value === 'handoff_to_human';
}

function buildUserMessageWithContext(sessionContext: ChatSessionContext, userMessage: string): string {
  const conversationHistoryText = getConversationHistoryText(sessionContext);
  const messageParts = [
    ...(conversationHistoryText
      ? [
          'Berikut adalah riwayat percakapan sebelumnya, urut dari paling lama ke paling baru:',
          conversationHistoryText,
          '',
        ]
      : []),
    'Catatan identitas customer:',
    '- Jika customer belum pernah memperkenalkan nama di riwayat chat atau pesan saat ini, tanyakan nama mereka pada saat greeting.',
    '- Jika customer pernah memperkenalkan nama di riwayat chat atau pesan saat ini, gunakan nama tersebut.',
    '- Jangan menganggap nama profil WhatsApp sebagai nama panggilan utama jika bertentangan dengan isi chat.',
    '- Jika ditanya "siapa nama saya?", jawab berdasarkan perkenalan eksplisit customer di chat.',
    '',
    `Pesan customer saat ini: ${userMessage}`,
    '',
    'Konteks sesi JSON:',
    JSON.stringify(buildSanitizedSessionContext(sessionContext)),
  ];

  return messageParts.join('\n');
}

function getConversationHistoryText(sessionContext: ChatSessionContext): string | undefined {
  const historyText = sessionContext.variables?.conversationHistoryText;

  if (typeof historyText === 'string' && historyText.trim().length > 0) {
    return historyText.trim();
  }

  return undefined;
}

function buildSanitizedSessionContext(sessionContext: ChatSessionContext): ChatSessionContext {
  const variables = { ...sessionContext.variables };
  delete variables.conversationHistory;
  delete variables.conversationHistoryText;

  return {
    ...sessionContext,
    variables,
  };
}

async function parseJsonResponse(response: Response): Promise<OpenAiChatCompletionResponse> {
  const parsed: unknown = await response.json();

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM response was not a JSON object');
  }

  return parsed as OpenAiChatCompletionResponse;
}
