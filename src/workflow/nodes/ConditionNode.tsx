import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import {
  WorkflowEdgeConditionOperator,
  WorkflowNodeType,
  type ConditionBranch,
  type ConditionNodeData,
} from '../../../types.ts';

type ConditionReactFlowNode = Node<ConditionNodeData & Record<string, unknown>, WorkflowNodeType.Condition>;

const fallbackBranches: ConditionBranch[] = [
  {
    id: 'true',
    label: 'True',
    condition: {
      operator: WorkflowEdgeConditionOperator.Exists,
    },
  },
  {
    id: 'false',
    label: 'False',
    condition: {
      operator: WorkflowEdgeConditionOperator.NotEquals,
      value: null,
    },
  },
];

export function ConditionNode({ data, selected }: NodeProps<ConditionReactFlowNode>) {
  const branches = data.branches.length > 0 ? data.branches : fallbackBranches;

  return (
    <div
      className={[
        'relative w-72 rounded-lg border bg-amber-50 shadow-sm transition',
        selected ? 'border-amber-500 ring-2 ring-amber-200' : 'border-amber-200',
      ].join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-amber-500"
      />

      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-600 text-sm font-semibold text-white">
          IF
        </div>

        <div className="min-w-0">
          <div className="text-sm font-semibold leading-5 text-slate-900">
            {data.label}
          </div>
          <div className="mt-1 truncate text-xs leading-5 text-slate-600">
            {data.inputPath}
          </div>
        </div>
      </div>

      <div className="space-y-1 border-t border-amber-100 px-4 py-3">
        {branches.map((branch, index) => {
          const top = ((index + 1) / (branches.length + 1)) * 100;

          return (
            <div key={branch.id} className="relative rounded bg-white/70 px-2 py-1 text-xs text-slate-700">
              <span className="font-medium text-amber-800">{branch.label}</span>
              <Handle
                id={branch.id}
                type="source"
                position={Position.Right}
                style={{ top: `${top}%` }}
                className="!h-3 !w-3 !border-2 !border-white !bg-amber-500"
              />
            </div>
          );
        })}
      </div>

      <div className="border-t border-amber-100 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-amber-700">
        Condition Node
      </div>
    </div>
  );
}

export default ConditionNode;
