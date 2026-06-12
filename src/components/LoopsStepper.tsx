import { Minus, Plus } from 'lucide-react';

/** Nombre de boucles effectuées dans le run qu'on valide (défaut 1). */
export function LoopsStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        aria-label="un tour de moins"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 disabled:opacity-30"
      >
        <Minus className="h-5 w-5" />
      </button>
      <div className="w-12 text-center">
        <div className="text-2xl font-bold tnum">{value}</div>
        <div className="text-[10px] uppercase text-slate-400">tour{value > 1 ? 's' : ''}</div>
      </div>
      <button
        onClick={() => onChange(Math.min(6, value + 1))}
        disabled={value >= 6}
        aria-label="un tour de plus"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 disabled:opacity-30"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
