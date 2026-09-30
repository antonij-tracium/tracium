import { costFormatter, fmtNum, tokenFormatter } from '../../../common';
import type { KpiSet } from '../../overview/interfaces';
import type { KpiItem } from '../components';
import { deltaParts } from './mappers';

export function spendTile(kpis: KpiSet): KpiItem {
  return {
    label: 'Spend',
    value: costFormatter.format(kpis.cost.value),
    ...deltaParts(kpis.cost),
    hint: 'vs prev period',
  };
}

export function runsTile(kpis: KpiSet): KpiItem {
  const runs = kpis.runs.value;
  const avgPer1k = runs > 0 ? (kpis.cost.value / runs) * 1000 : 0;
  return {
    label: 'Runs',
    value: fmtNum(Math.round(runs)),
    ...deltaParts(kpis.runs),
    hint: costFormatter.format(avgPer1k) + ' / 1K runs',
  };
}

// tokens is undefined until the model-cost query that supplies it resolves.
export function tokensTile(tokens: number | undefined): KpiItem {
  return {
    label: 'Tokens',
    value: tokens != null ? tokenFormatter.format(tokens) : '—',
    delta: '',
    deltaTone: 'neutral',
    hint: 'input + output',
  };
}
