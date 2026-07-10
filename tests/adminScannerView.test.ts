import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminScannerView } from "@/components/scanner/AdminScannerView";

vi.mock("@/app/admin/actions", () => ({ setScannerPolicy: vi.fn() }));

type InputProps = {
  children?: ReactNode;
  name?: string;
  min?: string;
  max?: string;
};

function findInput(node: ReactNode, name: string): ReactElement<InputProps> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<InputProps>;
  if (element.props.name === name) return element;
  for (const child of Children.toArray(element.props.children)) {
    const found = findInput(child, name);
    if (found) return found;
  }
  return null;
}

describe("AdminScannerView", () => {
  it("keeps the owner-approved two-dollar LLM cap inside native form validation", () => {
    const view = AdminScannerView({
      runs: [],
      signals: [],
      rejectedCandidates: [],
      control: {
        paused: false,
        minIntervalMinutes: 60,
        scheduledSearchCreditsPerRun: 1,
        monthlyTavilyCreditCap: 1000,
        monthlyLlmUsdCap: 2,
        modelPreset: "deepseek_v4_flash",
        updatedAt: null,
      },
      activeRun: null,
      latestRealRun: null,
      latestFind: null,
      scoreboard: {} as never,
      features: { turnstile: false, reddit: false, ai: true, xSearch: false, webSearch: true, automation: true },
      integrations: [],
    });

    const input = findInput(view, "monthlyLlmUsdCap");
    expect(input?.props.min).toBe("0");
    expect(input?.props.max).toBe("2");
  });
});
