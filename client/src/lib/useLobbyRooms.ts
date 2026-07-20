import { useEffect, useState } from 'react';
import type { PublicRoomInfo } from '@wavelength/shared';
import socket from '../socket.js';

/** Live list of public rooms for the lobby "Explore" grid. */
export function useLobbyRooms(): PublicRoomInfo[] {
  const [rooms, setRooms] = useState<PublicRoomInfo[]>([]);
  useEffect(() => {
    function onRooms(payload: { rooms: PublicRoomInfo[] }) { setRooms(payload.rooms); }
    socket.on('lobby:rooms', onRooms);
    socket.emit('lobby:subscribe');
    return () => { socket.emit('lobby:unsubscribe'); socket.off('lobby:rooms', onRooms); };
  }, []);
  return rooms;
}
