import type { ReactNode } from "react";
import { deleteColumnBurst, saveColumnBurst, saveColumnCadence } from "@/app/operator/column-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { nextSlot } from "@/lib/editorials/cadence";
import { resolveWriterModel } from "@/lib/editorials/config";
import { formatUtcTimestamp } from "@/lib/editorials/content";
import { COLUMN_PROVIDERS, WRITER_MODEL_LABELS, WRITER_MODELS, isWriterModel, type ColumnProvider } from "@/lib/editorials/models";
import { CADENCE_MODES, RELEVANCE_LEVELS, WEEKDAYS, type ColumnBurst, type ColumnSettings } from "@/lib/editorials/settings";

const MODE_LABELS = { weekly: "Weekly", "2x": "Twice a week", "3x": "Three times a week" } as const;
const RELEVANCE_LABELS = { always: "Always write", normal: "Normal (score 2 or more)", strict: "Strict (score 4 or more)" } as const;
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" } as const;
const PROVIDER_LABELS: Record<ColumnProvider, string> = { anthropic: "Anthropic (API credit)", openrouter: "OpenRouter (column key)" };

function modelName(model: string | null): string {
  if (!model) return "not set";
  return isWriterModel(model) ? WRITER_MODEL_LABELS[model] : `${model} (not allowed)`;
}

function Button({ disabled, children, danger = false }: { disabled: boolean; children: ReactNode; danger?: boolean }) {
  const className = `workspace-button${danger ? " workspace-button--danger" : ""}`;
  return disabled ? <button type="submit" className={className} disabled>{children}</button> : <SubmitButton className={className} pendingText="Saving…">{children}</SubmitButton>;
}

function ModelSelect({ name, value, emptyLabel, id }: { name: string; value: string | null; emptyLabel?: string; id: string }) {
  return <select id={id} name={name} defaultValue={value ?? ""}>
    {emptyLabel ? <option value="">{emptyLabel}</option> : null}
    {WRITER_MODELS.map((model) => <option key={model} value={model}>{WRITER_MODEL_LABELS[model]}</option>)}
  </select>;
}

function HourSelect({ name, value, id }: { name: string; value: number; id: string }) {
  return <select id={id} name={name} defaultValue={String(value)}>
    {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00 UTC`}</option>)}
  </select>;
}

function BurstFields({ burst, prefix }: { burst: ColumnBurst | null; prefix: string }) {
  return <div className="workspace-grid column-burst-fields">
    {burst ? <input type="hidden" name="id" value={burst.id} /> : null}
    <div className="workspace-field"><label htmlFor={`${prefix}-label`}>Label</label><input id={`${prefix}-label`} name="label" required maxLength={60} defaultValue={burst?.label ?? ""} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-model`}>Writer</label><ModelSelect id={`${prefix}-model`} name="model" value={burst?.model ?? "claude-opus-5-5"} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-start`}>First day (UTC)</label><input id={`${prefix}-start`} name="startDate" type="date" required defaultValue={burst?.startDate ?? ""} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-end`}>Last day (UTC)</label><input id={`${prefix}-end`} name="endDate" type="date" required defaultValue={burst?.endDate ?? ""} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-hour`}>Daily at</label><HourSelect id={`${prefix}-hour`} name="hourUtc" value={burst?.hourUtc ?? 14} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-hold`}>Hold (hours)</label><input id={`${prefix}-hold`} name="holdHours" type="number" min={0} max={168} required defaultValue={burst?.holdHours ?? 8} /></div>
    <div className="workspace-field"><label htmlFor={`${prefix}-relevance`}>Relevance</label>
      <select id={`${prefix}-relevance`} name="relevance" defaultValue={burst?.relevance ?? ""}>
        <option value="">Same as the base schedule</option>
        {RELEVANCE_LEVELS.map((level) => <option key={level} value={level}>{RELEVANCE_LABELS[level]}</option>)}
      </select>
    </div>
    <label className="workspace-field column-checkbox"><input type="checkbox" name="enabled" defaultChecked={burst?.enabled ?? false} /> Enabled</label>
  </div>;
}

