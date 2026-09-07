/* Slice A operator concept. Invented sample data. Decisions stay in this tab. No network. */
(function () {
  "use strict";

  var SCENARIOS = ["normal", "empty", "ai-blocked", "unavailable", "failed-save"];
  var THEMES = ["light", "dark"];
  var VIEWS = ["overview", "review"];

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var SAMPLE_REPORTS = [
    {
      id: "rpt-skill",
      kind: "report",
      title: "Skill input drops after dismount",
      platform: "PC (Steam)",
      category: "Controls and gameplay",
      severity: "high",
      frequency: "often",
      patch: "1.14.00",
      age: "4h",
      created: "7 Sep 2026, 13:18 UTC (sample)",
      description:
        "After dismounting, the next skill press is ignored for about a second. Invented sample text — not a production report.",
      repro: "1. Mount. 2. Gallop 10s. 3. Dismount. 4. Press a skill. Sample only.",
      hardware: "Invented: RTX 4070 / 32 GB / 1440p",
      evidence: "",
    },
    {
      id: "rpt-foam",
      kind: "report",
      title: "River foam holds a swimming-stroke pattern",
      platform: "Xbox Series X",
      category: "Graphics and visual",
      severity: "medium",
      frequency: "always",
      patch: "1.14.00",
      age: "1d",
      created: "6 Sep 2026, 09:04 UTC (sample)",
      description:
        "Foam on the east-bank river keeps a repeating stroke shape while standing still. Invented sample text — not a production report.",
      repro: "Stand on the east bank at noon. Sample only.",
      hardware: "Invented: Xbox Series X",
      evidence: "",
    },
  ];

  var SAMPLE_CLAIM = {
    id: "claim-horse",
    kind: "claim",
    title: "Horse stride snaps at canter-to-gallop",
    clusterTitle: "Horse stride snaps at canter-to-gallop",
    officialFixText:
      "Fixed an issue where a horse's legs could snap to an incorrect pose during the canter-to-gallop transition.",
    sourceLabel: "Pearl Abyss · Crimson Desert Patch Notes (sample citation, not fetched)",
    patch: "1.14.00",
    section: "Combat",
    issueReports: "12 approved reports (sample inventory)",
    issueStatus: "Open",
    platforms: "PC (Steam), Xbox Series X",
    whyUnsure:
      "Keyword overlap on horse and animation. Mapping is unsure — this is not a recorded sure match.",
    whyKeyword:
      "Keyword proposal only. AI mapping did not run. Read the exact notes text before treating this as a match.",
  };

  var state = {
    theme: "light",
    view: "overview",
    scenario: "normal",
    selectedId: "claim-horse",
    pane: "queue",
    decisions: {},
    drafts: {},
    saveError: false,
    retryArmed: false,
    toast: "",
    exportOpen: false,
    locked: false,
    lockOpen: false,
    lockStatus: "reported",
    live: "",
  };

  function queueItems() {
    if (state.scenario === "empty" || state.scenario === "unavailable") return [];
    return [SAMPLE_CLAIM].concat(SAMPLE_REPORTS);
  }

  function selectedItem() {
    var items = queueItems();
    return items.find(function (item) { return item.id === state.selectedId; }) || items[0] || null;
  }

  function pendingCount() {
    return queueItems().filter(function (item) { return !state.decisions[item.id]; }).length;
  }

  function reviewChoreCount() {
    if (state.scenario === "unavailable") return null;
    if (state.scenario === "empty") return 0;
    var reports = SAMPLE_REPORTS.filter(function (item) { return !state.decisions[item.id]; }).length;
    var claims = state.decisions[SAMPLE_CLAIM.id] ? 0 : 1;
    return reports + claims;
  }

  function applyScenario(scenario) {
    state.scenario = scenario;
    state.decisions = {};
    state.drafts = {};
    state.saveError = false;
    state.retryArmed = false;
    state.locked = false;
    state.lockOpen = false;
    state.lockStatus = "reported";
    state.exportOpen = false;
    state.toast = "";
    if (scenario === "empty") {
      state.selectedId = null;
      state.pane = "queue";
    } else if (scenario === "failed-save") {
      state.view = "review";
      state.selectedId = "rpt-skill";
      state.pane = "detail";
      state.drafts["rpt-skill"] = {
        excerpt: "Camera hitch after sliding on ice. Sample excerpt — invented.",
        cluster: "skill-dismount",
      };
      state.saveError = true;
      state.retryArmed = true;
    } else if (scenario === "unavailable") {
      state.selectedId = null;
      state.pane = "queue";
    } else {
      state.selectedId = "claim-horse";
      if (state.view === "review") state.pane = "detail";
    }
  }

  function writeHash() {
    var parts = [
      "view=" + state.view,
      "scenario=" + state.scenario,
      "theme=" + state.theme,
    ];
    if (state.selectedId) parts.push("item=" + state.selectedId);
    if (state.pane) parts.push("pane=" + state.pane);
    var next = "#" + parts.join("&");
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.replace(/^#/, ""));
    var theme = params.get("theme");
    var view = params.get("view");
    var scenario = params.get("scenario");
    var item = params.get("item");
    var pane = params.get("pane");
    if (THEMES.indexOf(theme) >= 0) state.theme = theme;
    if (VIEWS.indexOf(view) >= 0) state.view = view;
    if (SCENARIOS.indexOf(scenario) >= 0) {
      applyScenario(scenario);
      if (VIEWS.indexOf(view) >= 0) state.view = view;
    }
    if (item) state.selectedId = item;
    if (pane === "queue" || pane === "detail") state.pane = pane;
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector("meta[name='theme-color']");
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", theme === "dark" ? "#000000" : "#f6f4ee");
  }

  function announce(message) {
    state.live = message;
    state.toast = message;
  }

  function nextPending(fromId) {
    var items = queueItems();
    var start = items.findIndex(function (item) { return item.id === fromId; });
    var i;
    for (i = start + 1; i < items.length; i += 1) {
      if (!state.decisions[items[i].id]) return items[i].id;
    }
    for (i = 0; i <= start; i += 1) {
      if (!state.decisions[items[i].id]) return items[i].id;
    }
    return fromId;
  }

  function svgTheme(theme) {
    if (theme === "dark") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 13a6 6 0 0 1-7-8 7 7 0 1 0 8 8z"/></svg>';
  }

  function renderHeader() {
    var nav = [
      { id: "overview", label: "Overview", live: true },
      { id: "review", label: "Review", live: true },
      { id: "videos", label: "Videos", live: false },
      { id: "scanner", label: "Scanner", live: false },
      { id: "dossiers", label: "Dossiers", live: false },
    ];
    return (
      '<div class="topline" aria-hidden="true"></div>' +
      '<header class="header">' +
        '<a class="brand" href="#view=overview&scenario=' + esc(state.scenario) + "&theme=" + esc(state.theme) + '">' +
          "<strong>Crimson Desert <em>Report Hub</em></strong>" +
          "<span>Operator · signed in (demo)</span>" +
        "</a>" +
        '<nav class="nav" aria-label="Operator">' +
          nav.map(function (item) {
            var current = item.live && state.view === item.id ? ' aria-current="page"' : "";
            var inert = item.live ? "" : " is-inert";
            return '<button type="button" class="nav-btn' + inert + '" data-nav="' + item.id + '"' + current + ">" + item.label + "</button>";
          }).join("") +
        "</nav>" +
        '<div class="header-tools">' +
          '<button type="button" class="theme-toggle" data-action="theme" aria-label="' +
            (state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode") +
          '">' + svgTheme(state.theme) + "</button>" +
          '<button type="button" class="util" data-action="export" aria-expanded="' + String(state.exportOpen) + '" aria-controls="export-strip">Export CSV…</button>' +
          '<button type="button" class="util util-signout" data-action="signout">Sign out</button>' +
        "</div>" +
      "</header>" +
      (state.exportOpen
        ? '<div class="export-strip" id="export-strip" role="group" aria-labelledby="export-title">' +
            '<p><b id="export-title">Export all report-review rows?</b> Sample copy only. A real export would include private descriptions. This concept never downloads a file.</p>' +
            '<button type="button" class="btn btn-quiet" data-action="export-cancel">Cancel</button>' +
          "</div>"
        : "")
    );
  }

  function chipGroup(legend, name, options, current) {
    return (
      "<fieldset>" +
        "<legend>" + esc(legend) + "</legend>" +
        options.map(function (opt) {
          return (
            '<button type="button" class="chip" data-' + name + '="' + opt.id + '" aria-pressed="' +
            String(current === opt.id) + '">' + esc(opt.label) + "</button>"
          );
        }).join("") +
      "</fieldset>"
    );
  }

  function renderRail() {
    return (
      '<div class="rail" role="region" aria-label="Concept controls, not part of the product">' +
        '<p class="rail-mark">Concept demo <span>· invented sample · in-memory only · no network</span></p>' +
        chipGroup("Theme", "theme", [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
        ], state.theme) +
        chipGroup("Surface", "view", [
          { id: "overview", label: "Overview" },
          { id: "review", label: "Review" },
        ], state.view) +
        chipGroup("Situation", "scenario", [
          { id: "normal", label: "Normal" },
          { id: "empty", label: "Empty" },
          { id: "ai-blocked", label: "AI-blocked" },
          { id: "unavailable", label: "Unavailable" },
          { id: "failed-save", label: "Failed-save" },
        ], state.scenario) +
      "</div>"
    );
  }

  function overviewModel() {
    var chores = reviewChoreCount();
    var unknown = state.scenario === "unavailable";
    var attention = [];
    var status = [];
    var videos = state.scenario === "empty" || unknown ? 0 : 1;

    if (unknown) {
      attention.push({
        tone: "bad",
        title: "Operator reads did not complete",
        why: "Run history and the scanner aggregate could not be read. A missing read is not an empty queue and is not a green zero.",
        meta: "Restore access before treating this overview as quiet.",
        action: "review",
        actionLabel: "Open Review anyway →",
      });
    } else if (chores === 0) {
      attention = [];
    } else {
      attention.push({
        tone: "bad",
        title: "Review queue",
        why: chores === 1
          ? "One item still needs a person: an official-fix proposal that is not a sure match, or a flagged report."
          : (SAMPLE_REPORTS.filter(function (item) { return !state.decisions[item.id]; }).length + " flagged reports and " +
            (state.decisions[SAMPLE_CLAIM.id] ? "no" : "1") + " unsure claim match. Reports and claim matches are the chores. Approved and spam totals are not."),
        meta: "Oldest flagged sample is 4 hours old. Each item has a reason on the Review desk.",
        action: "review",
        actionLabel: "Open Review →",
      });
      if (videos > 0) {
        attention.push({
          tone: "warn",
          title: "Video inbox",
          why: "One submitted YouTube link has no publication decision yet (invented sample).",
          meta: "Videos is a separate surface. It is not mixed into the Review count.",
          action: "videos",
          actionLabel: "Videos (not in this concept)",
        });
      }
    }

    if (state.scenario === "ai-blocked") {
      attention.push({
        tone: "warn",
        title: "AI mapping blocked",
        why: "The OpenRouter key limit could not be verified in this sample, so claim mapping did not run. Search and rule-based processing can continue.",
        meta: "Keyword proposals still need a person. This is not a report-queue count.",
        action: "review",
        actionLabel: "Read the exact notes text →",
      });
    }

    if (!unknown) {
      status.push({
        tone: state.scenario === "ai-blocked" ? "warn" : "ok",
        title: "AI processing",
        meta: state.scenario === "ai-blocked"
          ? "Blocked · mapping skipped · search can continue"
          : "Available · last validated sample 12:58 UTC",
        state: state.scenario === "ai-blocked" ? "Blocked" : "Available",
      });
      status.push({
        tone: "info",
        title: "Last scanner run",
        meta: "7 Sep 2026, 13:02 UTC · completed with limits (news index capped). Limits are not a failed run and are not a Do-now chore.",
        state: "Informational",
      });
      status.push({ tone: "ok", title: "Steam capture", meta: "Last successful sample 12:40 UTC", state: "Captured" });
      status.push({ tone: "ok", title: "Twitch capture", meta: "Last successful sample 12:40 UTC", state: "Captured" });
      status.push({ tone: "info", title: "IGDB", meta: "Idle in this sample. Idle is not a chore.", state: "Idle" });
      status.push({ tone: "ok", title: "Current patch", meta: "1.14.00 · Synced (sample provenance)", state: "Synced" });
      status.push({
        tone: "info",
        title: "Daily check",
        meta: "9:00am Eastern. This page does not query the ChatGPT task, so it does not claim a live task status.",
        state: "Scheduled",
      });
      status.push({
        tone: "info",
        title: "Background inventory",
        meta: "41 approved reports · 2 spam · not counted in Do now.",
        state: "Inventory",
      });
    } else {
      status.push({ tone: "bad", title: "Scanner", meta: "Aggregate read did not complete. Unknown is not zero.", state: "Unavailable" });
      status.push({ tone: "bad", title: "Run history", meta: "Authenticated run record could not be read.", state: "Unavailable" });
      status.push({ tone: "warn", title: "AI processing", meta: "Cannot verify from this page load.", state: "Unknown" });
    }

    return { chores: chores, unknown: unknown, attention: attention, status: status };
  }

  function renderOverview() {
    var model = overviewModel();
    var headClass = "overview-head" + (model.unknown ? " is-unknown" : model.chores > 0 ? " is-attention" : "");
    var countLabel = model.unknown ? "Needs attention" : "Do now";
    var countValue = model.unknown ? "—" : String(model.chores);
    var reportsWaiting = state.scenario === "empty" || model.unknown ? 0 : SAMPLE_REPORTS.filter(function (item) { return !state.decisions[item.id]; }).length;
    var claimsWaiting = state.scenario === "empty" || model.unknown || state.decisions[SAMPLE_CLAIM.id] ? 0 : 1;
    var countHint = model.unknown
      ? "Count unavailable"
      : model.chores === 0
        ? "No chores · inventory is separate"
        : reportsWaiting + " reports · " + claimsWaiting + " claim · not inventory";

    var work;
    if (model.unknown) {
      work = model.attention.map(rowHtml).join("");
    } else if (model.attention.length === 0) {
      work =
        '<div class="empty-note">' +
          "<h3>Nothing needs a decision.</h3>" +
          "<p class=\"why\">Service health and inventory are on the right. They stay visible so a quiet board is not mistaken for a missing read — and so approved/spam totals never look like chores.</p>" +
        "</div>";
    } else {
      work = model.attention.map(rowHtml).join("");
    }

    return (
      '<section aria-labelledby="ov-title" class="' + headClass + '">' +
        "<div>" +
          '<p class="kicker">' + (model.unknown ? "Health not verified" : model.chores ? "Operate · quick check" : "Operate · quiet") + "</p>" +
          '<h1 id="ov-title">' + (model.unknown ? "Status unavailable" : model.chores ? "A few decisions are waiting" : "No decisions waiting") + "</h1>" +
          '<p class="lede">Do now is only work that needs you. Last-run limits, healthy captures, approved counts, and spam totals stay informational.</p>' +
        "</div>" +
        '<div class="count-pill"><span>' + esc(countLabel) + "</span><strong>" + esc(countValue) + "</strong><span>" + esc(countHint) + "</span></div>" +
      "</section>" +
      '<div class="spread">' +
        "<section aria-labelledby=\"do-now-title\">" +
          '<div class="col-head"><h2 id="do-now-title">Do now</h2><p>Why it is here, and where to act</p></div>' +
          work +
        "</section>" +
        "<section aria-labelledby=\"info-title\">" +
          '<div class="col-head"><h2 id="info-title">Informational</h2><p>Not a chore list</p></div>' +
          model.status.map(function (row) {
            return (
              '<article class="status-row">' +
                '<span class="lamp lamp-' + row.tone + '" aria-hidden="true"></span>' +
                "<div><h3>" + esc(row.title) + "</h3><p class=\"meta\">" + esc(row.meta) + "</p></div>" +
                '<span class="state state-' + row.tone + '">' + esc(row.state) + "</span>" +
              "</article>"
            );
          }).join("") +
        "</section>" +
      "</div>"
    );
  }

  function rowHtml(row) {
    return (
      '<article class="work-row">' +
        '<span class="lamp lamp-' + row.tone + '" aria-hidden="true"></span>' +
        "<div>" +
          "<h3>" + esc(row.title) + "</h3>" +
          '<p class="why">' + esc(row.why) + "</p>" +
          '<p class="meta">' + esc(row.meta) + "</p>" +
        "</div>" +
        '<button type="button" class="jump" data-nav="' + esc(row.action) + '">' + esc(row.actionLabel) + "</button>" +
      "</article>"
    );
  }

  function renderQueue() {
    var items = queueItems();
    var total = items.length;
    var pending = pendingCount();
    var list;
    if (state.scenario === "unavailable") {
      list =
        '<div class="unavail-note" style="padding:12px">' +
          "<h3>Queue unavailable</h3>" +
          "<p class=\"why\">The review read did not complete. This concept will not draw an empty list or a green all-clear from a failed read.</p>" +
        "</div>";
    } else if (total === 0) {
      list =
        '<div class="empty-note" style="padding:12px">' +
          "<h3>No items in the queue</h3>" +
          "<p class=\"why\">Known empty: no flagged reports and no unsure claim matches in this sample. Inventory still exists on Overview.</p>" +
        "</div>";
    } else {
      list = items.map(function (item) {
        var current = state.selectedId === item.id;
        var done = state.decisions[item.id];
        var kind = item.kind === "claim" ? "Claim match" : "Flagged report";
        var line = item.kind === "claim"
          ? (state.scenario === "ai-blocked" ? "Keyword proposal · " + item.patch : "Unsure match · " + item.patch)
          : item.platform + " · " + item.age + " · " + item.severity;
        if (done) line = "Decided in this demo · " + done.label;
        return (
          '<button type="button" class="q-item' + (done ? " is-done" : "") + '" data-select="' + item.id + '" aria-current="' + String(current) + '">' +
            '<span class="lamp ' + (done ? "lamp-ok" : item.kind === "claim" ? "lamp-warn" : "lamp-bad") + '" aria-hidden="true"></span>' +
            "<div><p class=\"q-kind\">" + kind + (done ? '<span class="done-flag">Kept in queue</span>' : "") + "</p>" +
            "<h2>" + esc(item.title) + "</h2><p>" + esc(line) + "</p></div>" +
          "</button>"
        );
      }).join("");
    }
    return (
      '<aside class="queue" aria-label="Review queue">' +
        '<div class="queue-head"><h1>Queue</h1><p>' +
          (state.scenario === "unavailable" ? "Count unavailable" : pending + " waiting · " + total + " in this tab") +
        "</p></div>" +
        '<div role="listbox" aria-label="Items needing a look">' + list + "</div>" +
      "</aside>"
    );
  }

  function draftFor(id) {
    return state.drafts[id] || { excerpt: "", cluster: "" };
  }

  function renderClaim(item) {
    var why = state.scenario === "ai-blocked" ? item.whyKeyword : item.whyUnsure;
    var decision = state.decisions[item.id];
    return (
      '<div class="crumb">' +
        '<button type="button" class="back" data-action="back">← Queue</button>' +
        '<p class="kicker">Claim match · needs a person</p>' +
      "</div>" +
      "<h2 id=\"item-title\">" + esc(item.clusterTitle) + "</h2>" +
      (state.scenario === "ai-blocked"
        ? '<div class="banner warn"><b>AI mapping blocked.</b> Search can continue. This row is a keyword proposal. The patch-note sentence is the thing to judge — not a generic “needs review” reason.</div>'
        : "") +
      (decision ? '<div class="banner warn"><b>Demo decision:</b> ' + esc(decision.label) + ". The row stays in the queue so you keep context.</div>" : "") +
      '<figure class="quote">' +
        "<p>“" + esc(item.officialFixText) + "”</p>" +
        "<footer>Exact official fix text (invented sample). Source: " + esc(item.sourceLabel) + " · Patch " + esc(item.patch) + " · " + esc(item.section) + "</footer>" +
      "</figure>" +
      '<dl class="facts">' +
        "<div><dt>Issue on the board</dt><dd>" + esc(item.clusterTitle) + "</dd></div>" +
        "<div><dt>Issue context</dt><dd>" + esc(item.issueStatus) + " · " + esc(item.issueReports) + " · " + esc(item.platforms) + "</dd></div>" +
        "<div><dt>Why this is here</dt><dd>" + esc(why) + "</dd></div>" +
        "<div><dt>Patch</dt><dd>" + esc(item.patch) + " · sample, not live-synced</dd></div>" +
      "</dl>" +
      '<p class="scope">Confirm means this official sentence is about this issue. Not the same means the proposal is wrong; the issue stays Open. Decide later leaves it in the queue. None of these is a lifecycle lock.</p>' +
      '<div class="lock">' +
        "<details" + (state.lockOpen ? " open" : "") + ">" +
          "<summary>Lifecycle lock — not the match decision</summary>" +
          '<p class="lock-copy">Lock writes a maintainer override for the lifecycle engine. It is not how you reject a claim match. Use Not the same for that. Lock is break-glass and is visually separate on purpose.</p>' +
          '<div class="lock-row">' +
            '<label class="field-label" for="lock-status">Locked status</label>' +
            '<select id="lock-status" data-field="lock-status">' +
              '<option value="reported"' + (state.lockStatus === "reported" ? " selected" : "") + ">Open</option>" +
              '<option value="fix_claimed"' + (state.lockStatus === "fix_claimed" ? " selected" : "") + ">Fix claimed — unverified</option>" +
              '<option value="verified_fixed"' + (state.lockStatus === "verified_fixed" ? " selected" : "") + ">Marked fixed by maintainer</option>" +
              '<option value="persists"' + (state.lockStatus === "persists" ? " selected" : "") + ">Still happening</option>" +
            "</select>" +
            '<button type="button" class="btn btn-quiet" data-action="lock">' + (state.locked ? "Locked in this demo" : "Lock (demo)") + "</button>" +
            (state.locked ? '<button type="button" class="btn btn-ghost" data-action="unlock">Clear lock (demo)</button>' : "") +
          "</div>" +
        "</details>" +
      "</div>"
    );
  }

  function renderReport(item) {
    var draft = draftFor(item.id);
    var decision = state.decisions[item.id];
    return (
      '<div class="crumb">' +
        '<button type="button" class="back" data-action="back">← Queue</button>' +
        '<p class="kicker">Flagged report · private sample</p>' +
      "</div>" +
      "<h2 id=\"item-title\">" + esc(item.title) + "</h2>" +
      (state.saveError ? '<div class="banner" role="alert"><b>Save did not complete.</b> Recoverable failure (demo). The excerpt and cluster you entered are still here. Retry is safe in this tab.</div>' : "") +
      (decision ? '<div class="banner warn"><b>Demo decision:</b> ' + esc(decision.label) + ". Queue context is kept.</div>" : "") +
      '<div class="private">' +
        '<span class="sample-tag">Invented sample · not production text</span>' +
        "<h3>Private description</h3>" +
        "<p>" + esc(item.description) + "</p>" +
        "<h3>Repro</h3><p>" + esc(item.repro) + "</p>" +
        "<h3>Hardware</h3><p>" + esc(item.hardware) + "</p>" +
        "<h3>Evidence URL</h3><p>" + (item.evidence ? esc(item.evidence) : "None attached in this sample.") + "</p>" +
      "</div>" +
      '<dl class="facts">' +
        "<div><dt>Platform</dt><dd>" + esc(item.platform) + "</dd></div>" +
        "<div><dt>Category</dt><dd>" + esc(item.category) + "</dd></div>" +
        "<div><dt>Severity / frequency</dt><dd>" + esc(item.severity) + " · " + esc(item.frequency) + "</dd></div>" +
        "<div><dt>Patch / received</dt><dd>" + esc(item.patch) + " · " + esc(item.created) + "</dd></div>" +
      "</dl>" +
      '<div class="form-grid">' +
        '<label class="field-label" for="cluster">Cluster</label>' +
          '<select id="cluster" data-field="cluster">' +
            '<option value="">No cluster</option>' +
            '<option value="skill-dismount"' + (draft.cluster === "skill-dismount" ? " selected" : "") + ">Skill input drops after dismount</option>" +
            '<option value="horse-stride"' + (draft.cluster === "horse-stride" ? " selected" : "") + ">Horse stride snaps at canter-to-gallop</option>" +
            '<option value="river-foam"' + (draft.cluster === "river-foam" ? " selected" : "") + ">River foam holds a swimming-stroke pattern</option>" +
          "</select>" +
        '<label class="field-label" for="excerpt">Public excerpt (anonymized, max 500)</label>' +
          '<textarea id="excerpt" data-field="excerpt" maxlength="500" placeholder="Invented excerpt stays here if save fails">' + esc(draft.excerpt) + "</textarea>" +
      "</div>" +
      '<p class="scope" id="approve-scope"><b>Approve</b> marks the sample approved. A non-empty excerpt would be inserted separately in production. This demo never writes a database.</p>'
    );
  }

  function renderActions(item) {
    if (!item) return "";
    if (item.kind === "claim") {
      return (
        '<div class="actions">' +
          '<button type="button" class="btn" data-decide="confirm">Confirm this is the same</button>' +
          '<button type="button" class="btn btn-ghost" data-decide="not-same">Not the same</button>' +
          '<button type="button" class="btn btn-quiet" data-decide="later">Decide later</button>' +
        "</div>"
      );
    }
    return (
      '<div class="actions">' +
        '<button type="button" class="btn" data-decide="approved" aria-describedby="approve-scope">Approve</button>' +
        '<button type="button" class="btn btn-danger" data-decide="rejected">Reject</button>' +
        '<button type="button" class="btn btn-danger" data-decide="spam">Spam</button>' +
      "</div>"
    );
  }

  function renderDetail() {
    var item = selectedItem();
    if (state.scenario === "unavailable") {
      return (
        '<section class="detail" aria-labelledby="item-title">' +
          '<div class="detail-scroll"><div class="crumb"><button type="button" class="back" data-action="back">← Queue</button><p class="kicker">Unavailable</p></div>' +
          '<h2 id="item-title">The selected item cannot be proven</h2>' +
          '<div class="unavail-note"><p class="why">This concept refuses to show a fabricated form. Return when the read works, or use Overview to see the named missing records.</p></div></div></section>'
      );
    }
    if (!item) {
      return (
        '<section class="detail" aria-labelledby="item-title">' +
          '<div class="detail-scroll"><div class="crumb"><button type="button" class="back" data-action="back">← Queue</button><p class="kicker">Queue empty</p></div>' +
          '<h2 id="item-title">Nothing to review</h2>' +
          '<div class="empty-note"><p class="why">Known empty sample. Primary actions hide because there is no item.</p></div></div></section>'
      );
    }
    return (
      '<section class="detail" aria-labelledby="item-title">' +
        '<div class="detail-scroll">' + (item.kind === "claim" ? renderClaim(item) : renderReport(item)) + "</div>" +
        renderActions(item) +
      "</section>"
    );
  }

  function renderReview() {
    var pane = state.pane === "detail" ? "detail" : "queue";
    return (
      '<div class="desk" data-pane="' + pane + '">' +
        renderQueue() +
        renderDetail() +
      "</div>"
    );
  }

  function render() {
    setTheme(state.theme);
    document.documentElement.dataset.view = state.view;
    document.documentElement.dataset.scenario = state.scenario;
    document.title = (state.view === "review" ? "Review" : "Overview") + " — operator concept (sample)";
    var app = document.getElementById("app");
    var toast = state.toast ? '<p class="toast" role="status">' + esc(state.toast) + "</p>" : "";
    app.innerHTML =
      renderHeader() +
      renderRail() +
      '<main id="main" class="main">' +
        toast +
        (state.view === "review" ? renderReview() : renderOverview()) +
      "</main>" +
      '<div class="live" aria-live="polite">' + esc(state.live) + "</div>";
    writeHash();
  }

  function rememberDraft() {
    var item = selectedItem();
    if (!item || item.kind !== "report") return;
    var excerpt = document.getElementById("excerpt");
    var cluster = document.getElementById("cluster");
    state.drafts[item.id] = {
      excerpt: excerpt ? excerpt.value : "",
      cluster: cluster ? cluster.value : "",
    };
  }

  function decide(kind) {
    var item = selectedItem();
    if (!item) return;
    rememberDraft();
    if (item.kind === "report" && (kind === "approved" || kind === "rejected" || kind === "spam")) {
      if (state.saveError) {
        state.saveError = false;
        state.retryArmed = false;
        announce("Retry succeeded in this demo. The excerpt you typed was kept.");
      }
    }
    if (kind === "later") {
      announce("Still in the queue. Demo only — nothing was stored.");
      render();
      return;
    }
    var labels = {
      confirm: "Confirmed as the same (in memory)",
      "not-same": "Marked not the same (in memory)",
      approved: "Approved (in memory)",
      rejected: "Rejected (in memory)",
      spam: "Marked spam (in memory)",
    };
    state.decisions[item.id] = { kind: kind, label: labels[kind] || kind };
    var next = nextPending(item.id);
    state.selectedId = next;
    state.pane = "detail";
    announce(labels[kind] + ". Queue kept. Next item is selected when one remains.");
    render();
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("button, a.brand");
    if (!target) return;
    if (target.matches("a.brand")) {
      event.preventDefault();
      state.view = "overview";
      state.pane = "queue";
      render();
      return;
    }
    var theme = target.getAttribute("data-theme");
    var view = target.getAttribute("data-view");
    var scenario = target.getAttribute("data-scenario");
    var nav = target.getAttribute("data-nav");
    var select = target.getAttribute("data-select");
    var action = target.getAttribute("data-action");
    var kind = target.getAttribute("data-decide");
    if (theme) setTheme(theme);
    if (view) {
      state.view = view;
      if (view === "review") {
        state.pane = window.matchMedia("(max-width: 880px)").matches ? "queue" : "detail";
      }
    }
    if (scenario) applyScenario(scenario);
    if (nav === "overview" || nav === "review") {
      state.view = nav;
      if (nav === "review") {
        if (!state.selectedId && queueItems()[0]) state.selectedId = queueItems()[0].id;
        var fromJump = target.classList.contains("jump");
        var mobile = window.matchMedia("(max-width: 880px)").matches;
        state.pane = (!mobile || fromJump) ? "detail" : "queue";
      }
    } else if (nav) {
      announce(nav.charAt(0).toUpperCase() + nav.slice(1) + " is not part of this Slice A concept.");
    }
    if (select) {
      rememberDraft();
      state.selectedId = select;
      state.pane = "detail";
    }
    if (action === "theme") setTheme(state.theme === "dark" ? "light" : "dark");
    if (action === "export") state.exportOpen = !state.exportOpen;
    if (action === "export-cancel") state.exportOpen = false;
    if (action === "signout") announce("Demo only — there is no session to sign out.");
    if (action === "back") state.pane = "queue";
    if (action === "lock") {
      var selectEl = document.getElementById("lock-status");
      if (selectEl) state.lockStatus = selectEl.value;
      state.locked = true;
      state.lockOpen = true;
      announce("Locked in this demo. Lock is not Not the same.");
    }
    if (action === "unlock") {
      state.locked = false;
      announce("Lock cleared in this demo.");
    }
    if (kind) decide(kind);
    render();
  });

  document.addEventListener("toggle", function (event) {
    if (event.target && event.target.closest && event.target.closest(".lock details")) {
      state.lockOpen = event.target.open;
    }
  }, true);

  document.addEventListener("input", function (event) {
    var field = event.target.getAttribute("data-field");
    if (!field) return;
    if (field === "lock-status") {
      state.lockStatus = event.target.value;
      return;
    }
    rememberDraft();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.exportOpen) {
      state.exportOpen = false;
      render();
    }
    if (event.key === "Escape" && state.view === "review" && state.pane === "detail") {
      var mq = window.matchMedia("(max-width: 880px)");
      if (mq.matches) {
        state.pane = "queue";
        render();
      }
    }
  });

  window.addEventListener("hashchange", function () {
    readHash();
    render();
  });

  readHash();
  setTheme(state.theme);
  render();
})();
