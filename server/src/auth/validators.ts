import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(40),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const createPlaylistSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // videoId is a YouTube id OR an uploaded track's uuid — the old 11-char
  // YouTube-only rule rejected every queue containing your own music.
  items: z
    .array(z.object({
      videoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      title: z.string().max(200),
      kind: z.enum(['yt', 'lib']).optional(),
    }))
    .max(500),
});

export const loadPlaylistSchema = z.object({
  playlistId: z.string().min(1).max(64),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(200),
});

export const resetPasswordSchema = z.object({
  email: z.string().email().max(200),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const usernameSchema = z.object({
  username: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_]+$/),
});

export const friendRequestSchema = z.object({
  username: z.string().trim().min(3).max(20),
});

export const inviteSchema = z.object({
  toUserId: z.string().min(1).max(64),
});
