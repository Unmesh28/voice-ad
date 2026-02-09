import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

/**
 * Load .env from backend directory or repo root so env vars are available
 * whether you run from backend/ (npm run dev) or from repo root.
 */
export function loadEnv(): void {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.env'),
    path.join(cwd, '..', '.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (result.error && process.env.NODE_ENV === 'development') {
        console.warn(`[env] Warning loading ${envPath}:`, result.error.message);
      }
      return;
    }
  }
}
