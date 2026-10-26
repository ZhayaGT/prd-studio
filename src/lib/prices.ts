/**
 * Fallback prices for ids the catalog does not price (unprefixed aliases such as
 * `kiro-opus-5.5`). USD per million tokens, catalog min ask.
 *
 * Display only: actual spend is recorded per call from `usage.cost`.
 */
export const FALLBACK_PRICES: Record<string, [number, number]> = {
  "gpt-6.1-sol": [0.03, 0.15],
  "gpt-6-sol": [0.03, 0.15],
  "gpt-5.6-sol": [0.065, 0.39],
  "gpt-6-astra": [0.07, 0.35],
  "gpt-5.6-terra": [0.02, 0.12],
  "gpt-6-luna": [0.0018, 0.009],
  "glm-5.3": [0.0014, 0.0044],
  "glm-5.3-flash": [0.00015, 0.0005],
  "deepseek-v4.1-flash": [0.00015, 0.0006],
  "kimi-k2.7": [0.0076, 0.032],
  "kimi-k2.7-code": [0.0285, 0.12],
  "kimi-k3": [0.024, 0.12],
  "kiro-opus-5.5": [0.168, 0.84],
};
