import { describe, it, expect } from "vitest";
import { parseChangelog } from "@/server/lib/changelog";

describe("parseChangelog", () => {
  it("parses version headers, groups, and bullets", () => {
    const markdown = `# Changelog

## [1.0.0] - 2026-07-30

### Added

- First feature
- Second feature

### Fixed

- A bug

## [0.1.0] - 2026-06-01

### Added

- Initial release
`;
    const entries = parseChangelog(markdown);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      version: "1.0.0",
      date: "2026-07-30",
      title: "Added",
      items: ["First feature", "Second feature"],
    });
    expect(entries[1]).toEqual({
      version: "1.0.0",
      date: "2026-07-30",
      title: "Fixed",
      items: ["A bug"],
    });
    expect(entries[2]?.version).toBe("0.1.0");
  });

  it("handles an [Unreleased] version without a date", () => {
    const markdown = `# Changelog

## [Unreleased]

### Changed

- Something in flight
`;
    const entries = parseChangelog(markdown);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      version: "Unreleased",
      date: "",
      title: "Changed",
      items: ["Something in flight"],
    });
  });

  it("ignores reference-link lines at the bottom of the file", () => {
    const markdown = `# Changelog

## [1.0.0] - 2026-07-30

### Added

- Release

[1.0.0]: https://example.com/releases/1.0.0
`;
    const entries = parseChangelog(markdown);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.items).toEqual(["Release"]);
  });

  it("returns an empty array for a changelog without version headers", () => {
    expect(parseChangelog("No versions here.")).toEqual([]);
    expect(parseChangelog("")).toEqual([]);
  });

  it("skips version blocks that do not match the [version] header pattern", () => {
    const markdown = `# Changelog

## Unreleased Notes

### Added

- Something
`;
    expect(parseChangelog(markdown)).toEqual([]);
  });

  it("skips groups without any bullet items", () => {
    const markdown = `# Changelog

## [1.0.0] - 2026-07-30

### Changed

- Real change

### Removed

(nothing removed yet)
`;
    const entries = parseChangelog(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("Changed");
    expect(entries[0]?.items).toEqual(["Real change"]);
  });

  it("defaults group title when header line is empty", () => {
    const markdown = `# Changelog\n\n## [1.0.0]\n\n### \n\n- Fix item\n`;
    const entries = parseChangelog(markdown);
    expect(entries[0]?.title).toBe("");
  });
});
