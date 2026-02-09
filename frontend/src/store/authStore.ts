import { create } from 'zustand';
import { User } from '../types';
import authService from '../services/auth.service';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
  initialize: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    }),

  logout: () => {
    authService.logout();
    set({
      user: null,
      isAuthenticated: false,
    });
  },

  initialize: () => {
    const user = authService.getCurrentUser();
    set({
      user,
      isAuthenticated: !!user,
      isLoading: false,
    });
  },
}));
