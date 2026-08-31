import { beforeAll, vi } from "vitest";

/**
 * jsdom lacks `window.matchMedia` (framer-motion's useReducedMotion) and
 * `window.IntersectionObserver` (motion's whileInView / CountUp's useInView).
 * Call once in a test file's beforeAll — both stubs are inert for suites that
 * never touch them.
 */
export function installDomPolyfills(): void {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    class MockIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: number[] = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    }
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      value: MockIntersectionObserver,
    });
  });
}
