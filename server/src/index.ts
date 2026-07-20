import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateJoinResult,
} from '@wavelength/shared';
import { isValidVideoId, REACTIONS } from '@wavelength/shared';
import type { PresenceInfo } from '@wavelength/shared';
import { RoomManager } from './roomManager.js';
import { openDb, migrate, type DB } from './db/db.js';
import { createUserRepo } from './db/userRepo.js';
import { createRoomRepo } from './db/roomRepo.js';
import { createPlaylistRepo } from './db/playlistRepo.js';
import { createHistoryRepo } from './db/historyRepo.js';
import { createFriendRepo } from './db/friendRepo.js';
import { PresenceRegistry } from './presence/presenceRegistry.js';
import { createAuthRouter, COOKIE_NAME } from './auth/routes.js';
import { createRoomRouter } from './api/roomRoutes.js';
import { createPlaylistRouter } from './api/playlistRoutes.js';
import { createHistoryRouter } from './api/historyRoutes.js';
import { createAccountRouter } from './api/accountRoutes.js';
import { createFriendRouter } from './api/friendRoutes.js';
import { verifyToken } from './auth/token.js';
import { loadPlaylistSchema, inviteSchema } from './auth/validators.js';

const MAX_CHAT_LEN = 500;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

export function createServer(port = 3001, injectedDb?: DB) {
  const db = injectedDb ?? (() => { const d = openDb(); migrate(d); return d; })();
  const userRepo = createUserRepo(db);
  const roomRepo = createRoomRepo(db);
  const playlistRepo = createPlaylistRepo(db);
  const historyRepo = createHistoryRepo(db);
  const friendRepo = createFriendRepo(db);
  const genCode = () => randomUUID().slice(0, 6).toUpperCase();

  const app = express();
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // Populate req.userId from the auth cookie (undefined if absent/invalid).
  app.use((req: Request & { userId?: string }, _res: Response, next: NextFunction) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    req.userId = token ? verifyToken(token)?.userId : undefined;
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(userRepo));
  app.use('/api/rooms', createRoomRouter(roomRepo, genCode));
  app.use('/api/playlists', createPlaylistRouter(playlistRepo));
  app.use('/api/history', createHistoryRouter(historyRepo));

  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: CLIENT_ORIGIN, credentials: true },
    // Detect abrupt disconnects (network drop, tab killed) faster so rooms don't
    // linger as ghosts in Explore.
    pingInterval: 10000,
    pingTimeout: 8000,
  });
  const rooms = new RoomManager();
  const presence = new PresenceRegistry();

  // Mounted after `io` exists because the request notifier pushes over the socket.
  app.use('/api/account', createAccountRouter(userRepo));
  app.use('/api/friends', createFriendRouter(userRepo, friendRepo, (addresseeId, fromUsername, fromDisplayName) => {
    io.to(`user:${addresseeId}`).emit('friend:requestReceived', { fromUsername, fromDisplayName });
  }));

  function pushPresenceToFriends(userId: string) {
    const info: PresenceInfo = { userId, ...presence.getPresence(userId) };
    for (const fid of friendRepo.friendIds(userId)) {
      if (presence.isOnline(fid)) io.to(`user:${fid}`).emit('presence:update', info);
    }
  }

  const LOBBY = 'lobby';
  function broadcastLobby() {
    io.to(LOBBY).emit('lobby:rooms', { rooms: rooms.listPublicRooms() });
  }

  // Emptied rooms are kept for a short grace period so a refresh/reconnect can
  // rejoin the same live room (with its queue) instead of finding it gone.
  const ROOM_GRACE_MS = 20000;
  const pendingDeletions = new Map<string, ReturnType<typeof setTimeout>>();
  function cancelDeletion(code: string) {
    const t = pendingDeletions.get(code);
    if (t) { clearTimeout(t); pendingDeletions.delete(code); }
  }
  function scheduleDeletion(code: string) {
    cancelDeletion(code);
    const t = setTimeout(() => {
      pendingDeletions.delete(code);
      if (rooms.getRoom(code)?.members.length === 0) { rooms.deleteRoom(code); broadcastLobby(); }
    }, ROOM_GRACE_MS);
    t.unref?.();
    pendingDeletions.set(code, t);
  }

  // Identify the socket's user from the same cookie.
  io.use((socket, next) => {
    const raw = socket.handshake.headers.cookie ?? '';
    const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
    const token = match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : '';
    (socket.data as { userId?: string }).userId = token ? verifyToken(token)?.userId : undefined;
    next();
  });

  function nameOf(socketId: string, code: string): string {
    const room = rooms.getRoom(code);
    return room?.members.find((m) => m.id === socketId)?.name ?? 'someone';
  }

  // Log a starting track into the history of every authenticated member of the room.
  function logTrackStart(code: string, videoId: string | null, title: string) {
    if (!videoId) return;
    const room = rooms.getRoom(code);
    if (!room) return;
    for (const member of room.members) {
      const memberSocket = io.sockets.sockets.get(member.id);
      const uid = memberSocket ? (memberSocket.data as { userId?: string }).userId : undefined;
      if (uid) historyRepo.add(uid, videoId, title);
    }
  }

  // Advance to the next queued track, broadcast, and log it to history.
  function advanceAndLog(code: string) {
    const upcoming = rooms.getRoom(code)?.queue[0];
    const pb = rooms.advanceQueue(code, Date.now());
    io.to(code).emit('playback:update', pb);
    if (pb.videoId) logTrackStart(code, pb.videoId, upcoming?.title ?? pb.videoId);
    const room = rooms.getRoom(code);
    if (room) io.to(code).emit('room:state', room);
    broadcastLobby();
  }

  io.on('connection', (socket) => {
    const uid = (socket.data as { userId?: string }).userId;
    if (uid) {
      socket.join(`user:${uid}`);
      presence.addSocket(uid, socket.id);
      pushPresenceToFriends(uid);
      const friends = friendRepo.friendIds(uid).map((fid): PresenceInfo => ({ userId: fid, ...presence.getPresence(fid) }));
      socket.emit('presence:snapshot', { friends });
    }

    socket.on('time:ping', ({ t0 }, cb) => cb({ t0, serverTime: Date.now() }));

    socket.on('whoami', (cb) => cb({ userId: (socket.data as { userId?: string }).userId ?? null }));

    socket.on('room:create', ({ name, isPublic }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      const state = rooms.createRoom(socket.id, clean, isPublic ?? true);
      socket.join(state.code);
      cb({ ok: true, state, selfId: socket.id });
      if (uid) { presence.setRoom(uid, state.code); pushPresenceToFriends(uid); }
      broadcastLobby();
    });

    socket.on('room:join', ({ code, name }, cb: (r: CreateJoinResult) => void) => {
      const clean = (name ?? '').trim().slice(0, 40);
      const upper = (code ?? '').trim().toUpperCase();
      if (!clean) return cb({ ok: false, error: 'Please enter a name.' });
      try {
        let state;
        if (!rooms.getRoom(upper) && roomRepo.findByCode(upper)) {
          // Reactivate a saved room that has no live instance.
          state = rooms.createRoomWithCode(upper, socket.id, clean);
        } else {
          state = rooms.joinRoom(upper, socket.id, clean);
        }
        cancelDeletion(upper);
        socket.join(upper);
        cb({ ok: true, state, selfId: socket.id });
        io.to(upper).emit('room:state', state);
        if (uid) { presence.setRoom(uid, upper); pushPresenceToFriends(uid); }
        broadcastLobby();
      } catch (e) {
        const msg = (e as Error).message;
        cb({ ok: false, error: msg === 'NAME_TAKEN' ? 'That name is taken in this room.' : 'Room not found.' });
      }
    });

    // Host-anchored actions (drift heartbeat, end-of-track advance) stay single-source.
    function hostAction(fn: (code: string) => void) {
      const room = rooms.getRoomByMember(socket.id);
      if (!room || !rooms.isHost(room.code, socket.id)) return;
      fn(room.code);
    }
    // Collaborative control: any member of the room may drive playback.
    function memberAction(fn: (code: string) => void) {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      fn(room.code);
    }

    socket.on('playback:play', ({ positionSec }) =>
      memberAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { isPlaying: true, positionSec }, Date.now()))),
    );
    socket.on('playback:pause', ({ positionSec }) =>
      memberAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { isPlaying: false, positionSec }, Date.now()))),
    );
    socket.on('playback:seek', ({ positionSec }) =>
      memberAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { positionSec }, Date.now()))),
    );
    socket.on('playback:heartbeat', ({ positionSec }) =>
      hostAction((code) => io.to(code).emit('playback:update', rooms.setPlayback(code, { positionSec }, Date.now()))),
    );

    socket.on('queue:next', () => memberAction((code) => advanceAndLog(code)));

    socket.on('queue:add', ({ videoId, title }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      if (!isValidVideoId(videoId)) return;
      const cleanTitle = (title ?? '').toString().trim().slice(0, 200) || videoId;
      const updated = rooms.addToQueue(room.code, { videoId, title: cleanTitle, addedBy: nameOf(socket.id, room.code) });
      io.to(room.code).emit('room:state', updated);
      if (!updated.playback.videoId) advanceAndLog(room.code);
    });

    // Anyone in the room may upvote a queued track; the queue reorders by votes.
    socket.on('queue:vote', ({ itemId }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room || typeof itemId !== 'string') return;
      const updated = rooms.voteQueueItem(room.code, itemId);
      io.to(room.code).emit('room:state', updated);
    });

    // Floating reaction emotes, relayed to everyone in the room.
    socket.on('reaction:send', ({ emoji }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      if (!(REACTIONS as readonly string[]).includes(emoji)) return;
      io.to(room.code).emit('reaction:show', { emoji, name: nameOf(socket.id, room.code) });
    });

    socket.on('lobby:subscribe', () => {
      socket.join(LOBBY);
      socket.emit('lobby:rooms', { rooms: rooms.listPublicRooms() });
    });
    socket.on('lobby:unsubscribe', () => { socket.leave(LOBBY); });

    // Leave the current room without disconnecting the socket (SPA navigation).
    socket.on('room:leave', () => {
      const res = rooms.leaveRoom(socket.id);
      if (!res) return;
      socket.leave(res.code);
      if (res.empty) scheduleDeletion(res.code);
      else io.to(res.code).emit('room:state', res.state);
      broadcastLobby();
      if (uid) { presence.setRoom(uid, null); pushPresenceToFriends(uid); }
    });

    socket.on('queue:loadPlaylist', (payload) => {
      const parsed = loadPlaylistSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      const userId = (socket.data as { userId?: string }).userId;
      if (!userId) return;
      const playlist = playlistRepo.findById(parsed.data.playlistId);
      if (!playlist || playlist.ownerUserId !== userId) return;
      const addedBy = nameOf(socket.id, room.code);
      for (const it of playlist.items) {
        rooms.addToQueue(room.code, { videoId: it.videoId, title: it.title, addedBy });
      }
      const updated = rooms.getRoom(room.code);
      if (updated) io.to(room.code).emit('room:state', updated);
      if (updated && !updated.playback.videoId) advanceAndLog(room.code);
    });

    socket.on('chat:send', ({ text }) => {
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      const clean = (text ?? '').toString().trim().slice(0, MAX_CHAT_LEN);
      if (!clean) return;
      io.to(room.code).emit('chat:message', { name: nameOf(socket.id, room.code), text: clean, ts: Date.now() });
    });

    socket.on('invite:send', (payload) => {
      const parsed = inviteSchema.safeParse(payload);
      if (!parsed.success || !uid) return;
      const room = rooms.getRoomByMember(socket.id);
      if (!room) return;
      if (!friendRepo.areFriends(uid, parsed.data.toUserId)) return;
      const roomName = roomRepo.findByCode(room.code)?.name ?? null;
      io.to(`user:${parsed.data.toUserId}`).emit('invite:receive', {
        fromDisplayName: nameOf(socket.id, room.code),
        code: room.code,
        roomName,
      });
    });

    socket.on('disconnect', () => {
      const res = rooms.leaveRoom(socket.id);
      if (res) {
        if (res.empty) scheduleDeletion(res.code);
        else io.to(res.code).emit('room:state', res.state);
        broadcastLobby();
      }
      if (uid) {
        const { nowOffline } = presence.removeSocket(uid, socket.id);
        if (nowOffline) pushPresenceToFriends(uid);
      }
    });
  });

  httpServer.listen(port);
  return {
    io,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of pendingDeletions.values()) clearTimeout(t);
        pendingDeletions.clear();
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const port = Number(process.env.PORT ?? 3001);
  createServer(port);
  console.log(`Wavelength server listening on :${port}`);
}
