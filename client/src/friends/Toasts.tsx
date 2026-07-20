import { useEffect, useRef, useState } from 'react';
import type { PresenceInfo } from '@wavelength/shared';
import socket from '../socket.js';
import { getFriends, type FriendSummary } from './api.js';

interface InviteToast { kind: 'invite'; id: number; text: string; code: string; }
interface RequestToast { kind: 'request'; id: number; text: string; }
interface LiveToast { kind: 'live'; id: number; text: string; code: string; }
type Toast = InviteToast | RequestToast | LiveToast;

let nextId = 1;

export default function Toasts({ onJoin }: { onJoin: (code: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const friendsRef = useRef<Map<string, FriendSummary>>(new Map());
  const lastRoomRef = useRef<Map<string, string | null>>(new Map());

  function push(t: Toast) {
    setToasts((ts) => [...ts, t]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 8000);
  }

  useEffect(() => {
    // Load the friend list so presence updates can be labelled (guests get none).
    getFriends().then((r) => { friendsRef.current = new Map(r.friends.map((f) => [f.userId, f])); }).catch(() => {});

    function onInvite(p: { fromDisplayName: string; code: string; roomName: string | null }) {
      push({ kind: 'invite', id: nextId++, code: p.code, text: `${p.fromDisplayName} invited you to ${p.roomName ?? 'a room'}` });
    }
    function onRequest(p: { fromUsername: string; fromDisplayName: string }) {
      push({ kind: 'request', id: nextId++, text: `@${p.fromUsername} sent you a friend request` });
    }
    function onSnapshot({ friends }: { friends: PresenceInfo[] }) {
      // Seed known room state so we don't toast on the initial load.
      for (const f of friends) lastRoomRef.current.set(f.userId, f.roomCode);
    }
    function onPresence(info: PresenceInfo) {
      const prev = lastRoomRef.current.get(info.userId) ?? null;
      lastRoomRef.current.set(info.userId, info.roomCode);
      if (!prev && info.roomCode) {
        const f = friendsRef.current.get(info.userId);
        const who = f?.username ? `@${f.username}` : (f?.displayName ?? 'A friend');
        push({ kind: 'live', id: nextId++, code: info.roomCode, text: `${who} started listening` });
      }
    }

    socket.on('invite:receive', onInvite);
    socket.on('friend:requestReceived', onRequest);
    socket.on('presence:snapshot', onSnapshot);
    socket.on('presence:update', onPresence);
    return () => {
      socket.off('invite:receive', onInvite);
      socket.off('friend:requestReceived', onRequest);
      socket.off('presence:snapshot', onSnapshot);
      socket.off('presence:update', onPresence);
    };
  }, []);

  function dismiss(id: number) { setToasts((ts) => ts.filter((x) => x.id !== id)); }

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span className="grow">{t.text}</span>
          {(t.kind === 'invite' || t.kind === 'live') && (
            <button className="chip join" onClick={() => { onJoin(t.code); dismiss(t.id); }}>Join</button>
          )}
          <button className="iconbtn" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
