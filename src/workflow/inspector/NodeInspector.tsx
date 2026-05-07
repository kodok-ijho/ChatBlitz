import {
  WorkflowNodeType,
  type AINodeData,
  type ConditionNodeData,
  type TriggerNodeData,
} from '../../../types.ts';
import { useWorkflowStore } from '../store.ts';

export function NodeInspector() {
  const nodes = useWorkflowStore((state) => state.nodes);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <aside className="flex h-full w-80 shrink-0 border-l border-slate-200 bg-white p-5">
        <div className="m-auto text-center text-sm leading-6 text-slate-500">
          Pilih node untuk mengedit
        </div>
      </aside>
    );
  }

  return (
    <aside className="h-full w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Node Inspector
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-slate-900">
          {selectedNode.id}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {selectedNode.type === WorkflowNodeType.AI ? (
          <AINodeForm
            data={selectedNode.data as AINodeData}
            onChange={(data) => updateNodeData<AINodeData>(selectedNode.id, data)}
          />
        ) : null}

        {selectedNode.type === WorkflowNodeType.Trigger ? (
          <TriggerNodeForm
            data={selectedNode.data as TriggerNodeData}
            onChange={(data) => updateNodeData<TriggerNodeData>(selectedNode.id, data)}
          />
        ) : null}

        {selectedNode.type === WorkflowNodeType.Condition ? (
          <ConditionNodeForm
            data={selectedNode.data as ConditionNodeData}
            onChange={(data) => updateNodeData<ConditionNodeData>(selectedNode.id, data)}
          />
        ) : null}
      </div>
    </aside>
  );
}

interface FormProps<TData> {
  data: TData;
  onChange: (data: Partial<TData>) => void;
}

function AINodeForm({ data, onChange }: FormProps<AINodeData>) {
  return (
    <div className="space-y-4">
      <TextField
        label="Label"
        value={data.label}
        onChange={(value) => onChange({ label: value })}
      />
      <TextAreaField
        label="System Prompt"
        value={data.systemPrompt}
        rows={10}
        onChange={(value) => onChange({ systemPrompt: value })}
      />
    </div>
  );
}

function TriggerNodeForm({ data, onChange }: FormProps<TriggerNodeData>) {
  return (
    <div className="space-y-4">
      <TextField
        label="Label"
        value={data.label}
        onChange={(value) => onChange({ label: value })}
      />
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Trigger Mode</span>
        <select
          value={data.trigger}
          onChange={(event) => onChange({ trigger: event.target.value as TriggerNodeData['trigger'] })}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        >
          <option value="incoming_message">Incoming Message</option>
          <option value="manual">Manual</option>
          <option value="session_state_changed">Session State Changed</option>
        </select>
      </label>
    </div>
  );
}

function ConditionNodeForm({ data, onChange }: FormProps<ConditionNodeData>) {
  return (
    <div className="space-y-4">
      <TextField
        label="Label"
        value={data.label}
        onChange={(value) => onChange({ label: value })}
      />
      <TextField
        label="Input Path"
        value={data.inputPath}
        onChange={(value) => onChange({ inputPath: value })}
      />
      <div>
        <div className="text-xs font-medium text-slate-600">Branches</div>
        <div className="mt-2 space-y-2">
          {data.branches.map((branch) => (
            <div key={branch.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-sm font-medium text-slate-900">{branch.label}</div>
              <div className="mt-1 text-xs text-slate-500">{branch.condition.operator}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TextField({ label, value, onChange }: TextFieldProps) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      />
    </label>
  );
}

interface TextAreaFieldProps extends TextFieldProps {
  rows: number;
}

function TextAreaField({ label, value, rows, onChange }: TextAreaFieldProps) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      />
    </label>
  );
}

export default NodeInspector;
