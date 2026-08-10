import { maskPii } from "@/server/pii/masker";

describe("PIIMasker", () => {
  it("should mask email addresses", () => {
    const result = maskPii("Contact me at john.doe@example.com please.");
    expect(result.text).toContain("[EMAIL_REDACTED]");
    expect(result.text).not.toContain("john.doe@example.com");
    expect(result.wasPiiDetected).toBe(true);
  });

  it("should mask phone numbers (national + international)", () => {
    const national = maskPii("Call +91-9876543210 now.");
    expect(national.text).toContain("[PHONE_REDACTED]");
    expect(national.text).not.toContain("9876543210");

    const german = maskPii("Reach 0049-30-12345678.");
    expect(german.text).toContain("[PHONE_REDACTED]");
  });

  it("should mask IBAN (spaced and unspaced)", () => {
    const unspaced = maskPii("Transfer to DE89370400440532013000.");
    expect(unspaced.text).toContain("[IBAN_REDACTED]");
    expect(unspaced.text).not.toContain("DE89370400440532013000");

    const spaced = maskPii("Transfer to DE89 3704 0044 0532 0130 00.");
    expect(spaced.text).toContain("[IBAN_REDACTED]");
  });

  it("should mask passport numbers", () => {
    const indian = maskPii("My passport is A1234567.");
    expect(indian.text).toContain("[PASSPORT_REDACTED]");
    expect(indian.text).not.toContain("A1234567");
  });

  it("should mask dates of birth", () => {
    const result = maskPii("Born on 15/01/1990.");
    expect(result.text).toContain("[DOB_REDACTED]");
    expect(result.text).not.toContain("15/01/1990");
  });

  it("should preserve non-PII text verbatim", () => {
    const result = maskPii("What is the blocked account requirement for a German student visa?");
    expect(result.text).toBe("What is the blocked account requirement for a German student visa?");
    expect(result.wasPiiDetected).toBe(false);
  });

  it("should handle empty and null input", () => {
    expect(maskPii("").text).toBe("");
    expect(maskPii("").wasPiiDetected).toBe(false);
  });

  it("should return non-string input unchanged (defensive)", () => {
    const result = maskPii(42 as unknown as string);
    expect(result.text).toBe(42 as unknown as string);
    expect(result.wasPiiDetected).toBe(false);
  });
});
