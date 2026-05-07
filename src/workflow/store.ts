import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';

import {
  WorkflowNodeType,
  type AINodeData,
  type ConditionNodeData,
  type TriggerNodeData,
  type WorkflowDag,
  type WorkflowEdge,
  type WorkflowEdgeCondition,
  WorkflowEdgeConditionOperator,
  type WorkflowNode,
  type WorkflowNodeData,
} from '../../types.ts';

type ReactFlowWorkflowNode = Node<Record<string, unknown>, string>;
type ReactFlowWorkflowEdge = Edge<Record<string, unknown>>;

const initialAINodeData: AINodeData = {
  type: WorkflowNodeType.AI,
  label: 'AI Customer Service',
  systemPrompt: 'Tanyakan kebutuhan laundry pelanggan dan bantu buat order jika detail sudah lengkap.',
  allowedTools: ['search_knowledge_base', 'create_order'],
};

const initialTriggerNodeData: TriggerNodeData = {
  type: WorkflowNodeType.Trigger,
  label: 'Pesan WhatsApp Masuk',
  trigger: 'incoming_message',
};

const hasOrderDetailsCondition: WorkflowEdgeCondition = {
  sourcePath: 'context.extractedOrderDetails.weightKg',
  operator: WorkflowEdgeConditionOperator.Exists,
};

const initialConditionNodeData: ConditionNodeData = {
  type: WorkflowNodeType.Condition,
  label: 'Detail Order Lengkap?',
  inputPath: 'context.extractedOrderDetails.weightKg',
  branches: [
    {
      id: 'true',
      label: 'True',
      condition: hasOrderDetailsCondition,
    },
    {
      id: 'false',
      label: 'False',
      condition: {
        sourcePath: 'context.extractedOrderDetails.weightKg',
        operator: WorkflowEdgeConditionOperator.NotEquals,
        value: null,
      },
    },
  ],
  defaultBranchId: 'false',
};

const initialNodes: WorkflowNode[] = [
  {
    id: 'trigger_inbound_message',
    type: WorkflowNodeType.Trigger,
    position: { x: 80, y: 140 },
    data: initialTriggerNodeData,
  },
  {
    id: 'ai_customer_service',
    type: WorkflowNodeType.AI,
    position: { x: 400, y: 120 },
    data: initialAINodeData,
  },
  {
    id: 'condition_order_details',
    type: WorkflowNodeType.Condition,
    position: { x: 760, y: 130 },
    data: initialConditionNodeData,
  },
];

const initialEdges: WorkflowEdge[] = [
  {
    id: 'edge_trigger_to_ai',
    source: 'trigger_inbound_message',
    target: 'ai_customer_service',
  },
  {
    id: 'edge_ai_to_condition',
    source: 'ai_customer_service',
    target: 'condition_order_details',
  },
];

interface WorkflowStore {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId?: string;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  setSelectedNodeId: (nodeId?: string) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  updateNodeData: <TData extends WorkflowNodeData>(nodeId: string, data: Partial<TData>) => void;
  exportDag: () => WorkflowDag;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  selectedNodeId: undefined,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(
        changes,
        state.nodes as unknown as ReactFlowWorkflowNode[],
      ) as unknown as WorkflowNode[],
    }));
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(
        changes,
        state.edges as unknown as ReactFlowWorkflowEdge[],
      ) as unknown as WorkflowEdge[],
    }));
  },

  onConnect: (connection) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: `edge_${connection.source}_${connection.target}_${Date.now()}`,
          type: 'smoothstep',
          animated: true,
        },
        state.edges as unknown as ReactFlowWorkflowEdge[],
      ) as unknown as WorkflowEdge[],
    }));
  },

  updateNodeData: (nodeId, data) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            ...data,
          } as WorkflowNodeData,
        } as WorkflowNode;
      }),
    }));
  },

  exportDag: () => {
    const { nodes, edges } = get();

    return {
      nodes,
      edges,
      version: 1,
      metadata: {
        exportedAt: new Date().toISOString(),
      },
    };
  },
}));
