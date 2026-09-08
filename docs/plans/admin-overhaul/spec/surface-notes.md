# Desktop surface notes

The redesign is a single desktop operator product, not a collection of public-style pages. The shared shell exposes internal Overview, Reports, Claim review, Scanner, Videos, Dossiers, and Settings & tools destinations while preserving route compatibility.

## Acceptance frame

- First actionable content is visible at 1366px and 1440px+ without article-hero spacing.
- Browser zoom, keyboard-only use, visible focus, Escape/focus return, light and dark themes, empty, unavailable, stale, and failed-save states are required.
- There is no mobile acceptance gate in this redesign.
- Light is the first-visit/default edition. Both palettes must keep labels, status, and errors readable without color alone.

## Shared shell

Use a stable workspace rail/navigation and a coherent content frame. Utilities retain Export CSV confirmation, sign out, session/visibility information, and preview warning. Export confirmation closes with Escape and returns focus. The signed-in sidebar stays private; login retains public chrome.

## Overview

Quick check only. Place named owner decisions and operational incidents before background inventory. Each item opens the appropriate internal workspace. Keep compact run history and distinguish run outcome from AI health. Preserve `safeRunSummary`; do not render raw errors or #95 diagnostic payloads.

## Reports + Claims

Keep report review and claim pairing as separate focused destinations in the same workspace. Claim cards show exact official wording, patch/source context, issue context, distinct scanner/operator sightings, and explicit save/stale errors. Confirm, Not the same issue, and Later are the routine controls. Put global lifecycle Lock, visibility override, and current-patch override in a separate break-glass area. Do not default to private-cluster expansion.

## Scanner

Keep Scan controls, status, collection health, Teach, Records, Lessons, and history together. Explain Awaiting, candidates reviewed, and radar yield honestly. Show run state separately from AI health. Test scan clearly says without publishing; preview warning remains a separate environment signal. Keep private diagnostics bounded and undisclosed outside the operator area.

## Videos and Dossiers

Videos is a full private inbox, not a Reports count or placeholder. Retain manual add, draft-only approval, stale save, Archive/Restore, and unavailable states. Dossiers is an on-demand workspace; preserve deterministic fallback and the opt-in AI warning.

## Public boundary

Anonymous `/scanner` remains the Observatory. Do not bring operator queues, teach controls, claims, videos, exports, private diagnostics, or raw private data into public surfaces.
