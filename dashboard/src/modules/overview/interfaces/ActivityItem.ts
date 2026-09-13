import type { ActivityId } from '../ids';

export interface ActivityItem {
  id: ActivityId;
  workflow: string;
  status: 'completed' | 'failed';
  time: string;
  cost: number;
  latency: number;
  msg?: string;
}
