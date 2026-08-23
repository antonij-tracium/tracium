// API response shape for GET /v1/metrics/model-costs. Raw numbers; the page
// owns formatting and the bar colors.
export interface ModelCost {
  name: string;
  cost: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}
