import type { VisaCalculation } from "@/server/rag/types";
import {
  BLOCKED_ACCOUNT_MONTHLY_EUR,
  BLOCKED_ACCOUNT_MONTHS,
  INR_PER_EUR,
} from "@/server/rag/types";
import { ValidationError } from "@/server/lib/errors";

/**
 * Deterministic German blocked-account (Sperrkonto) calculator.
 * Defaults preserved from the original Python tool: 992 EUR/month for 12
 * months, INR conversion at 90 INR/EUR.
 */
export function calculateVisaRequirements(
  monthlyEur: number = BLOCKED_ACCOUNT_MONTHLY_EUR,
  months: number = BLOCKED_ACCOUNT_MONTHS,
  inrRate: number = INR_PER_EUR,
): VisaCalculation {
  if (!Number.isFinite(monthlyEur) || monthlyEur <= 0) {
    throw new ValidationError("monthlyEur", "must be a positive finite number");
  }
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    throw new ValidationError("months", "must be an integer between 1 and 60");
  }
  if (!Number.isFinite(inrRate) || inrRate <= 0) {
    throw new ValidationError("inrRate", "must be a positive finite number");
  }

  const totalEur = monthlyEur * months;
  const totalInr = totalEur * inrRate;

  return {
    monthlyEur,
    months,
    totalEur,
    totalInr,
    summary: `Total required blocked account amount: €${formatEur(totalEur)} (~₹${formatInr(totalInr)} INR at ₹${inrRate}/€1 rate).`,
  };
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
