import { costFormatter } from '../utils/formatters';

interface CostTagProps {
  usd: number;
}

export function CostTag({ usd }: CostTagProps) {
  return (
    <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
      {costFormatter.format(usd)}
    </span>
  );
}
