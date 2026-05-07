import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { WorkflowNodeType, type TriggerNodeData } from '../../../types.ts';

type TriggerReactFlowNode = Node<TriggerNodeData & Record<string, unknown>, WorkflowNodeType.Trigger>;

export function TriggerNode({ data, selected }: NodeProps<TriggerReactFlowNode>) {
  return (
    <div
      className={[
        'w-64 rounded-lg border bg-emerald-50 shadow-sm transition',
        selected ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-emerald-200',
      ].join(' ')}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white">
          IN
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold leading-5 text-slate-900">
            {data.label}
          </div>
          <div className="mt-1 rounded bg-white/70 px-2 py-1 text-xs font-medium text-emerald-700">
            {data.trigger}
          </div>
        </div>
      </div>

      <div className="border-t border-emerald-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-emerald-700">
        Trigger Node
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500"
      />
    </div>
  );
}

export default TriggerNode;
