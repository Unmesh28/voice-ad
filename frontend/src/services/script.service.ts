import api from './api';
import { Script, GenerateScriptData } from '../types';

interface CreateScriptData {
  projectId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
}

interface RefineScriptData {
  improvementRequest: string;
}

interface GenerateVariationsData extends GenerateScriptData {
  count?: number;
}

class ScriptService {
  async generateScript(data: GenerateScriptData): Promise<Script> {
    return api.post<Script>('/scripts/generate-sync', data);
  }

  async generateScriptAsync(data: GenerateScriptData): Promise<{ jobId: string }> {
    return api.post<{ jobId: string }>('/scripts/generate', data);
  }

  async generateVariations(data: GenerateVariationsData): Promise<Script[]> {
    return api.post<Script[]>('/scripts/generate-variations', data);
  }

  async createScript(data: CreateScriptData): Promise<Script> {
    return api.post<Script>('/scripts', data);
  }

  async getScripts(projectId?: string): Promise<Script[]> {
    return api.get<Script[]>('/scripts', { projectId });
  }

  async getScript(id: string): Promise<Script> {
    return api.get<Script>(`/scripts/${id}`);
  }

  async updateScript(id: string, data: Partial<CreateScriptData>): Promise<Script> {
    return api.put<Script>(`/scripts/${id}`, data);
  }

  async deleteScript(id: string): Promise<void> {
    return api.delete<void>(`/scripts/${id}`);
  }

  async refineScript(id: string, data: RefineScriptData): Promise<Script> {
    return api.post<Script>(`/scripts/${id}/refine`, data);
  }
}

export default new ScriptService();
