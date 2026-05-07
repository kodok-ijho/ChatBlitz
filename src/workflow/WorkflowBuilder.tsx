import { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { WorkflowNodeType } from '../../types.ts';
import { useWorkflowStore } from './store.ts';
import AINode from './nodes/AINode.tsx';
import ConditionNode from './nodes/ConditionNode.tsx';
import TriggerNode from './nodes/TriggerNode.tsx';
import NodeInspector from './inspector/NodeInspector.tsx';

const WORKFLOW_API_URL = 'http://localhost:3001/api/workflows';
const MVP_TENANT_ID = import.meta.env.VITE_MVP_TENANT_ID ?? 'dummy-tenant-id-untuk-mvp';

export function WorkflowBuilder() {
  const [isSaving, setIsSaving] = useState(false);
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange);
  const onConnect = useWorkflowStore((state) => state.onConnect);
  const setSelectedNodeId = useWorkflowStore((state) => state.setSelectedNodeId);

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      [WorkflowNodeType.Trigger]: TriggerNode,
      [WorkflowNodeType.AI]: AINode,
      [WorkflowNodeType.Condition]: ConditionNode,
    }),
    [],
  );

  const handleSaveWorkflow = async () => {
    const dagJson = useWorkflowStore.getState().exportDag();

    setIsSaving(true);

    console.log("Tenant ID di env:", import.meta.env.VITE_MVP_TENANT_ID);
    console.log("URL API:", WORKFLOW_API_URL);
    try {
      const response = await fetch(WORKFLOW_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: import.meta.env.VITE_MVP_TENANT_ID, // <-- Ubah di sini
          dagJson,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Workflow save failed with status ${response.status}`);
      }

      alert('Workflow tersimpan!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gagal menyimpan workflow';
      console.error('Failed to save workflow:', message);
      alert('Gagal menyimpan workflow. Pastikan backend berjalan dan tenantId valid.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectionChange = ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    setSelectedNodeId(selectedNodes[0]?.id);
  };

  return (
    <div className="flex h-full w-full bg-slate-100">
      <main className="min-w-0 flex-1">
        <ReactFlow
          nodes={nodes as unknown as Node[]}
          edges={edges as unknown as Edge[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={handleSelectionChange}
          fitView
          defaultEdgeOptions={{
            animated: true,
            type: 'smoothstep',
          }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />

          <Panel position="top-right">
            <button
              type="button"
              onClick={handleSaveWorkflow}
              disabled={isSaving}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isSaving ? 'Saving...' : 'Save Workflow'}
            </button>
          </Panel>
        </ReactFlow>
      </main>

      <NodeInspector />
    </div>
  );
}

export default WorkflowBuilder;
