import { Medal } from 'lucide-react';

/** Médaille de classement (1 = or, 2 = argent, 3 = bronze). */
const STYLES: Record<number, { ring: string; bg: string; text: string; label: string }> = {
  1: { ring: 'ring-amber-300/60', bg: 'bg-gradient-to-br from-amber-300 to-amber-500', text: 'text-amber-950', label: 'Or' },
  2: { ring: 'ring-slate-300/50', bg: 'bg-gradient-to-br from-slate-200 to-slate-400', text: 'text-slate-900', label: 'Argent' },
  3: { ring: 'ring-orange-400/50', bg: 'bg-gradient-to-br from-orange-400 to-orange-700', text: 'text-orange-950', label: 'Bronze' },
};

/** Pastille ronde "médaille" : icône + #rang. `compact` pour un format réduit. */
export function RankMedal({ rank, compact = false }: { rank: 1 | 2 | 3; compact?: boolean }) {
  const s = STYLES[rank];
  return (
    <span
      title={`${s.label} — ${rank}${rank === 1 ? 'er' : 'e'} allure réelle`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-black shadow ring-2 ${s.ring} ${s.bg} ${s.text} ${
        compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
      }`}
    >
      <Medal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />#{rank}
    </span>
  );
}
