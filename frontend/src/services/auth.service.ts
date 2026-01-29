import api from './api';
import { AuthResponse, LoginCredentials, RegisterData, User } from '../types';

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/login', credentials);

    if (response.data) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }

    return response;
  }

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>('/auth/register', data);

    if (response.data) {
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }

    return response;
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  getCurrentUser(): User | null {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  async refreshToken(): Promise<string> {
    const response = await api.post<{ token: string }>('/auth/refresh');
    localStorage.setItem('token', response.token);
    return response.token;
  }

  async getProfile(): Promise<User> {
    return api.get<User>('/users/profile');
  }

  async updateProfile(data: Partial<User>): Promise<User> {
    const user = await api.put<User>('/users/profile', data);
    localStorage.setItem('user', JSON.stringify(user));
    return user;
  }
}

export default new AuthService();
