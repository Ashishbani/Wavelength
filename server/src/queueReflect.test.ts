import { describe, it, expect, afterEach } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb } from './db/db.js';
import { createServer } from './index.js';
import type { CreateJoinResult, RoomState, PlaybackState } from '@wavelength/shared';

// Evidence for the "queue not reflected after adding a second link" report.
describe('queue reflection', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const sockets: Socket[] = [];
  afterEach(async () => { sockets.forEach((s) => s.close()); sockets.length = 0; await server.close(); });

  async function start() {
    const db = openDb(':memory:');
    server = await createServer(0, db);
    return (server.httpServer.address() as { port: number }).port;
  }
  function connect(port: number): Promise<Socket> {
    return new Promise((r) => {
      const s = ioc(`http://localhost:${port}`, { transports: ['websocket'] });
      s.on('connect', () => r(s));
    });
  }

  it('reflects a second queued track while the first is playing', async () => {
    const port = await start();
    const host = await connect(port); sockets.push(host);

    const created = await new Promise<CreateJoinResult>((r) => host.emit('room:create', { name: 'Alice' }, r));
    if (!created.ok) throw new Error('create failed');

    // Track the latest room state and playback the client would render.
    let lastState: RoomState = created.state;
    let lastPlayback: PlaybackState = created.state.playback;
    host.on('room:state', (s) => { lastState = s; });
    host.on('playback:update', (p) => { lastPlayback = p; });

    // First add — auto-starts (nothing was playing), so the queue drains.
    host.emit('queue:add', { videoId: 'dQw4w9WgXcQ', title: 'Song A' });
    await new Promise((r) => setTimeout(r, 150));
    expect(lastPlayback.videoId).toBe('dQw4w9WgXcQ');
    expect(lastState.queue).toHaveLength(0);

    // Second add — first is still playing, so it should land in the queue.
    host.emit('queue:add', { videoId: 'oHg5SJYRHA0', title: 'Song B' });
    await new Promise((r) => setTimeout(r, 150));
    expect(lastState.queue.map((q) => q.videoId)).toEqual(['oHg5SJYRHA0']);
  });
});
