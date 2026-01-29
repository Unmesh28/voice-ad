import api from './api';
import { Project, CreateProjectData } from '../types';

class ProjectService {
  async createProject(data: CreateProjectData): Promise<Project> {
    return api.post<Project>('/projects', data);
  }

  async getProjects(status?: string): Promise<Project[]> {
    return api.get<Project[]>('/projects', { status });
  }

  async getProject(id: string): Promise<Project> {
    return api.get<Project>(`/projects/${id}`);
  }

  async updateProject(id: string, data: Partial<CreateProjectData>): Promise<Project> {
    return api.put<Project>(`/projects/${id}`, data);
  }

  async deleteProject(id: string): Promise<void> {
    return api.delete<void>(`/projects/${id}`);
  }

  async archiveProject(id: string): Promise<Project> {
    return api.post<Project>(`/projects/${id}/archive`);
  }
}

export default new ProjectService();
