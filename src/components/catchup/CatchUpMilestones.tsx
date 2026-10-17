"use client";

import { createContext, useContext, type ReactNode } from "react";
import { CATCH_UP_MILESTONES, type CatchUpMilestone } from "@/lib/catchUpContent";

const MilestonesContext = createContext<{ milestones: readonly CatchUpMilestone[]; unavailable: boolean }>({ milestones: CATCH_UP_MILESTONES, unavailable: false });

export function CatchUpMilestones({ milestones, unavailable, children }: { milestones: readonly CatchUpMilestone[]; unavailable: boolean; children: ReactNode }) {
  return <MilestonesContext.Provider value={{ milestones, unavailable }}>{children}</MilestonesContext.Provider>;
}

export function useCatchUpMilestones() { return useContext(MilestonesContext); }
