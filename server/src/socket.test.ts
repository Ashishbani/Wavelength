import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, CreateJoinResult } from '@wavelength/shared';
import { createServer } from './index.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function connect(port: number): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const s: ClientSocket = ioc(`http://localhost:${port}`, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
  });
}

describe('socket server', () => {
  let server: ReturnType<typeof createServer>;
  const sockets: ClientSocket[] = [];

  afterEach(async () => {
    sockets.forEach((s) => s.close());
    sockets.length = 0;
    await server.close();
  });

  it('creates a room and a second client can join it', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    const joined = await new Promise<CreateJoinResult>((res) =>
      guest.emit('room:join', { code, name: 'Bob' }, res),
    );
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(joined.state.members).toHaveLength(2);
  });

  it('broadcasts host playback to guests', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    if (!created.ok) throw new Error('create failed');
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    await new Promise<CreateJoinResult>((res) => guest.emit('room:join', { code, name: 'Bob' }, res));

    // host adds a song and advances, then guest should receive playback updates
    host.emit('queue:add', { videoId: 'dQw4w9WgXcQ', title: 'Song' });
    const update = await new Promise<{ videoId: string | null; isPlaying: boolean }>((res) => {
      guest.on('playback:update', (pb) => res(pb));
      host.emit('queue:next');
    });
    expect(update.videoId).toBe('dQw4w9WgXcQ');
    expect(update.isPlaying).toBe(true);
  });

  it('allows playback control from any member (collaborative)', async () => {
    server = createServer(0);
    const port = (server.httpServer.address() as { port: number }).port;

    const host = await connect(port);
    sockets.push(host);
    const created = await new Promise<CreateJoinResult>((res) =>
      host.emit('room:create', { name: 'Alice' }, res),
    );
    if (!created.ok) throw new Error('create failed');
    const code = created.state.code;

    const guest = await connect(port);
    sockets.push(guest);
    await new Promise<CreateJoinResult>((res) => guest.emit('room:join', { code, name: 'Bob' }, res));

    // a non-host member pauses; everyone (incl. the host) receives the update
    const update = await new Promise<{ isPlaying: boolean; positionSec: number }>((res) => {
      host.on('playback:update', (pb) => res(pb));
      guest.emit('playback:pause', { positionSec: 10 });
    });
    expect(update.isPlaying).toBe(false);
    expect(update.positionSec).toBe(10);
  });
});
