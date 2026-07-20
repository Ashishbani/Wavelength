import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateJoinResult,
} from '@wavelength/shared';
import { isValidVideoId } from '@wavelength/shared';
import { RoomManager } from './roomManager.js';

const MAX_CHAT_LEN = 500;

export function createServer(port = 3001) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });
  const rooms = new RoomManager();

  function nameOf(socketId: string, code: string): string {
    const room = rooms.getRoom(code);
    return room?.members.find((m) => m.id === socketId)?.name ?? 'someone';
  }

  io.on('connection', (socket) => {
    socket.on('time:ping', ({ t0 }, cb) => cb({ t0, serverTime: Date.now() }));

    socket.on('room:create', ({ name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      const state = rooms.createRoom(socket.id, clean);
      socket.join(state.code);
      cb({ ok: true, state, selfId: socket.id });
    });

    socket.on('room:join', ({ code, name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      const upper = (code ?? '').trim().toUpperCase();
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      try {
        const state = rooms.joinRoom(upper, socket.id, clean);
        socket.join(upper);
        cb({ ok: true, state, selfId: socket.id });
        io.to(upper).emit('room:state', state);
      } catch (e) {
        const msg = (e as Error).message;
        cb({ ok: false, error: msg === 'NAME_TAKEN' ? 'That name is taken in this room.' : 'Room not found.' });
      }
    });

    function hostAction(fn: (code: string) => void) {
      const room = rooms.getRoomByMember(socket.id);
      if (!room || !rooms.isHost(room.code, socket.id)) return;
      fn(room.code);
    }

    socket.on('playback:play', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { isPlaying: true, positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    socket.on('playback:pause', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { isPlaying: false, positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    socket.on('playback:seek', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    // heartbeat re-stamps position without forcing a re-seek broadcast type change
    socket.on('playback:heartbeat', ({ positionSec }) =>
      hostAction((code) => {
        const pb = rooms.setPlayback(code, { positionSec }, Date.now());
        io.to(code).emit('playback:update', pb);
      }),
    );

    socket.on('queue:next', () =>
      hostAction((code) => {
        const pb = rooms.advanceQueue(code, Date.now());
        io.to(code).emit('playback:update', pb);
        const room = rooms.getRoom(code);
        if (room) io.to(code).emit('room:state', room);
      }),
    );

    socket.on('queue:add', ({ videoId, title }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      if (!isValidVideoId(videoId)) return;
      const cleanTitle = (title ?? '').toString().trim().slice(0, 200) || videoId;
      const updated = rooms.addToQueue(room.code, {
        videoId,
        title: cleanTitle,
        addedBy: nameOf(socket.id, room.code),
      });
      io.to(room.code).emit('room:state', updated);
      // if nothing is playing, auto-start the first added song
      if (!updated.playback.videoId) {
        const pb = rooms.advanceQueue(room.code, Date.now());
        io.to(room.code).emit('playback:update', pb);
        const after = rooms.getRoom(room.code);
        if (after) io.to(room.code).emit('room:state', after);
      }
    });

    socket.on('chat:send', ({ text }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      const clean = (text ?? '').toString().trim().slice(0, MAX_CHAT_LEN);
      if (!clean) return;
      io.to(room.code).emit('chat:message', {
        name: nameOf(socket.id, room.code),
        text: clean,
        ts: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      const res = rooms.leaveRoom(socket.id);
      if (res?.state) io.to(res.code).emit('room:state', res.state);
    });
  });

  httpServer.listen(port);
  return {
    io,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

// Start when run directly (not imported by a test).
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(port);
  console.log(`Wavelength server listening on :${port}`);
}
