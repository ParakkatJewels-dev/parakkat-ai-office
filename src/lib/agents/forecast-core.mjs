const number = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const inr = value => '₹' + Math.round(value).toLocaleString('en-IN');

/** Arithmetic scenarios from recorded results, never a statistical confidence interval or a promised return. */
export function campaignScenario(report, error, dailyBudget, days) {
  if (error || !report || typeof report !== 'object') throw new Error('Could not load recorded sales and ad results for the campaign proposal. Try again after the data connection recovers.');
  const spend = number(report.spend), adRevenue = number(report.ad_revenue), revenue = number(report.revenue), units = number(report.units);
  const roas = spend !== null && spend > 0 && adRevenue !== null ? adRevenue / spend : null;
  const perUnit = units !== null && units > 0 && revenue !== null && revenue > 0 ? revenue / units : null;
  const total = Math.round(dailyBudget * days);
  const low = roas !== null ? Math.round(total * roas * 0.75) : null;
  const high = roas !== null ? Math.round(total * roas * 1.25) : null;
  const pieces = roas !== null && perUnit !== null ? Math.round(((low + high) / 2) / perUnit) : null;
  const basis = roas !== null
    ? `Recorded platform-attributed revenue was ${roas.toFixed(1)}x ad spend over the selected 30-day window (${inr(adRevenue)} from ${inr(spend)}). Applying that recorded ratio to ${inr(total)} gives illustrative revenue scenarios of ${inr(low)} to ${inr(high)}, using an arbitrary 25% below/above assumption. This is not a confidence interval or a guaranteed return.${pieces !== null ? ` At the recorded average of ${inr(perUnit)} per item, the midpoint equates to about ${pieces} pieces.` : ''} Attribution may overlap between ad platforms, and incomplete sync coverage can distort these scenarios.`
    : 'A return scenario is unavailable because this window has no positive recorded ad spend with a known attributed-revenue total. Missing or unsynced results are not zero demand.';
  return { spend, adRevenue, revenue, units, impact: { budget_total: total, roas_basis: roas, revenue_low: low, revenue_high: high, units: pieces, basis } };
}
