import { useCallback, useEffect, useState } from 'react';

const TICK_MS = 100;

/** Playback clock for the Disaster Simulator: `progress` runs 0 → 1 over `durationMs / speed`. */
export function useSimulationClock(durationMs = 60000) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return undefined;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const step = ((now - last) * speed) / durationMs;
      last = now;
      setProgress((p) => Math.min(1, p + step));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, durationMs]);

  useEffect(() => {
    if (playing && progress >= 1) setPlaying(false);
  }, [playing, progress]);

  const play = useCallback(() => {
    setProgress((p) => (p >= 1 ? 0 : p));
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const restart = useCallback(() => {
    setProgress(0);
    setPlaying(true);
  }, []);
  const seek = useCallback((p) => setProgress(Math.min(1, Math.max(0, p))), []);

  return { progress, playing, speed, play, pause, restart, seek, setSpeed };
}
