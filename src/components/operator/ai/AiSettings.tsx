"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AI_PRICE_HEADROOM, type AiDashboard, type AiMetadata, type AiProfile, type AiTestResult } from "@/lib/aiSettings/types";
import type { AiReasoning, AiRetention } from "@/lib/aiSettings/types";
import "./ai-settings.css";

const button = "workspace-button";
const primaryButton = `${button} workspace-button--primary`;
type Section = "Models" | "Spending & recovery" | "Activity";
type Inspection = { endpoints: { tag: string; name: string }[]; metadata: AiMetadata; compatible: boolean; testCeilingUsd: number | null; quote: string | null };
export type SetupInput = { endpointTag?: string; modelId: string; reasoning: AiReasoning; retention: AiRetention; maxOutputTokens: number };
export type AiSettingsTransport = { read: () => Promise<AiDashboard>; command: <T>(value: unknown) => Promise<T> };
const testCost = (value: number) => `$${value.toFixed(9)}`;
const money = (value: number) => `$${value.toFixed(value > 0 && value < 0.01 ? 5 : 2)}`;
const rate = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value));
const quoteDate = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: "UTC" }).format(new Date(value));
function incompatibilityMessage(metadata: AiMetadata | undefined): string {
  if (metadata?.pricingIssue === "unknown_pricing") return "Unknown pricing. The maximum request cost cannot be verified, so testing and activation are disabled.";
  if (metadata?.pricingIssue === "additional_charges") return "Additional charges cannot be bounded, so testing and activation are disabled.";
  if (metadata?.pricingIssue === "tiered_pricing") return "Tiered pricing is not supported, so testing and activation are disabled.";
  return "No available provider meets this scanner check's format, output limit, reasoning, retention, pricing and context requirements. Try different settings or another model.";
}
function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    sample_test: "Sample model test",
    sample_primary_activated: "Primary sample model activated",
    sample_backup_activated: "Backup sample model saved",
    sample_rollback: "Previous model restored",
    sample_policy: "Sample spending and recovery settings saved",
    policy_saved: "Spending and recovery settings saved",
    connection_saved: "OpenRouter connection saved",
    primary_activated: "Primary model activated",
    backup_activated: "Backup model saved",
    primary_rolled_back: "Previous configuration restored",
    ai_request_success: "Scanner AI completed",
    ai_request_failure: "Scanner AI needs attention",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}
