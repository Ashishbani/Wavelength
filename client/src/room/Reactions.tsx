import { useEffect, useState } from 'react';
import { REACTIONS } from '@wavelength/shared';
import socket from '../socket.js';

let nextId = 1;
interface Floater { id: number; emoji: string; left: number; }

/** A row of emoji buttons that broadcast a reaction to the room. */
export function ReactionBar() {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((e) => (
        <button key={e} className="react-btn" onClick={() => socket.emit('reaction:send', { emoji: e })} title="React">
          {e}
        </button>
      ))}
    </div>
  );
}

/** Full-bleed overlay that floats incoming reactions up over the stage. */
export function ReactionOverlay() {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  useEffect(() => {
    function onShow(payload: { emoji: string; name: string }) {
      const f: Floater = { id: nextId++, emoji: payload.emoji, left: 6 + Math.random() * 88 };
      setFloaters((fs) => [...fs, f]);
      window.setTimeout(() => setFloaters((fs) => fs.filter((x) => x.id !== f.id)), 2600);
    }
    socket.on('reaction:show', onShow);
    return () => { socket.off('reaction:show', onShow); };
  }, []);

  return (
    <div className="reaction-overlay">
      {floaters.map((f) => (
        <span key={f.id} className="floater" style={{ left: `${f.left}%` }}>{f.emoji}</span>
      ))}
    </div>
  );
}
