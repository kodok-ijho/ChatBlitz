export type UUID = string;
export type ISODateTimeString = string;
export type UnixTimestampSeconds = number;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Vector2D {
  x: number;
  y: number;
}

export enum SessionState {
  Init = 'INIT',
  InfoGathering = 'INFO_GATHERING',
  CalculatingPrice = 'CALCULATING_PRICE',
  AwaitingConfirmation = 'AWAITING_CONFIRMATION',
  OrderCreated = 'ORDER_CREATED',
  HumanHandoff = 'HUMAN_HANDOFF',
  Closed = 'CLOSED',
}

export enum OrderStatus {
  Draft = 'draft',
  Confirmed = 'confirmed',
  Processing = 'processing',
  Ready = 'ready',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

export enum PaymentStatus {
  Unpaid = 'unpaid',
  Partial = 'partial',
  Paid = 'paid',
}

export enum MessageDirection {
  Inbound = 'inbound',
  Outbound = 'outbound',
  System = 'system',
}

export type ChatMessageRole = 'user' | 'assistant';

export interface ExtractedOrderDetails {
  serviceType?: string;
  weightKg?: number;
  pricePerKg?: number;
  totalPrice?: number;
  pickupAddress?: string;
  notes?: string;
  preferredPickupTime?: ISODateTimeString;
}

export interface ChatSessionContext {
  customerName?: string;
  extractedOrderDetails?: ExtractedOrderDetails;
  lastIntent?: string;
  activeWorkflowId?: UUID;
  activeWorkflowVersion?: number;
  currentNodeId?: string;
  previousNodeId?: string;
  pendingToolCall?: ToolCallPayload;
  lastToolResult?: ToolCallResult;
  lastUserMessageId?: string;
  lastAssistantMessageId?: string;
  lastOrderId?: UUID;
  lastOrderCode?: string;
  paymentStatus?: PaymentStatus;
  handoffReason?: string;
  retryCount?: number;
  variables?: Record<string, JsonValue>;
  aiMemory?: Record<string, JsonValue>;
  metadata?: Record<string, JsonValue>;
}

export type WahaWebhookEventName =
  | 'message'
  | 'message.any'
  | 'message.reaction'
  | 'message.ack'
  | 'message.waiting'
  | 'message.revoked';

export type WahaEngine = 'WEBJS' | 'WPP' | 'NOWEB' | 'GOWS' | string;

export interface WahaWebhookMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface WahaMe {
  id: string;
  pushName?: string;
}

export interface WahaEnvironment {
  version?: string;
  engine?: WahaEngine;
  tier?: string;
  browser?: string;
  [key: string]: unknown;
}

export interface WahaMedia {
  url: string;
  mimetype?: string | null;
  filename?: string | null;
  error?: string | null;
}

export interface WahaReplyTo {
  id?: string;
  participant?: string;
  body?: string;
  hasMedia?: boolean;
  media?: WahaMedia | null;
  _data?: unknown;
}

export interface WahaMessagePayload {
  id: string;
  timestamp: UnixTimestampSeconds;
  from: string;
  fromMe?: boolean;
  to?: string;
  participant?: string;
  body?: string;
  hasMedia?: boolean;
  media?: WahaMedia | null;
  ack?: number;
  vCards?: unknown[];
  replyTo?: WahaReplyTo;
  source?: 'app' | 'api' | string;
  _data?: unknown;
}

export interface WahaReactionPayload extends Omit<WahaMessagePayload, 'body'> {
  reaction: {
    text: string;
    messageId: string;
  };
}

export interface WahaAckPayload extends WahaMessagePayload {
  ack: number;
}

export interface WahaRevokedPayload {
  before: {
    id: string;
    timestamp?: UnixTimestampSeconds | string;
    body?: string;
    _data?: unknown;
  };
  after: {
    id: string;
    timestamp?: UnixTimestampSeconds | string;
    body?: string;
    _data?: unknown;
  };
}

export interface WahaWebhookBase<TEvent extends WahaWebhookEventName, TPayload> {
  event: TEvent;
  session: string;
  payload: TPayload;
  metadata?: WahaWebhookMetadata;
  me?: WahaMe;
  engine?: WahaEngine;
  environment?: WahaEnvironment;
}

export type WahaMessageWebhookEvent = WahaWebhookBase<'message', WahaMessagePayload>;
export type WahaMessageAnyWebhookEvent = WahaWebhookBase<'message.any', WahaMessagePayload>;
export type WahaMessageReactionWebhookEvent = WahaWebhookBase<'message.reaction', WahaReactionPayload>;
export type WahaMessageAckWebhookEvent = WahaWebhookBase<'message.ack', WahaAckPayload>;
export type WahaMessageWaitingWebhookEvent = WahaWebhookBase<'message.waiting', WahaMessagePayload>;
export type WahaMessageRevokedWebhookEvent = WahaWebhookBase<'message.revoked', WahaRevokedPayload>;

export type WahaWebhookEvent =
  | WahaMessageWebhookEvent
  | WahaMessageAnyWebhookEvent
  | WahaMessageReactionWebhookEvent
  | WahaMessageAckWebhookEvent
  | WahaMessageWaitingWebhookEvent
  | WahaMessageRevokedWebhookEvent;

export enum WorkflowNodeType {
  Trigger = 'trigger',
  AI = 'ai',
  Condition = 'condition',
  KnowledgeBase = 'knowledge_base',
  Tool = 'tool',
  Order = 'order',
  HumanHandoff = 'human_handoff',
}

export enum WorkflowEdgeConditionOperator {
  Always = 'always',
  Equals = 'equals',
  NotEquals = 'not_equals',
  Contains = 'contains',
  GreaterThan = 'greater_than',
  LessThan = 'less_than',
  Exists = 'exists',
}

export interface WorkflowEdgeCondition {
  sourcePath?: string;
  operator: WorkflowEdgeConditionOperator;
  value?: JsonValue;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  condition?: WorkflowEdgeCondition;
  data?: Record<string, JsonValue>;
}

export interface BaseNodeData {
  label: string;
  description?: string;
  enabled?: boolean;
}

export interface TriggerNodeData extends BaseNodeData {
  type: WorkflowNodeType.Trigger;
  trigger: 'incoming_message' | 'manual' | 'session_state_changed';
  initialState?: SessionState;
}

export interface AINodeData extends BaseNodeData {
  type: WorkflowNodeType.AI;
  systemPrompt: string;
  userPromptTemplate?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  allowedTools?: WorkflowToolName[];
  outputVariable?: string;
  nextState?: SessionState;
}

export interface ConditionBranch {
  id: string;
  label: string;
  condition: WorkflowEdgeCondition;
}

export interface ConditionNodeData extends BaseNodeData {
  type: WorkflowNodeType.Condition;
  inputPath: string;
  branches: ConditionBranch[];
  defaultBranchId?: string;
}

export interface KnowledgeBaseNodeData extends BaseNodeData {
  type: WorkflowNodeType.KnowledgeBase;
  knowledgeBaseIds?: UUID[];
  queryTemplate: string;
  topK?: number;
  minSimilarity?: number;
  outputVariable?: string;
}

export interface ToolNodeData extends BaseNodeData {
  type: WorkflowNodeType.Tool;
  toolName: WorkflowToolName;
  inputMapping?: Record<string, string>;
  outputVariable?: string;
}

export interface OrderNodeData extends BaseNodeData {
  type: WorkflowNodeType.Order;
  action: 'create_order' | 'update_order' | 'quote_order';
  orderDetailsPath?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  outputVariable?: string;
}

export interface HumanHandoffNodeData extends BaseNodeData {
  type: WorkflowNodeType.HumanHandoff;
  reasonTemplate?: string;
  notifyChannel?: 'dashboard' | 'whatsapp' | 'email';
  nextState?: SessionState.HumanHandoff;
}

export type WorkflowNodeData =
  | TriggerNodeData
  | AINodeData
  | ConditionNodeData
  | KnowledgeBaseNodeData
  | ToolNodeData
  | OrderNodeData
  | HumanHandoffNodeData;

export interface WorkflowNode<TData extends WorkflowNodeData = WorkflowNodeData> {
  id: string;
  type: TData['type'];
  position: Vector2D;
  data: TData;
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
}

export interface WorkflowDag {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  version?: number;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  metadata?: Record<string, JsonValue>;
}

export type WorkflowToolName =
  | 'create_order'
  | 'update_order_payment'
  | 'search_knowledge_base'
  | 'handoff_to_human';

export interface CreateOrderToolArguments {
  customerId: UUID;
  serviceType?: string;
  weightKg?: number;
  pricePerKg?: number;
  totalPrice?: number;
  pickupAddress?: string;
  notes?: string;
  metadata?: Record<string, JsonValue>;
}

export interface UpdateOrderPaymentToolArguments {
  orderId?: UUID;
  orderCode?: string;
  paymentStatus: PaymentStatus;
  paidAmount?: number;
  metadata?: Record<string, JsonValue>;
}

export interface SearchKnowledgeBaseToolArguments {
  tenantId: UUID;
  query: string;
  knowledgeBaseIds?: UUID[];
  topK?: number;
  minSimilarity?: number;
}

export interface HandoffToHumanToolArguments {
  tenantId: UUID;
  sessionId: UUID;
  reason: string;
  summary?: string;
  metadata?: Record<string, JsonValue>;
}

export type ToolArgumentsByName = {
  create_order: CreateOrderToolArguments;
  update_order_payment: UpdateOrderPaymentToolArguments;
  search_knowledge_base: SearchKnowledgeBaseToolArguments;
  handoff_to_human: HandoffToHumanToolArguments;
};

export interface ToolCallPayload<TToolName extends WorkflowToolName = WorkflowToolName> {
  id: string;
  name: TToolName;
  arguments: ToolArgumentsByName[TToolName];
  tenantId?: UUID;
  sessionId?: UUID;
  customerId?: UUID;
  workflowNodeId?: string;
  requestedAt?: ISODateTimeString;
}

export interface ToolCallResult<TToolName extends WorkflowToolName = WorkflowToolName> {
  toolCallId: string;
  name: TToolName;
  ok: boolean;
  result?: JsonValue;
  error?: {
    code: string;
    message: string;
    details?: JsonValue;
  };
  completedAt?: ISODateTimeString;
}

export interface ToolDefinition<TToolName extends WorkflowToolName = WorkflowToolName> {
  name: TToolName;
  description: string;
  inputSchema: JsonObject;
}

export interface TenantRecord {
  id: UUID;
  owner_user_id: UUID;
  business_name: string;
  owner_name?: string | null;
  phone_e164?: string | null;
  timezone: string;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface WorkflowRecord {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description?: string | null;
  dag_json: WorkflowDag;
  version_number: number;
  status: 'draft' | 'published' | 'archived';
  is_active: boolean;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
  published_at?: ISODateTimeString | null;
}

export interface CustomerRecord {
  id: UUID;
  tenant_id: UUID;
  wa_phone_e164: string;
  display_name?: string | null;
  metadata: Record<string, JsonValue>;
  last_seen_at?: ISODateTimeString | null;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface ChatSessionRecord {
  id: UUID;
  tenant_id: UUID;
  customer_id: UUID;
  state: SessionState;
  context: ChatSessionContext;
  last_message_id?: string | null;
  locked_until?: ISODateTimeString | null;
  lock_owner?: string | null;
  last_interaction_at: ISODateTimeString;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface ChatMessageRecord {
  id: UUID;
  tenant_id: UUID;
  contact_jid: string;
  role: ChatMessageRole;
  content: string;
  created_at: ISODateTimeString;
}

export interface OrderRecord {
  id: UUID;
  tenant_id: UUID;
  customer_id: UUID;
  order_code: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  service_type?: string | null;
  weight_kg?: number | null;
  price_per_kg?: number | null;
  total_price: number;
  pickup_address?: string | null;
  notes?: string | null;
  metadata: Record<string, JsonValue>;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
  completed_at?: ISODateTimeString | null;
}

export interface KnowledgeBaseRecord {
  id: UUID;
  tenant_id: UUID;
  title: string;
  source_type: 'text' | 'url' | 'file';
  raw_content: string;
  is_active: boolean;
  created_at: ISODateTimeString;
  updated_at: ISODateTimeString;
}

export interface KnowledgeChunkRecord {
  id: UUID;
  tenant_id: UUID;
  kb_id: UUID;
  chunk_text: string;
  embedding: number[];
  created_at: ISODateTimeString;
}

export const typeExamples = {
  inboundWahaMessage: {
    event: 'message',
    session: 'default',
    payload: {
      id: 'true_6281234567890@c.us_ABCDEF',
      timestamp: 1710481111,
      from: '6281234567890@c.us',
      fromMe: false,
      to: '6289999999999@c.us',
      body: 'Halo, saya mau laundry 3 kg',
      hasMedia: false,
      ack: 1,
      vCards: [],
      _data: {},
    },
    engine: 'WEBJS',
    metadata: {
      tenantId: 'tenant-id',
    },
  } satisfies WahaMessageWebhookEvent,

  chatSessionContext: {
    customerName: 'Budi',
    extractedOrderDetails: {
      serviceType: 'regular',
      weightKg: 3,
    },
    lastIntent: 'create_laundry_order',
    currentNodeId: 'ai_collect_order_details',
    paymentStatus: PaymentStatus.Unpaid,
    variables: {
      confidence: 0.92,
    },
  } satisfies ChatSessionContext,

  workflowDag: {
    nodes: [
      {
        id: 'trigger_inbound_message',
        type: WorkflowNodeType.Trigger,
        position: { x: 0, y: 0 },
        data: {
          type: WorkflowNodeType.Trigger,
          label: 'Incoming WhatsApp Message',
          trigger: 'incoming_message',
          initialState: SessionState.Init,
        },
      },
      {
        id: 'ai_collect_order_details',
        type: WorkflowNodeType.AI,
        position: { x: 280, y: 0 },
        data: {
          type: WorkflowNodeType.AI,
          label: 'Collect Order Details',
          systemPrompt: 'Extract laundry order details from the customer message.',
          allowedTools: ['search_knowledge_base'],
          outputVariable: 'extractedOrderDetails',
          nextState: SessionState.InfoGathering,
        },
      },
      {
        id: 'condition_has_weight',
        type: WorkflowNodeType.Condition,
        position: { x: 560, y: 0 },
        data: {
          type: WorkflowNodeType.Condition,
          label: 'Has Weight?',
          inputPath: 'context.extractedOrderDetails.weightKg',
          branches: [
            {
              id: 'has_weight',
              label: 'Has weight',
              condition: {
                sourcePath: 'context.extractedOrderDetails.weightKg',
                operator: WorkflowEdgeConditionOperator.Exists,
              },
            },
          ],
          defaultBranchId: 'missing_weight',
        },
      },
      {
        id: 'order_create',
        type: WorkflowNodeType.Order,
        position: { x: 840, y: 0 },
        data: {
          type: WorkflowNodeType.Order,
          label: 'Create Order',
          action: 'create_order',
          orderDetailsPath: 'context.extractedOrderDetails',
          status: OrderStatus.Draft,
          paymentStatus: PaymentStatus.Unpaid,
          outputVariable: 'createdOrder',
        },
      },
    ],
    edges: [
      {
        id: 'edge_trigger_to_ai',
        source: 'trigger_inbound_message',
        target: 'ai_collect_order_details',
      },
      {
        id: 'edge_ai_to_condition',
        source: 'ai_collect_order_details',
        target: 'condition_has_weight',
      },
      {
        id: 'edge_condition_to_order',
        source: 'condition_has_weight',
        target: 'order_create',
        label: 'Ready',
        condition: {
          sourcePath: 'context.extractedOrderDetails.weightKg',
          operator: WorkflowEdgeConditionOperator.Exists,
        },
      },
    ],
    version: 1,
  } satisfies WorkflowDag,

  searchKnowledgeBaseToolCall: {
    id: 'toolcall_001',
    name: 'search_knowledge_base',
    arguments: {
      tenantId: 'tenant-id',
      query: 'Harga laundry regular per kg',
      topK: 5,
      minSimilarity: 0.7,
    },
    tenantId: 'tenant-id',
    sessionId: 'session-id',
    customerId: 'customer-id',
    workflowNodeId: 'ai_collect_order_details',
  } satisfies ToolCallPayload<'search_knowledge_base'>,

  unpaidPaymentStatus: PaymentStatus.Unpaid,
} as const;
