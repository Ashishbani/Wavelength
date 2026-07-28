import { apiGet, apiPost, apiDelete } from '../auth/api.js';
import type { TrackKind } from '@wavelength/shared';

export interface Favourite {
  videoId: string;
  title: string;
  kind: TrackKind;
  createdAt: number;
}

export function listFavourites(): Promise<{ favourites: Favourite[] }> {
  return apiGet<{ favourites: Favourite[] }>('/api/favourites');
}
export function addFavourite(videoId: string, title: string, kind: TrackKind = 'yt'): Promise<unknown> {
  return apiPost('/api/favourites', { videoId, title, kind });
}
export function removeFavourite(videoId: string): Promise<unknown> {
  return apiDelete(`/api/favourites/${encodeURIComponent(videoId)}`);
}
