import { setScannerPolicy } from "@/app/admin/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { AutomationControlState } from "@/lib/automation/settings";
import type { TavilyMonthUsage } from "@/lib/scannerSettings.server";

export function ScannerScheduleSettings({ control, tavilyUsage, preview = false }: {
  control: AutomationControlState | null;
  tavilyUsage: TavilyMonthUsage;
  preview?: boolean;
}) {
  return <section aria-labelledby="scanner-schedule-heading" className="workspace-panel">
    <h2 id="scanner-schedule-heading">Scanner schedule and searches</h2>
    <p className="ai-description">Choose when the scanner runs and limit its search credits. Search credits are separate from the AI budget above.</p>
    {preview && <p className="ai-description">Sample schedule and search limits. This preview does not read or change them.</p>}
    {control ? <form action={preview ? undefined : setScannerPolicy} className="decision-form dispatch-field">
      <input type="hidden" name="minIntervalMinutes" value={control.minIntervalMinutes} />
      <label><span>How often</span><select name="cadence" disabled={preview} defaultValue={control.paused ? "paused" : String(control.minIntervalMinutes)}>
        <option value="60">Hourly</option><option value="120">Every 2 hours</option>
        <option value="360">Every 6 hours</option><option value="1440">Daily</option><option value="paused">Paused</option>
      </select></label>
      <label><span>Search depth</span><select name="scheduledSearchCreditsPerRun" disabled={preview} defaultValue={String(control.scheduledSearchCreditsPerRun)}>
        <option value="1">1 search / run</option><option value="2">2 searches / run</option><option value="3">3 searches / run</option>
      </select></label>
      <label><span>Monthly search cap</span><input name="monthlyTavilyCreditCap" disabled={preview} type="number" min="0" max="1000" step="1" defaultValue={control.monthlyTavilyCreditCap} /></label>
      <p className="op-note">{tavilyUsage.state === "available"
        ? `Tavily credits this month: ${tavilyUsage.used} of ${control.monthlyTavilyCreditCap} used or held (searches and page extracts; held means a call is running or its charge is unconfirmed)${
          control.monthlyTavilyCreditCap === 0 ? "; searches are off because the cap is 0"
          : tavilyUsage.used >= control.monthlyTavilyCreditCap ? "; the cap is reached, so searches stop until next month"
          : tavilyUsage.pace === null ? ""
          : tavilyUsage.pace >= control.monthlyTavilyCreditCap ? ", on pace to reach the cap before month end" : `, about ${tavilyUsage.pace} by month end at this pace`}. `
        : "Tavily credit usage this month could not be read. "}
        Search depth is a per-scan maximum; most scans use fewer, because only broad-discovery scans use every search. The monthly cap stops searches at {control.monthlyTavilyCreditCap}.</p>
      {!preview && <SubmitButton className="dispatch-btn" pendingText="Saving...">Save scanner settings</SubmitButton>}
    </form> : <p className="workspace-error" role="alert">Scanner settings could not be read. Reload before changing the schedule or search limits.</p>}
  </section>;
}
