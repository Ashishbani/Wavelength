import { useState } from 'react';
import type { RoomState } from '@wavelength/shared';
import Landing from './Landing.js';
import Room from './Room.js';

export default function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string>('');

  return (
    <div className="app">
      {room
        ? <Room initialState={room} selfId={selfId} />
        : <Landing onJoined={(s, id) => { setRoom(s); setSelfId(id); }} />}
    </div>
  );
}
