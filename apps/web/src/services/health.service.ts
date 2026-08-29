import { api } from '../lib/api';

export interface HealthReport {
  status: 'ok' | 'degraded';
  database: boolean;
  redis: boolean;
  uptime: number;
}

export async function fetchHealth(): Promise<HealthReport> {
  const { data } = await api.get<{ success: true; data: HealthReport }>('/health');
  return data.data;
}