/** The cadence dials, the provider switch and the burst list, with the next slot they produce. */
export function ColumnCadence({ settings, keys, now, writesDisabled }: {
  settings: ColumnSettings;
  keys: Record<ColumnProvider, boolean>;
  now: Date;
  writesDisabled: boolean;
}) {
  const slot = nextSlot(settings, now);
  const writer = resolveWriterModel({ nextEditionModel: settings.nextEditionModel, burstModel: slot?.burst?.model ?? null, defaultWriterModel: settings.defaultWriterModel });
  const provider = COLUMN_PROVIDERS.find((value) => value === settings.provider) ?? null;
  return <section className="workspace-panel" aria-labelledby="column-cadence-heading">
    <div className="workspace-panel-header">
      <div>
        <h2 id="column-cadence-heading">Schedule and writer</h2>
        <p>{slot
          ? `Next slot: ${formatUtcTimestamp(slot.at.toISOString())}${slot.burst ? ` (${slot.burst.label})` : ""} · ${writer.ok ? WRITER_MODEL_LABELS[writer.model] : `${writer.requested}, not allowed: the slot will skip`} · ${slot.holdHours}-hour hold · ${RELEVANCE_LABELS[slot.relevance].toLowerCase()}`
          : "No slot in the next two weeks."}</p>
      </div>
    </div>
    <div className="workspace-panel-body">
      <p className="workspace-note">{provider
        ? `Provider: ${PROVIDER_LABELS[provider]}. ${keys[provider] ? "Its key is set." : "Its key is missing, so each slot skips as provider unavailable and nothing is called."}`
        : `Provider "${settings.provider}" is not recognized, so each slot skips as provider unavailable.`}</p>
      <form action={saveColumnCadence} className="workspace-form">
        <div className="workspace-grid column-cadence-grid">
          <div className="workspace-field"><label htmlFor="column-mode">Cadence</label>
            <select id="column-mode" name="mode" defaultValue={settings.mode}>{CADENCE_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}</select>
          </div>
          <fieldset className="workspace-field column-days"><legend>Days (one, two or three, to match the cadence)</legend>
            {WEEKDAYS.map((day) => <label key={day}><input type="checkbox" name="days" value={day} defaultChecked={settings.days.includes(day)} /> {DAY_LABELS[day]}</label>)}
          </fieldset>
          <div className="workspace-field"><label htmlFor="column-hour">Hour</label><HourSelect id="column-hour" name="hourUtc" value={settings.hourUtc} /></div>
          <div className="workspace-field"><label htmlFor="column-hold">Hold before publishing (hours)</label><input id="column-hold" name="holdHours" type="number" min={0} max={168} required defaultValue={settings.holdHours} /></div>
          <div className="workspace-field"><label htmlFor="column-relevance">Relevance threshold</label>
            <select id="column-relevance" name="relevance" defaultValue={settings.relevance}>{RELEVANCE_LEVELS.map((level) => <option key={level} value={level}>{RELEVANCE_LABELS[level]}</option>)}</select>
          </div>
          <div className="workspace-field"><label htmlFor="column-gap">Minimum gap between editions (hours)</label><input id="column-gap" name="minGapHours" type="number" min={0} max={168} required defaultValue={settings.minGapHours} /></div>
          <div className="workspace-field"><label htmlFor="column-default-writer">Default writer</label><ModelSelect id="column-default-writer" name="defaultWriterModel" value={isWriterModel(settings.defaultWriterModel) ? settings.defaultWriterModel : null} emptyLabel="Not set (COLUMN_WRITER_MODEL, else Opus 5.5)" /></div>
          <div className="workspace-field"><label htmlFor="column-next-writer">Next edition only</label><ModelSelect id="column-next-writer" name="nextEditionModel" value={isWriterModel(settings.nextEditionModel) ? settings.nextEditionModel : null} emptyLabel="No override" /></div>
          <div className="workspace-field"><label htmlFor="column-cap">Monthly cap (USD, at most 50)</label><input id="column-cap" name="monthlyCapUsd" type="number" min={0} max={50} step="0.01" placeholder="15 (default)" defaultValue={settings.monthlyCapUsd ?? ""} /></div>
          <div className="workspace-field"><label htmlFor="column-provider">Provider</label>
            <select id="column-provider" name="provider" defaultValue={provider ?? "anthropic"}>{COLUMN_PROVIDERS.map((value) => <option key={value} value={value}>{PROVIDER_LABELS[value]}</option>)}</select>
          </div>
        </div>
        <p className="workspace-note">Current default writer: {modelName(settings.defaultWriterModel)}. Next-edition override: {modelName(settings.nextEditionModel)}; it clears after the next real edition.</p>
        <div><Button disabled={writesDisabled}>Save schedule</Button></div>
      </form>
    </div>
    <div className="workspace-panel-body column-bursts">
      <h3>Bursts</h3>
      <p className="workspace-note">An enabled burst writes daily on its days and replaces the base schedule while it runs.</p>
      {settings.bursts.length ? <ul className="column-burst-list">{settings.bursts.map((burst) => <li key={burst.id}>
        <details>
          <summary><strong>{burst.label}</strong> · {burst.enabled ? "enabled" : "disabled"} · {burst.startDate} to {burst.endDate} · {modelName(burst.model)}</summary>
          <form action={saveColumnBurst} className="workspace-form"><BurstFields burst={burst} prefix={`burst-${burst.id}`} /><div><Button disabled={writesDisabled}>Save burst</Button></div></form>
          <form action={deleteColumnBurst}><input type="hidden" name="id" value={burst.id} /><Button disabled={writesDisabled} danger>Delete burst</Button></form>
        </details>
      </li>)}</ul> : <p className="workspace-note">No bursts.</p>}
      <details>
        <summary>Add a burst</summary>
        <form action={saveColumnBurst} className="workspace-form"><BurstFields burst={null} prefix="burst-new" /><div><Button disabled={writesDisabled}>Add burst</Button></div></form>
      </details>
    </div>
  </section>;
}