function activityDetail(action: string, detail: string): string {
  if (action !== "ai_request_success" && action !== "ai_request_failure") return detail;
  if (action === "ai_request_success") return "The scanner received a valid response with verified cost.";
  const reasons: Record<string, string> = {
    timeout: "The provider did not respond in time.",
    transport_failure: "The connection to the provider failed.",
    http_failure: "The provider rejected or could not complete the request.",
    decode_failure: "The provider response could not be read.",
    validation_failure: "The response did not pass the scanner's checks.",
    cost_unverified: "The charge could not be verified. Its reservation remains held.",
    budget_exceeded: "The charge exceeded its reserved ceiling. Further paid work is blocked.",
    openrouter_provider_failure: "The provider could not complete the request.",
    openrouter_invalid_json: "The response did not pass the scanner's checks.",
    openrouter_cost_unverified: "The charge could not be verified. Its reservation remains held.",
    openrouter_budget_exceeded: "The charge exceeded its reserved ceiling. Further paid work is blocked.",
    openrouter_no_route: "No provider route met the model's settings and price limits.",
  };
  try {
    const value: unknown = JSON.parse(detail);
    if (value && typeof value === "object" && "code" in value && typeof value.code === "string" && reasons[value.code]) return reasons[value.code];
  } catch { /* Older records may lack a structured reason. */ }
  return "AI requests stopped for that scan. Review scanner diagnostics for the cause.";
}
const errors: Record<string, string> = {
  unauthorized: "Your session expired. Sign in again, then retry.", invalid_origin: "This request could not be verified. Reload the workspace.",
  preview_writes_disabled: "Live AI controls are disabled in this environment.", invalid_request: "Check the fields and try again.",
  ai_settings_unavailable: "AI settings are unavailable. Your existing scanner configuration has not been replaced.",
  encryption_not_configured: "Secure key storage needs its server setup before you can save a key.",
  credential_unavailable: "The saved key cannot be opened. Secure storage needs attention before testing.",
  connection_required: "Connect OpenRouter before inspecting or testing a model.",
  provider_authentication: "OpenRouter did not accept the key. Check its validity and permissions.",
  provider_timeout: "OpenRouter did not respond in time. Try again later.", provider_rate_limit: "OpenRouter is limiting requests. Wait before trying again.",
  provider_provider: "OpenRouter could not complete the request. Try again later.", provider_model_not_found: "That exact model ID was not found. Refresh the catalogue or check the ID.",
  provider_invalid_metadata: "OpenRouter's model information could not be verified. Try again later.",
  pricing_unsupported: "OpenRouter pricing changed or cannot be bounded for this model. Inspect the current metadata before testing or activation.",
  model_incompatible: "This model no longer meets the scanner’s format, context, output, reasoning, or pricing requirements. Inspect it again before testing or activation.",
  no_compatible_endpoint: "No available provider meets these scanner settings. Inspect the model again or choose another model.",
  ai_quote_changed: "The provider, price, capabilities or connection changed. No test was sent. Inspect the model again and review the new quote.",
  test_exceeds_limit: "This test would exceed the one-cent ceiling or your request limit. Choose a cheaper model or a lower output limit.",
  context_too_small: "The model's reported context window cannot safely fit this scanner check.",
  test_already_started: "This test was already submitted. Refresh to check its receipt before starting another.",
  qualification_deadline: "Setup did not finish within its time budget. No test request was sent. Check activity before starting another test.",
  test_receipt_unavailable: "The test receipt was not acknowledged. Review activity and accounting before another test. Activation is unavailable.",
  ai_revision_conflict: "Settings changed in another session. Refresh before applying your change.",
  ai_connection_conflict: "The connection changed in another session. Refresh before replacing it.",
  ai_spending_blocked: "The spending ledger blocked this request. Check the allowance and unresolved charges.",
  ai_test_not_valid: "A current, passed test with verified cost is required. Test this configuration again.",
  ai_connection_changed: "The key changed after this test. Test again with the current connection.",
};

