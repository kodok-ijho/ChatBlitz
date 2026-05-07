import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { WorkflowNodeType, type AINodeData } from '../../../types.ts';

type AIReactFlowNode = Node<AINodeData & Record<string, unknown>, WorkflowNodeType.AI>;

export function AINode({ data, selected }: NodeProps<AIReactFlowNode>) {
  const promptPreview = data.systemPrompt.length > 96
    ? `${data.systemPrompt.slice(0, 96)}...`
    : data.systemPrompt;

  return (
    <div
      className={[
        'w-72 rounded-lg border bg-sky-50 shadow-sm transition',
        selected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-sky-200',
      ].join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-sky-500"
      />

      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-600 text-sm font-semibold text-white">
          AI
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold leading-5 text-slate-900">
            {data.label}
          </div>
          <div className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">
            {promptPreview}
          </div>
        </div>
      </div>

      <div className="border-t border-sky-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-sky-700">
        AI Node
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-sky-500"
      />
    </div>
  );
}

export default AINode;
