"use client";

import { useState, type ReactNode } from "react";

export type MeasureTab = { id: string; label: string; content: ReactNode };

/** One server-drawn chart at a time; the others stay mounted so each keeps its selected day. */
export function MeasureTabs({ id, label, tabs }: { id: string; label: string; tabs: MeasureTab[] }) {
  const [selected, setSelected] = useState(tabs[0]?.id);
  return (
    <div className="dd-measures">
      <div className="obs-options dd-measure-options" role="group" aria-label={label}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" aria-pressed={tab.id === selected} aria-controls={`${id}-${tab.id}`} onClick={() => setSelected(tab.id)}>
            {tab.label}
            {tab.id === selected ? <span aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`${id}-${tab.id}`} className="dd-measure" hidden={tab.id !== selected}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
