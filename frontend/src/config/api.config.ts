// API Configuration
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Dynamic backend URL detection
const getBackendUrl = (): string => {
  // In development, use Vite proxy (relative paths)
  if (import.meta.env.DEV) {
    return '';
  }

  // In production, detect based on current hostname
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Use the same hostname as frontend, but port 5000 for backend
  return `${protocol}//${hostname}:5000`;
};

export const BACKEND_URL = getBackendUrl();

// Helper to get full media URL
export const getMediaUrl = (path: string): string => {
  if (!path) return '';

  // If path is already a full URL, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // In development (using Vite proxy), return relative path
  if (import.meta.env.DEV) {
    return path.startsWith('/') ? path : `/${path}`;
  }

  // In production, prepend backend URL
  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`;
};
