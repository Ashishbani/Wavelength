import { useEffect, useState } from 'react';
import socket from '../socket.js';

interface InviteToast { kind: 'invite'; id: number; text: string; code: string; }
interface RequestToast { kind: 'request'; id: number; text: string; }
type Toast = InviteToast | RequestToast;

let nextId = 1;

export default function Toasts({ onJoin }: { onJoin: (code: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onInvite(p: { fromDisplayName: string; code: string; roomName: string | null }) {
      const id = nextId++;
      setToasts((t) => [...t, { kind: 'invite', id, code: p.code, text: `${p.fromDisplayName} invited you to ${p.roomName ?? 'a room'}` }]);
    }
    function onRequest(p: { fromUsername: string; fromDisplayName: string }) {
      const id = nextId++;
      setToasts((t) => [...t, { kind: 'request', id, text: `@${p.fromUsername} sent you a friend request` }]);
    }
    socket.on('invite:receive', onInvite);
    socket.on('friend:requestReceived', onRequest);
    return () => { socket.off('invite:receive', onInvite); socket.off('friend:requestReceived', onRequest); };
  }, []);

  function dismiss(id: number) { setToasts((t) => t.filter((x) => x.id !== id)); }

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="grow">{t.text}</span>
          {t.kind === 'invite' && <button className="chip join" onClick={() => { onJoin(t.code); dismiss(t.id); }}>Join</button>}
          <button className="iconbtn" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
