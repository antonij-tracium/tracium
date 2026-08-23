import { durationFormatter } from '../utils/formatters';

interface DurationProps {
  ms: number;
}

export function Duration({ ms }: DurationProps) {
  return <span>{durationFormatter.format(ms)}</span>;
}
