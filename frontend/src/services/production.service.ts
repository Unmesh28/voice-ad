import api from './api';
import { Production, CreateProductionData } from '../types';

interface MixProductionResponse {
  success: boolean;
  productionId: string;
  outputUrl: string;
  duration: number;
}

interface MixProductionAsyncResponse {
  jobId: string;
  productionId: string;
}

interface QuickProductionRequest {
  prompt: string;
  voiceId?: string;
  duration?: number;
  tone?: string;
}

interface QuickProductionResponse {
  productionId: string;
  message: string;
}

interface ProductionProgress {
  stage: 'script' | 'music' | 'tts' | 'mixing' | 'completed' | 'failed';
  progress: number;
  message: string;
  scriptId?: string;
  musicId?: string;
  productionId?: string;
  outputUrl?: string;
}

class ProductionService {
  async createProduction(data: CreateProductionData): Promise<Production> {
    return api.post<Production>('/productions', data);
  }

  async getProductions(projectId?: string): Promise<Production[]> {
    return api.get<Production[]>('/productions', projectId ? { projectId } : {});
  }

  async getProduction(id: string): Promise<Production> {
    return api.get<Production>(`/productions/${id}`);
  }

  async updateProduction(id: string, data: Partial<CreateProductionData>): Promise<Production> {
    return api.put<Production>(`/productions/${id}`, data);
  }

  async deleteProduction(id: string): Promise<void> {
    return api.delete<void>(`/productions/${id}`);
  }

  async mixProduction(id: string): Promise<MixProductionAsyncResponse> {
    return api.post<MixProductionAsyncResponse>(`/productions/${id}/mix`, {});
  }

  async mixProductionSync(id: string): Promise<MixProductionResponse> {
    return api.post<MixProductionResponse>(`/productions/${id}/mix-sync`, {});
  }

  async createQuickProduction(data: QuickProductionRequest): Promise<QuickProductionResponse> {
    return api.post<QuickProductionResponse>('/productions/quick', data);
  }

  async getProductionProgress(id: string): Promise<ProductionProgress> {
    return api.get<ProductionProgress>(`/productions/${id}/progress`);
  }
}

export default new ProductionService();