const liveTransport: AiSettingsTransport = {
  async read() {
    const response = await fetch("/api/admin/ai-settings", { cache: "no-store" });
    if (!response.ok) throw new Error(errors.ai_settings_unavailable);
    return response.json() as Promise<AiDashboard>;
  },
  async command<T>(value: unknown): Promise<T> {
  const response = await fetch("/api/admin/ai-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? "The request could not be completed. Refresh to check its status before retrying.");
  return result as T;
  },
};

export function AiSettings({ initial, transport = liveTransport, preview = false, scannerSettings }: { initial: AiDashboard | null; transport?: AiSettingsTransport; preview?: boolean; scannerSettings?: ReactNode }) {
  const [data, setData] = useState(initial);
  const [section, setSection] = useState<Section>("Models");
  const [editing, setEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial ? "" : errors.ai_settings_unavailable);
  const [message, setMessage] = useState("");
  const setupButton = useRef<HTMLButtonElement>(null);
  const configuration = data?.configuration;
  const connection = data?.connections[0];
  const active = configuration?.active;
  async function refresh() {
    setBusy(true); setError("");
    try { setData(await transport.read()); }
    catch (error) { setError(error instanceof Error ? error.message : errors.ai_settings_unavailable); }
    finally { setBusy(false); }
  }
  async function update(value: unknown, notice: string) {
    setBusy(true); setError(""); setMessage("");
    try { setData(await transport.command<AiDashboard>(value)); setMessage(preview ? "Preview only. No production settings changed." : notice); return true; }
    catch (error) { setError(error instanceof Error ? error.message : errors.ai_settings_unavailable); return false; }
    finally { setBusy(false); }
  }
  async function saveConnection(event: FormEvent) {
    event.preventDefault();
    try { if (await update({ action: "connection", key, version: connection?.version ?? 0 }, "OpenRouter connection saved. Test a model before activating it.")) setConnecting(false); }
    finally { setKey(""); }
  }
  function closeSetup() { setEditing(false); requestAnimationFrame(() => setupButton.current?.focus()); }
  return <div className="workspace-page ai-settings">
    <header className="workspace-heading"><div><h1>AI settings</h1><p>Choose how the scanner reads sources. Know what it costs and when it needs you.</p></div><button ref={setupButton} className={primaryButton} disabled={busy || !data?.available || editing} onClick={() => { setSection("Models"); setEditing(true); setError(""); }}>Set up a model</button></header>
    {preview ? <div className="ai-preview-note" role="note"><strong>Design preview · sample data</strong><span>Models, capabilities, costs, tests and history are illustrative. Controls change this page only. No provider or server is contacted, no key is stored, and reload resets the preview.</span></div> : (!data?.available || !data.encryptionReady) && <div className="ai-preview-note"><strong>Setup needed</strong><span>{!data?.available ? "The database setup is not available yet. Existing scanner settings remain in use." : "The server encryption secret must be configured before saving a new key. The existing server connection can still be used."}</span></div>}
    <div className="ai-overview"><section aria-labelledby="ai-current-heading" className="ai-current"><div className="ai-section-line"><h2 id="ai-current-heading">Scanner model</h2><span className="ai-status">{preview ? "Sample configuration" : active ? "Configured" : "Existing configuration"}</span></div><p className="ai-model-name">{active?.metadata.name ?? "Current scanner settings"}</p><p className="ai-subtitle">{active ? `OpenRouter · ${active.reasoning} reasoning` : "Preserved until you activate a tested model"}</p><p className="ai-description">Reads issue reports and matches official fix claims. Source discovery and publication rules stay separate.</p>{active ? <button className="workspace-text-link" disabled={busy || (preview && !configuration?.previous)} onClick={() => update({ action: "rollback", revision: configuration!.revision }, "Previous configuration restored for subsequent scans.")}>{preview ? "Restore previous model" : "Restore previous configuration"}</button> : <button className="workspace-text-link" onClick={() => setSection("Spending & recovery")}>View spending and schedule</button>}</section>
      <section className="ai-allowance" aria-labelledby="ai-allowance-heading"><div className="ai-section-line"><h2 id="ai-allowance-heading">Monthly allowance</h2><button className="workspace-text-link" onClick={() => setSection("Spending & recovery")}>Edit allowance</button></div><dl className="ai-budget-facts"><div><dt>Verified cost</dt><dd>{data ? money(Math.max(0, data.spend.committedUsd - data.spend.uncertainUsd - data.spend.estimatedUsd)) : "Unavailable"}</dd></div><div><dt>Estimated, older scans</dt><dd>{data ? money(data.spend.estimatedUsd) : "Unavailable"}</dd></div><div><dt>Unverified, held</dt><dd>{data ? money(data.spend.uncertainUsd) : "Unavailable"}</dd></div><div><dt>Limit</dt><dd>{configuration ? money(configuration.policy.monthlyUsd) : "Unavailable"}</dd></div></dl><p className="ai-description">UTC billing month. Tests and both models share this allowance. Unresolved charges stay reserved until their UTC month ends. They remain in the records but do not count against later months.</p>{data?.spend.blocked && <p className="workspace-error">Paid work is blocked by the accounting safety checks. Review scanner diagnostics.</p>}</section></div>
    <div className="ai-section-nav" role="group" aria-label="AI settings sections">{(["Models", "Spending & recovery", "Activity"] as const).map((item) => <button key={item} aria-pressed={section === item} onClick={() => { setSection(item); setMessage(""); }}>{item}</button>)}</div>
    {error && <p className="workspace-error" role="alert">{error} <button className="workspace-text-link" onClick={refresh} disabled={busy}>Refresh</button></p>}<p className="ai-live-message" role="status">{message}</p>
    {section === "Models" && (editing && data ? <LiveModelSetup data={data} transport={transport} preview={preview} onDataChanged={() => transport.read().then(setData)} onCancel={closeSetup} onActivate={async (test, role) => { if (await update({ action: "activate", revision: data.configuration.revision, testId: test.id, role }, `${role === "primary" ? "Primary" : "Backup"} model saved. Changes apply to subsequent scans.`)) closeSetup(); }} /> : <>
      <section className="ai-model-register"><div className="ai-section-line"><div><h2>Your models</h2><p className="ai-description">A tested primary model, with an optional backup you choose.</p></div></div><ModelRow label="Primary" profile={active ?? null} empty="Existing scanner configuration" note="Used for scheduled scans" preview={preview}/><ModelRow label="Backup" profile={configuration?.backup ?? null} empty="No backup selected" note={configuration?.policy.recovery === "backup" ? "Recovery enabled" : "Optional; recovery not enabled"} preview={preview}/></section>
      <div className="ai-two-column"><section><h2>Connection</h2><p className="ai-description">One OpenRouter key. Models can change without replacing it.</p><div className="ai-connection-row"><strong>OpenRouter</strong><span className={connection?.configured ? "ai-status" : "ai-status ai-status--quiet"}>{preview && connection?.configured ? "Sample server connection" : connection?.configured ? connection.source === "environment" ? "Existing server key" : "Key saved" : "Not connected"}</span><button className="workspace-text-link" disabled={preview ? busy : !data?.available || !data.encryptionReady || busy} onClick={() => setConnecting(!connecting)}>{preview ? "View sample connection" : connection?.configured ? "Replace key" : "Connect OpenRouter"}</button></div>
        {connecting && <form className="ai-setup-form" onSubmit={saveConnection}><div className="workspace-field"><label htmlFor="ai-live-key">OpenRouter API key</label><input id="ai-live-key" type="password" autoComplete="off" spellCheck={false} value={preview ? "" : key} minLength={20} maxLength={1024} required={!preview} disabled={busy || preview} placeholder={preview ? "Unavailable in design preview" : undefined} onChange={(event) => setKey(event.target.value)}/><small>{preview ? "A sample server connection is shown. Key entry is disabled in this preview." : "The server checks the key without generating text, then stores it encrypted. Replacing it pauses configured AI until you test and activate again."}</small></div>{!preview && <><button className={primaryButton} disabled={busy}>{busy ? "Checking connection…" : "Check and save key"}</button><button type="button" className="workspace-text-link" disabled={busy} onClick={() => { setKey(""); setConnecting(false); }}>Cancel</button></>}</form>}</section>
        <aside className="ai-side-note"><h2>Test the work it will do</h2><p>Inspect current provider information, then run six short scanner examples. Review each result before activating a model.</p><p>Scans accept a pinned provider&apos;s price up to {AI_PRICE_HEADROOM}× the saved quote, within your per-request limit. A larger change blocks routing. Inspect a fresh quote, review it, run the bounded check, then explicitly activate only a passing configuration with verified cost.</p><p>A small test is preliminary evidence. It cannot establish overall accuracy or guarantee future availability.</p><button className="workspace-text-link" disabled={!data?.available} onClick={() => setEditing(true)}>Compare a model</button></aside></div>
    </>)}
    {section === "Spending & recovery" && data && <LivePolicy key={data.configuration.revision} data={data} busy={busy} preview={preview} onSave={(policy) => update({ action: "policy", revision: data.configuration.revision, policy }, "Spending and recovery settings saved.")}/>}
    {section === "Spending & recovery" && scannerSettings}
    {section === "Activity" && <section aria-labelledby="ai-activity-heading"><h2 id="ai-activity-heading">Changes and test history</h2><p className="ai-description">{preview ? "Sample activity from this preview visit. This is not a production audit log." : "Recent configuration changes and observed scanner results. Tests do not publish content."}</p>{data?.tests.map((test) => <TestEvidence key={test.id} test={test} preview={preview}/>)}<ol className="ai-activity-list">{data?.activity.map((item) => <li key={item.id}><span className="ai-activity-marker" aria-hidden="true"/><div><strong>{activityLabel(item.action)}</strong><p>{activityDetail(item.action, item.detail)}</p></div><span>{preview ? "This visit" : `${date(item.createdAt)} ET`}</span></li>)}</ol>{!data?.tests.length && !data?.activity.length && <div className="ai-empty"><h3>No recorded activity yet</h3><p>Your tests and configuration changes will appear here.</p></div>}</section>}
  </div>;
}

function ModelRow({ label, profile, empty, note, preview }: { label: string; profile: AiProfile | null; empty: string; note: string; preview: boolean }) {
  return <div className="ai-model-row"><div><strong>{label}</strong><span>{note}</span></div><div><h3>{profile?.metadata.name ?? empty}</h3>{profile && <><code>{profile.modelId}</code><span>OpenRouter{profile.metadata.endpoint ? ` · ${profile.metadata.endpoint.name} · ${profile.metadata.endpoint.tag}` : ""} · {profile.reasoning} reasoning · {profile.retention === "zdr" ? "Zero data retention required" : "Standard retention allowed"} · {profile.maxOutputTokens.toLocaleString()} output tokens maximum</span><span>Saved price quote / 1M tokens: {profile.metadata.inputUsdPerMillion === null ? "Unknown" : rate(profile.metadata.inputUsdPerMillion)} input · {profile.metadata.outputUsdPerMillion === null ? "Unknown" : rate(profile.metadata.outputUsdPerMillion)} output{profile.metadata.endpoint ? ` · scans accept up to ${AI_PRICE_HEADROOM}×` : ""}</span><span>Quote retrieved {quoteDate(profile.metadata.fetchedAt)}{preview ? " · sample" : ""}</span></>}</div><span className="ai-status ai-status--quiet">{profile ? preview ? "Sample model" : "Tested configuration" : "Not set here"}</span></div>;
}

function LivePolicy({ data, busy, preview, onSave }: { data: AiDashboard; busy: boolean; preview: boolean; onSave: (policy: AiDashboard["configuration"]["policy"]) => Promise<boolean> }) {
  const [monthly, setMonthly] = useState(String(data.configuration.policy.monthlyUsd));
  const [request, setRequest] = useState(String(data.configuration.policy.requestUsd));
  const [recovery, setRecovery] = useState(data.configuration.policy.recovery);
  return <form onSubmit={(event) => { event.preventDefault(); void onSave({ monthlyUsd: Number(monthly), requestUsd: Number(request), recovery }); }}><section className="ai-policy-section"><div><h2>Spending limits</h2><p className="ai-description">A larger allowance permits more spending. It does not automatically change quality or scan frequency.</p></div><div className="ai-form-grid"><div className="workspace-field"><label htmlFor="ai-live-month">Monthly allowance (USD)</label><input id="ai-live-month" type="number" required min="0" max="1000" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={busy}/></div><div className="workspace-field"><label htmlFor="ai-live-request">Maximum per request (USD)</label><input id="ai-live-request" type="number" required min="0.000001" max="1" step="0.000001" value={request} onChange={(e) => setRequest(e.target.value)} disabled={busy}/></div><p className="ai-inline-note">Includes input, output and reasoning. Setup tests also have a $0.01 total ceiling. OpenRouter&apos;s own key limit still applies. Until a model is activated here, the existing scanner allowance can be lower.</p></div></section><section className="ai-policy-section"><div><h2>When a request fails</h2><p className="ai-description">The scanner stops AI calls for that run after a failure. Collection continues under its existing rules.</p></div><fieldset className="ai-choice-list" disabled={busy}><legend>On subsequent scans</legend><label><input type="radio" checked={recovery === "next_scan"} onChange={() => setRecovery("next_scan")}/><span><strong>Wait for the next scan</strong><small>Keep your normal schedule. No rapid retry loop.</small></span></label><label><input type="radio" checked={recovery === "backup"} disabled={!data.configuration.backup} onChange={() => setRecovery("backup")}/><span><strong>Use my approved backup</strong><small>After two consecutive primary request failures within 24 hours, use the tested backup on the next scan. Try the primary again after a four-hour cooldown.</small></span></label><p className="ai-inline-note">Budget and accounting blocks stop both models. Choosing a backup never increases the allowance.</p></fieldset></section><div className="ai-form-footer"><span>{preview ? "Sample settings last for this page visit." : "Changes apply to subsequent scans."}</span><button className={primaryButton} disabled={busy || !data.available}>{busy ? "Saving…" : preview ? "Save preview settings" : "Save settings"}</button></div></form>;
}

function TestEvidence({ test, preview }: { test: AiTestResult; preview: boolean }) {
  return <div className="ai-test-results"><div className="ai-section-line"><h3>{test.profile.metadata.name} · {preview ? "sample scanner check" : "scanner check"}</h3><span className={test.passed ? "ai-status" : "ai-status ai-status--quiet"}>{test.passed ? `${test.cases.filter((item) => item.passed).length} of 6 ${preview ? "sample cases passed" : "passed"}` : test.outcome.replaceAll("_", " ")}</span></div><p className="ai-description">OpenRouter{test.profile.metadata.endpoint ? ` · ${test.profile.metadata.endpoint.name}` : ""} · {test.profile.reasoning} reasoning · {preview ? "Illustrative sample results; no provider was called." : `${date(test.createdAt)} ET. This small check is not a model ranking.`}</p><ul>{test.cases.map((item) => <li key={item.name}><details><summary><span>{item.name}</span><span className={item.passed ? "ai-status" : "ai-status ai-status--quiet"}>{item.passed ? preview ? "Sample pass" : "Passed" : "Did not pass"}</span></summary><p><strong>Expected:</strong> {item.expected}</p><p><strong>{preview ? "Sample result" : "Observed"}:</strong> {item.detail}</p>{!preview && item.attempt && <><p>Request: {item.attempt.outcome.replaceAll("_", " ")} · Provider cost: {item.attempt.costUsd === null ? "Unverified" : testCost(item.attempt.costUsd)} · Reserved: {testCost(item.attempt.reservedUsd)}</p><p>Headers: {item.attempt.timings.headersAfterMs === null ? "Not received" : `${item.attempt.timings.headersAfterMs} ms`} · Full response: {item.attempt.timings.bodyAfterMs === null ? "Not received" : `${item.attempt.timings.bodyAfterMs} ms`} · Validation: {item.attempt.timings.validationMs === null ? "Not run" : `${item.attempt.timings.validationMs} ms`}</p></>}</details></li>)}</ul><dl className="ai-result-facts"><div><dt>Time</dt><dd>{preview ? "Not measured" : `${(test.latencyMs / 1000).toFixed(1)} seconds`}</dd></div><div><dt>{preview ? "Sample cost" : "Provider cost"}</dt><dd>{preview ? "$0.00 · no provider call" : test.costUsd === null ? "Unverified" : testCost(test.costUsd)}</dd></div><div><dt>{preview ? "Sample ceiling" : "Reserved ceiling"}</dt><dd>{preview ? money(test.reservedUsd) : testCost(test.reservedUsd)}</dd></div></dl>{test.costState === "unknown" && <p className="workspace-error">{preview ? "Sample timeout: a live request could have an unknown provider charge and would keep its reservation. No request was sent in this preview." : test.outcome === "accounting_unconfirmed" ? "Final accounting was not acknowledged. Each request’s cost evidence is preserved below; activation is unavailable." : "The total provider charge is unknown. The full reservation remains held; verified case costs are included within it, not charged again. Activation is unavailable."}</p>}</div>;
}

function LiveModelSetup({ data, transport, preview, onDataChanged, onCancel, onActivate }: { data: AiDashboard; transport: AiSettingsTransport; preview: boolean; onDataChanged: () => Promise<void>; onCancel: () => void; onActivate: (test: AiTestResult, role: "primary" | "backup") => Promise<void> }) {
  const [input, setInput] = useState<SetupInput>({ modelId: data.configuration.active?.modelId ?? "", reasoning: data.configuration.active?.reasoning ?? "default", retention: data.configuration.active?.retention ?? "standard", maxOutputTokens: data.configuration.active?.maxOutputTokens ?? 3200, endpointTag: data.configuration.active?.metadata.endpoint?.tag ?? "" });
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [endpoints, setEndpoints] = useState<{ tag: string; name: string }[]>([]);
  const [catalog, setCatalog] = useState<AiMetadata[]>([]);
  const [role, setRole] = useState<"primary" | "backup">("primary");
  const [previewOutcome, setPreviewOutcome] = useState<"success" | "timeout" | "invalid">("success");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  function change(value: Partial<SetupInput>) { setInput((old) => ({ ...old, ...value })); setInspection(null); setTest(null); setError(""); }
  async function inspect(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); setTest(null); setInspection(null); try { const result = await transport.command<Inspection>({ action: "inspect", input }); setInspection(result); setEndpoints(result.endpoints); } catch (e) { setError(e instanceof Error ? e.message : errors.ai_settings_unavailable); } finally { setBusy(false); } }
  async function testModel() { if (!inspection?.quote) return; setBusy(true); setError(""); setTest(null); try { const result = await transport.command<{ test: AiTestResult }>({ action: "test", id: crypto.randomUUID(), input, quote: inspection.quote, ...(preview ? { previewOutcome } : {}) }); setTest(result.test); await onDataChanged(); } catch (e) { setInspection(null); setError(e instanceof Error ? e.message : errors.ai_settings_unavailable); } finally { setBusy(false); } }
  const metadata = test?.profile.metadata ?? inspection?.metadata;
  return <section className="ai-setup" aria-labelledby="ai-setup-heading"><div className="ai-section-line"><div><h2 id="ai-setup-heading" tabIndex={-1} ref={headingRef}>Set up a model</h2><p className="ai-description">Inspect current information, review a small test, then choose its role.</p></div><button className="workspace-text-link" onClick={onCancel} disabled={busy}>Cancel setup</button></div><div className="ai-setup-layout"><div><form className="ai-setup-form" onSubmit={inspect}><div className="workspace-field"><label htmlFor="ai-live-model">OpenRouter model ID</label><input id="ai-live-model" list="ai-model-catalog" required maxLength={200} value={input.modelId} autoComplete="off" spellCheck={false} onChange={(e) => { change({ modelId: e.target.value, endpointTag: "" }); setEndpoints([]); }} disabled={busy}/><datalist id="ai-model-catalog">{catalog.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist><small>{preview ? "Use an exact ID from the sample catalogue." : "Paste an exact model ID, or refresh the catalogue to search."}</small></div><button type="button" className="workspace-text-link" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const result = await transport.command<{ models: AiMetadata[] }>({ action: "catalog" }); setCatalog(result.models); } catch (e) { setError(e instanceof Error ? e.message : errors.ai_settings_unavailable); } finally { setBusy(false); } }}>{catalog.length ? `${catalog.length} models loaded · Refresh` : preview ? "Show sample model catalogue" : "Refresh model catalogue"}</button><div className="workspace-field"><label htmlFor="ai-live-endpoint">Provider endpoint</label><select id="ai-live-endpoint" value={input.endpointTag ?? ""} onChange={(e) => change({ endpointTag: e.target.value })} disabled={busy}><option value="">Choose a provider after inspection</option>{input.endpointTag && !endpoints.some((endpoint) => endpoint.tag === input.endpointTag) && <option value={input.endpointTag}>{input.endpointTag} · selected endpoint</option>}{endpoints.map((endpoint) => <option key={endpoint.tag} value={endpoint.tag}>{endpoint.name} · {endpoint.tag}</option>)}</select><small>Inspect to list compatible endpoints. Select one, then inspect again to review its quote. An unavailable selection stays selected; another provider is never substituted.</small></div><div className="ai-form-grid"><div className="workspace-field"><label htmlFor="ai-live-reasoning">Reasoning</label><select id="ai-live-reasoning" value={input.reasoning} onChange={(e) => change({ reasoning: e.target.value as SetupInput["reasoning"] })} disabled={busy}>{["default", "none", "low", "medium", "high"].map((value) => <option key={value} value={value}>{value === "default" ? "Provider default" : value}</option>)}</select></div><div className="workspace-field"><label htmlFor="ai-live-output">Maximum output tokens</label><input id="ai-live-output" type="number" min="256" max="8192" step="1" required value={input.maxOutputTokens} onChange={(e) => change({ maxOutputTokens: Number(e.target.value) })} disabled={busy}/><small>Includes hidden reasoning. Scanner tasks also have smaller task limits.</small></div></div><div className="workspace-field"><label htmlFor="ai-live-retention">Data retention</label><select id="ai-live-retention" value={input.retention} onChange={(e) => change({ retention: e.target.value as SetupInput["retention"] })} disabled={busy}><option value="standard">Allow standard retention for public sources</option><option value="zdr">Require zero data retention</option></select><small>OpenRouter must find an endpoint that satisfies this policy and the price limits.</small></div>{preview && <div className="workspace-field"><label htmlFor="ai-preview-outcome">Sample test scenario</label><select id="ai-preview-outcome" value={previewOutcome} onChange={(event) => { setPreviewOutcome(event.target.value as "success" | "timeout" | "invalid"); setTest(null); }} disabled={busy}><option value="success">Successful sample</option><option value="timeout">Provider timeout with unknown charge</option><option value="invalid">Invalid sample response</option></select><small>Runs locally against sample data. No provider request.</small></div>}<button className={button} disabled={busy}>{busy ? "Working…" : preview ? "Inspect sample model" : "Inspect model"}</button></form>{error && <p className="workspace-error" role="alert">{error}</p>}
      {metadata && <div className="ai-inspected"><div className="ai-section-line"><h3>{metadata.name}</h3><span className="ai-status ai-status--quiet">{preview ? "Sample metadata" : "Provider-reported"}</span></div><dl className="ai-capabilities"><div><dt>Selected provider</dt><dd>{metadata.endpoint ? `${metadata.endpoint.name} · ${metadata.endpoint.tag}` : "No compatible provider"}</dd></div><div><dt>Inputs</dt><dd>{metadata.inputModalities.join(", ") || "Not reported"}</dd></div><div><dt>Context window</dt><dd>{metadata.contextWindow?.toLocaleString() ?? "Not reported"}</dd></div><div><dt>Structured output</dt><dd>{metadata.structuredOutput === null ? "Not reported" : metadata.structuredOutput ? preview ? "Sample supported" : "Reported supported" : "Not supported"}</dd></div><div><dt>Provider price / 1M tokens</dt><dd>{!metadata.endpoint || metadata.inputUsdPerMillion === null || metadata.outputUsdPerMillion === null ? "Not available" : `${rate(metadata.inputUsdPerMillion)} input · ${rate(metadata.outputUsdPerMillion)} output`}</dd></div></dl><p className="ai-description">{preview ? "Illustrative catalogue data, not a current price quote or verified capability test." : !metadata.endpoint ? "Catalog information only. Choose a compatible provider, then inspect again to review its quote." : `Retrieved ${quoteDate(metadata.fetchedAt)}. This quote is for your selected endpoint. Capabilities are reported, not measured quality. Testing refreshes this quote; a change requires another review. Activation keeps this provider. Scans accept up to ${AI_PRICE_HEADROOM}× this quote.`}</p><div className="ai-test-action"><div><strong>{preview ? "Sample scanner check" : "Quick scanner check"}</strong><span>6 short examples · $0.01 total maximum</span><small>{preview ? "Sample cost: $0.00. No provider request." : inspection?.testCeilingUsd == null ? "A safe request ceiling is not available." : `Reserved ceiling: ${testCost(inspection?.testCeilingUsd ?? 0)}. Six concurrent requests; no automatic retries.`}</small></div><button className={primaryButton} disabled={busy || !inspection?.quote || !inspection.compatible || inspection.testCeilingUsd === null || inspection.testCeilingUsd > Math.min(0.01, data.configuration.policy.requestUsd)} onClick={testModel}>{busy ? "Testing…" : preview ? "Run sample test" : "Run quick test"}</button></div>{inspection && !inspection.compatible && <p className="workspace-error">{!input.endpointTag && endpoints.length ? "Select a provider endpoint, then inspect again before testing." : incompatibilityMessage(metadata)}</p>}</div>}
      {test && <><TestEvidence test={test} preview={preview}/>{test.passed && test.costState === "verified" && <div className="ai-activation"><div className="workspace-field"><label htmlFor="ai-live-role">Use this model as</label><select id="ai-live-role" value={role} onChange={(e) => setRole(e.target.value as "primary" | "backup")} disabled={busy}><option value="primary">Primary scanner model</option><option value="backup">Approved backup model</option></select></div><button className={primaryButton} disabled={busy} onClick={async () => { setBusy(true); try { await onActivate(test, role); } finally { setBusy(false); } }}>{preview ? "Activate model in preview" : "Activate model"}</button><p>{preview ? "Changes this sample preview only. No production configuration is changed." : "Applies to subsequent scans. The previous primary configuration remains available to restore."}</p></div>}</>}
    </div><aside className="ai-setup-guide"><h3>What a useful test tells you</h3><ol><li><strong>Can it connect?</strong><p>Your connection, model and settings produce a response.</p></li><li><strong>Can the scanner read it?</strong><p>Responses satisfy the scanner&apos;s existing schemas and validators.</p></li><li><strong>Does it make the right calls?</strong><p>Six fixed examples check issue matching, uncertainty, and instructions embedded in sources.</p></li></ol><div className="ai-guide-note"><h3>Evidence has limits</h3><p>This is a small, bundled setup check. It does not prove performance on every source or test vision. Review scanner health after activation.</p></div></aside></div></section>;
}
