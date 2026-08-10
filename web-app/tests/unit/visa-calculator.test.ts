import { calculateVisaRequirements } from "@/server/rag/tools/visa-calculator";

describe("VisaCalculator", () => {
  it("should compute 992 EUR/month x 12 months", () => {
    const result = calculateVisaRequirements();
    expect(result.monthlyEur).toBe(992);
    expect(result.months).toBe(12);
    expect(result.totalEur).toBe(11904);
  });

  it("should convert EUR to INR at 90 INR/EUR", () => {
    const result = calculateVisaRequirements();
    expect(result.totalInr).toBe(11904 * 90);
  });

  it("should reject invalid months or negative amounts", () => {
    expect(() => calculateVisaRequirements(992, 0)).toThrow();
    expect(() => calculateVisaRequirements(992, 61)).toThrow();
    expect(() => calculateVisaRequirements(-100)).toThrow();
    expect(() => calculateVisaRequirements(992, 1.5)).toThrow();
  });

  it("should handle currency rounding", () => {
    const result = calculateVisaRequirements(1000.555, 12);
    expect(result.summary).toContain("€12,006.66");
    expect(result.totalInr).toBeCloseTo(1000.555 * 12 * 90, 2);
  });

  it("should reject a non-finite or non-positive INR rate", () => {
    expect(() => calculateVisaRequirements(992, 12, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => calculateVisaRequirements(992, 12, 0)).toThrow();
  });
});
