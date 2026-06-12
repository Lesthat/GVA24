import { useState } from 'react';
import { parisWallToUtcIso, fmtTimeHMS } from '../lib/time';

interface Props {
  label: string;
  valueIso: string | null | undefined;
  /**
   * Référence pour résoudre la date (la course chevauche deux jours).
   * Si un temps réel existe déjà (valueIso), c'est lui qui sert de référence :
   * une correction reste sur le même jour que la valeur corrigée.
   */
  refIso: string;
  onSave: (iso: string | null) => void;
  allowClear?: boolean;
}

/** Saisie d'une heure réelle au format HH:MM ou HH:MM:SS (heure de Paris). */
export function TimeEdit({ label, valueIso, refIso, onSave, allowClear }: Props) {
  const [text, setText] = useState(valueIso ? fmtTimeHMS(valueIso) : '');
  const [invalid, setInvalid] = useState(false);

  function save() {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (allowClear) onSave(null);
      return;
    }
    const iso = parisWallToUtcIso(trimmed, valueIso ?? refIso);
    if (!iso) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave(iso);
  }

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
        {label}
        <input
          inputMode="numeric"
          placeholder="HH:MM:SS"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          className={`rounded-lg border bg-slate-900 px-3 py-2 text-base text-slate-100 tnum outline-none focus:border-emerald-400 ${
            invalid ? 'border-red-500' : 'border-slate-700'
          }`}
        />
      </label>
      <button
        onClick={save}
        className="rounded-lg bg-slate-700 px-4 py-2 text-base font-semibold hover:bg-slate-600"
      >
        OK
      </button>
    </div>
  );
}
