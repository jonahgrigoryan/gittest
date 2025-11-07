export function brierScore(predicted: number, outcome: number): number {
  return (predicted - outcome) ** 2;
}

export function aggregateBrierScores(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}
