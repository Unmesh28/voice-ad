// API Configuration
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Backend URL for media files (not proxied)
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// Helper to get full media URL
export const getMediaUrl = (path: string): string => {
  if (!path) return '';

  // If path is already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Otherwise, prepend backend URL
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
};
