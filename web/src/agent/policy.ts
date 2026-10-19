import type { ExpenseRequest, LearnedRule, PolicyResult } from "./contract";

/** Mirrors seed/expense-policy.md. The .NET agent owns the real check. */
const UK_CITIES = ["london", "manchester", "edinburgh", "birmingham", "glasgow", "bristol", "leeds", "liverpool", "cardiff", "belfast"];

export function baseRuleFor(city: string) {
  const c = city.trim().toLowerCase();
  if (c === "london") return { ruleId: "HOTEL-LDN", capPerNight: 250, label: "London hotel cap" };
  if (UK_CITIES.includes(c)) return { ruleId: "HOTEL-UK", capPerNight: 150, label: "UK hotel cap" };
  return { ruleId: "HOTEL-INTL", capPerNight: 200, label: "International hotel cap" };
}

export function evaluatePolicy(
  r: Pick<ExpenseRequest, "category" | "city" | "nightlyRate">,
  learnedRules: LearnedRule[],
): PolicyResult {
  const base = baseRuleFor(r.city);
  if (r.nightlyRate <= base.capPerNight) {
    return { ruleId: base.ruleId, capPerNight: base.capPerNight, outcome: "within" };
  }
  const learned = learnedRules.find(
    (l) => l.category === r.category && l.city.toLowerCase() === r.city.trim().toLowerCase(),
  );
  if (learned && r.nightlyRate <= learned.capPerNight) {
    return {
      ruleId: base.ruleId,
      capPerNight: base.capPerNight,
      outcome: "within_learned",
      learnedRule: { id: learned.id, capPerNight: learned.capPerNight, title: learned.title },
    };
  }
  return {
    ruleId: base.ruleId,
    capPerNight: base.capPerNight,
    outcome: "over",
    overBy: r.nightlyRate - base.capPerNight,
  };
}
