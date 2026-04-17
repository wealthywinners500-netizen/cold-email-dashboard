// Minimal ambient type declaration for jstat. Only the surface we actually
// use in Phase 1 is typed; callers that need more can extend this file.
// Upstream has no @types/jstat package (checked 2026-04-17).

declare module 'jstat' {
  export interface BetaDistribution {
    sample(alpha: number, beta: number): number;
    pdf(x: number, alpha: number, beta: number): number;
    cdf(x: number, alpha: number, beta: number): number;
    mean(alpha: number, beta: number): number;
  }

  export const beta: BetaDistribution;
  export const jStat: {
    beta: BetaDistribution;
    [key: string]: unknown;
  };

  const _default: typeof jStat;
  export default _default;
}
