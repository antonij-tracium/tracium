import type { UserId } from '../../../common/ids';

export interface UserSummary {
  id: UserId;
  name: string;
  cost: number;
  costPrev: number;
  runs: number;
  runsPrev: number;
  avg: number;
  trend: number[];
}
