import { apiGet, apiPost, apiDelete } from '../auth/api.js';

export interface FriendSummary { userId: string; username: string | null; displayName: string; }
export interface PendingRequest { id: string; userId: string; username: string | null; displayName: string; }

export const getFriends = () => apiGet<{ friends: FriendSummary[] }>('/api/friends');
export const getRequests = () => apiGet<{ incoming: PendingRequest[]; outgoing: PendingRequest[] }>('/api/friends/requests');
export const sendRequest = (username: string) => apiPost('/api/friends/requests', { username });
export const acceptRequest = (id: string) => apiPost(`/api/friends/requests/${id}/accept`, {});
export const declineRequest = (id: string) => apiPost(`/api/friends/requests/${id}/decline`, {});
export const unfriend = (userId: string) => apiDelete(`/api/friends/${userId}`);
