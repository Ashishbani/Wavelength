interface Entry {
  socketIds: Set<string>;
  roomCode: string | null;
}

export class PresenceRegistry {
  private entries = new Map<string, Entry>();

  addSocket(userId: string, socketId: string): void {
    const e = this.entries.get(userId);
    if (e) e.socketIds.add(socketId);
    else this.entries.set(userId, { socketIds: new Set([socketId]), roomCode: null });
  }

  removeSocket(userId: string, socketId: string): { nowOffline: boolean } {
    const e = this.entries.get(userId);
    if (!e) return { nowOffline: false };
    e.socketIds.delete(socketId);
    if (e.socketIds.size === 0) {
      this.entries.delete(userId);
      return { nowOffline: true };
    }
    return { nowOffline: false };
  }

  setRoom(userId: string, roomCode: string | null): void {
    const e = this.entries.get(userId);
    if (e) e.roomCode = roomCode;
  }

  isOnline(userId: string): boolean {
    return this.entries.has(userId);
  }

  getPresence(userId: string): { online: boolean; roomCode: string | null } {
    const e = this.entries.get(userId);
    return e ? { online: true, roomCode: e.roomCode } : { online: false, roomCode: null };
  }
}
