import { useEffect, useState } from 'react';
import type { PresenceInfo } from '@wavelength/shared';
import socket from '../socket.js';

export interface PresenceState { online: boolean; roomCode: string | null; }

export function usePresence(): Map<string, PresenceState> {
  const [map, setMap] = useState<Map<string, PresenceState>>(new Map());

  useEffect(() => {
    function snapshot({ friends }: { friends: PresenceInfo[] }) {
      setMap(new Map(friends.map((f) => [f.userId, { online: f.online, roomCode: f.roomCode }])));
    }
    function update(info: PresenceInfo) {
      setMap((prev) => {
        const next = new Map(prev);
        next.set(info.userId, { online: info.online, roomCode: info.roomCode });
        return next;
      });
    }
    socket.on('presence:snapshot', snapshot);
    socket.on('presence:update', update);
    return () => { socket.off('presence:snapshot', snapshot); socket.off('presence:update', update); };
  }, []);

  return map;
}
