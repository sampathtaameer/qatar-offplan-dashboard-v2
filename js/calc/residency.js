// Ownership regime and residency eligibility, driven entirely by data/rules.json.
export function residencyCheck({ priceQar, regime }, rules) {
  const regimeRule = rules.regimes.find((r) => r.id === regime) || null;
  const foreignEligible = !!regimeRule?.foreign_ownership;
  const tiers = rules.residency
    .slice()
    .sort((a, b) => a.threshold_qar - b.threshold_qar)
    .map((t) => ({
      ...t,
      meets: foreignEligible && priceQar >= t.threshold_qar,
      gapQar: Math.max(0, t.threshold_qar - (priceQar || 0)),
    }));
  return { regimeRule, foreignEligible, tiers, best: [...tiers].reverse().find((t) => t.meets) || null };
}
