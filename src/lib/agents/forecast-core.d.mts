export function campaignScenario(report: unknown, error: unknown, dailyBudget: number, days: number): {
  spend: number | null; adRevenue: number | null; revenue: number | null; units: number | null;
  impact: { budget_total: number; roas_basis: number | null; revenue_low: number | null; revenue_high: number | null; units: number | null; basis: string };
};
