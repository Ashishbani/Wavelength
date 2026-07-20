import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wavelength/shared';

// Dev: talk to the standalone server on :3001. Prod: same origin (the server
// serves this bundle), so use the page origin — works on any domain / tunnel.
const URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  transports: ['websocket'],
  autoConnect: true,
  withCredentials: true,
});

export default socket;
