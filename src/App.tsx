import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { JoinGate } from './components/JoinGate';
import { savedPin, useRaceStore } from './store/raceStore';
import Dashboard from './pages/Dashboard';
import Timeline from './pages/Timeline';
import Runners from './pages/Runners';
import RunnerDetail from './pages/RunnerDetail';
import QuickEntry from './pages/QuickEntry';

export default function App() {
  const pin = useRaceStore((s) => s.pin);
  const join = useRaceStore((s) => s.join);
  const [restoring, setRestoring] = useState(() => savedPin() !== null);

  // Reconnexion automatique si un code est mémorisé sur ce téléphone.
  useEffect(() => {
    const saved = savedPin();
    if (!saved) return;
    join(saved).finally(() => setRestoring(false));
  }, [join]);

  if (restoring && !pin) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-slate-400">
        Reconnexion à la course…
      </div>
    );
  }

  if (!pin) return <JoinGate />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/runners" element={<Runners />} />
        <Route path="/runners/:runnerId" element={<RunnerDetail />} />
        <Route path="/quick" element={<QuickEntry />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
