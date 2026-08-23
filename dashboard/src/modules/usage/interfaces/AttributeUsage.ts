// API response shape for GET /v1/metrics/usage-by-attribute?key=<k>. One row per
// distinct value of the chosen custom attribute, with its allocated spend/usage.
export interface AttributeUsage {
  value: string;
  cost: number;
  calls: number;
  runs: number;
  input_tokens: number;
  output_tokens: number;
}
