import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wavelength/shared';

const URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  transports: ['websocket'],
  autoConnect: true,
  withCredentials: true,
});

export default socket;
