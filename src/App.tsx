import WorkflowBuilder from './workflow/WorkflowBuilder.tsx';

export function App() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div>
          <h1 className="text-sm font-semibold tracking-wide text-slate-950">
            NARA - AI Agent Builder
          </h1>
          <p className="text-xs text-slate-500">
            Visual workflow builder for laundry automation
          </p>
        </div>
        <div className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">
          MVP
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <WorkflowBuilder />
      </main>
    </div>
  );
}

export default App;
