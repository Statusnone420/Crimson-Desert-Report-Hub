# Crimson Report Hub house style

For every public word on the site: articles, patch rundowns, page text, chart labels, buttons, error messages, page titles, feeds, and anything a model writes for us.

Sources:

- Wikipedia, "Signs of AI writing" (WikiProject AI Cleanup), read in full on 18 Oct 2026.
- Don Norman, *The Design of Everyday Things*, revised edition (2013).
- Jakob Nielsen, "10 Usability Heuristics for User Interface Design" (NN/g, last reviewed Jan 2024).
- Ben Shneiderman, "The Eight Golden Rules of Interface Design", from the 6th edition of *Designing the User Interface* (2016).
- W3C, Web Content Accessibility Guidelines (WCAG) 2.2 (Recommendation, Oct 2023).

Examples come from the live site on 18 Oct. Written for the maintainer, Statusnone, so "you" means the maintainer.

## The short version

Write like someone who plays Crimson Desert, checked the facts, and is telling another player. If a sentence could sit on any site about any game, make it specific or delete it.

"Made with AI help" stays on the site. That's honest. What has to go is text that *sounds* generated, and pages that explain the machine instead of answering the player.

## What makes our pages read as AI today

I read the home page, the Observatory, the Method page and the delay article. Four habits do most of the damage:

1. Disclaimers on every card. "These are leads, not confirmed reports." "It describes the game's activity, not whether a problem is fixed." "Reviews are context, not issue evidence." "Zero means no recorded outcome; it does not prove a scan ran." Each one is true. Stacked together they sound like a machine defending itself. Wikipedia lists this kind of hedging among the most common signs of AI text this month.
2. "X, not Y" one-liners. "Publication is visibility, not an evidence verdict." "That starts a question, not an answer." "Silence never counts as a fix." Wikipedia calls this contrast shape a stereotypical AI sign.
3. Pipeline words in public. Leads, candidates, kept / seen again / not retained, publication bar, mapped issue areas, the radar, the wire, plus a news desk, a data desk and a patch desk. A player meets about nine names for "a problem we know about".
4. Numbers without a point. "126 mapped issue areas." "1,674 candidates recorded." "113 of 223 tracked leads seen again." A reader can't do anything with these.

The good news: the facts are solid, the sourcing is careful, and some lines already sound human. "18,166 playing, 26% below the usual for a Sunday at this time" is a good line. So is "The delay stinks."

## Part 1: Writing

### Be specific

AI writing slides toward the average: generic, positive, important-sounding. The specific detail gets lost and the praise gets louder. Push the other way.

- Name the quest, the item, the platform, the patch, the date, the number.
- Cut lines about importance: "marks a turning point", "a testament to", "plays a pivotal role", "in an evolving landscape".
- Cut sentences that only describe what a source didn't say.
  - Before: "The statement does not identify a particular feature or bug behind the decision. It gives a reason for the delay and a new date, without a detailed breakdown of the remaining work."
  - After: "Pearl Abyss didn't say what still needs work."

### Explain the method once

The Method page holds the caveats, written once and plainly. A card gets a short label (for example "One report") and a link to the method. Keep a caveat on the card only when a reader would draw the wrong conclusion right there without it.

Before writing a caveat about missing data, check the data. The gap may be a bug (see the Twitch card under "Found while checking").

### Skip the stock words and shapes

Words to avoid unless they're the only right word: delve, crucial, pivotal, vibrant, robust, seamless, showcase, testament, tapestry, landscape (as an idea), underscore, highlight (as a verb), foster, leverage, enhance, multifaceted, boasts, nestled, game-changer. The newest models also lean on "matters", "quietly", "steady", "dependable" and "practical".

Shapes to avoid:

- "Not X, but Y", "It's not X, it's Y" and "Y rather than X", unless X is something people really believe. Say what the thing is.
- A tacked-on "-ing" comment at the end of a sentence: "..., highlighting the team's commitment to quality."
- "Serves as", "stands as", "features" or "offers" where "is" or "has" works.
- Lists of three by reflex: "Recorded reviews, audience activity, and the signals coming in from across the web." Use the real number of items.
- Vague crowds: "players say", "many fans feel", with no count or source.
- Stock endings: "Despite these challenges...", "Only time will tell", "In summary".
- Chatbot leftovers: "Here's what you need to know", "Let's dive in", "It's worth noting".
- Question headings used as hooks: "What keeps showing up?"
- Hedges about sources: "based on available information", "details are limited", "should be treated as X rather than Y".

This list is a warning light. Removing the words doesn't fix a page if it still says nothing specific.

### Sound like a person

- Mix sentence lengths. A short one lands. A longer one can carry a full thought, with a clause or two, when the idea needs it. Lines that are all the same length are now a tell too.
- Use plain verbs: is, has, used, tried, wrote, fixed.
- Contractions are fine. "I" is fine in a signed opinion piece.
- Keep em dashes rare. Commas, periods and parentheses do most of the work.
- Use sentence case for headings: "Why the date moved" instead of "Why The Date Moved".
- Bold one thing per section at most. No emoji in copy. Use lists for real lists, never as a "Label: explanation" substitute for a paragraph.

### Sourced facts, signed opinions

- Every number, date and quote traces to Hub data or a linked official or primary source. Never invent a quote, a number or a patch line.
- Say how strong the evidence is, with the labels in the table below: Confirmed, Reported or One report.
- Opinion is labeled and signed by Statusnone, in your own words. A model can fix typos, but it doesn't write your opinions.
- Pseudonym only. No legal name and no personal details anywhere on the site.

### Use player words

Public pages use a small, fixed set of terms, the same ones everywhere.

Two nouns:

| Public word | Means | Replaces |
|---|---|---|
| Known issue | Any problem the site lists for a patch | issue card, topic, tracked lead |
| Check-in | A player saying "this happened to me" | check-in (keep) |

Labels come on two separate axes, so they never collide on one card. Every known issue carries one evidence label, and a status label once Pearl Abyss lists a fix.

Evidence:

| Label | Means | Replaces |
|---|---|---|
| Confirmed | Pearl Abyss acknowledges it or lists a fix for it | (new label) |
| Reported | Two or more independent player sources describe it | lead, watched, watchlist |
| One report | A single player describes it. Shown only with this label | single-source lead |

Status:

| Label | Means | Replaces |
|---|---|---|
| Fixed (per patch notes) | Pearl Abyss lists a fix in a patch | claimed fix |
| Still happening | Players hit it after the fix date | (new) |

Scanner internals (candidates, kept, not retained, radar, processing) move to the admin pages.

### Times

Every public timestamp is in UTC, in one format everywhere: "Oct 18, 16:00 UTC". Convert Pearl Abyss's event times to UTC.

## Part 2: Interface

Who and what: a Crimson Desert player, often on a phone, often just after a crash or a patch. They come with one of five questions: Is my problem known? What changed in this patch? Should I play tonight? When is the expansion? How do I report this?

### Our page rules

1. Answer first. Every page opens with one sentence that answers its main question. Data and method come after.
   - Before: "No issue has reached the publication bar on this patch yet. The scanner keeps forum threads as leads until another source backs them."
   - After: "Nothing confirmed on 2.03.02 yet. 58 forum threads mention problems; 26 of them are crashes or startup trouble."
2. Fewer numbers, each with a point. The front page shows three numbers at most. Each one gets a comparison in words ("a quarter below a normal Sunday").
3. Phone first. Design for small screens, slow networks and dark rooms.
4. Say what happens. Buttons name their action: "Report a problem" instead of "Submit". Empty states say what to do next.

### Shneiderman's eight golden rules, applied here

1. Strive for consistency. The same word, color and layout mean the same thing on every page.
2. Seek universal usability. Serve first-time visitors and regulars alike. Regulars get shortcuts, such as a stable "current patch" link and a "since your last visit" view. People who use assistive technology get everything in the Accessibility section.
3. Offer informative feedback. Every action gets a visible response.
4. Design dialogs to yield closure. A form ends with a clear confirmation: "Thanks. Your check-in counts for 2.03.02."
5. Prevent errors. Stop mistakes before they happen. When one happens, say in plain words what to fix, and keep what the reader already typed.
6. Permit easy reversal of actions. Let people change or remove a check-in.
7. Keep users in control. No surprise motion or layout jumps. Filters remember their settings.
8. Reduce short-term memory load. Label charts in words on the chart itself. "Click, tap, or focus a day to read its change" means the chart can't show its point by itself yet.

### Nielsen's 10 heuristics (the audit scores every page against these)

1. Visibility of system status. Show when each number was last updated.
2. Match between the system and the real world. Player words from the table above, in the order a player thinks.
3. User control and freedom. A clear way back from every view, and undo for check-ins.
4. Consistency and standards. Links look like links, and charts behave like charts on other sites.
5. Error prevention. Forms check input before sending it.
6. Recognition rather than recall. Labels stay visible. No meaning hides behind hover.
7. Flexibility and efficiency of use. Shortcuts for regulars that stay out of a newcomer's way.
8. Aesthetic and minimalist design. Every number and caveat competes for attention. Cut what doesn't help the reader decide.
9. Help users recognize, diagnose, and recover from errors. Plain-language errors with a next step.
10. Help and documentation. The Method page: short, searchable, and linked where a term first appears.

### Norman's principles

- Signifiers. What can be clicked looks clickable, and what can't, doesn't.
- Mapping. A control sits next to what it changes, so chart toggles go on the chart.
- Constraints. Offer only the choices that make sense right now (for example, only patches that exist).
- Conceptual model. The site follows how a player already thinks: a patch comes out, problems show up, some get fixed, some keep happening.
- Feedback. Covered by Shneiderman's third rule above.

## Accessibility

WCAG 2.2 level AA is the floor. Success criteria are in brackets.

- Text contrast is at least 4.5:1 against its background (3:1 for large text). [1.4.3]
- Chart lines, bars, icons and control edges are at least 3:1 against their background. [1.4.11]
- Touch and click targets are at least 24×24 CSS px, or spaced so a 24 px circle around each one touches no other target. [2.5.8]
- Keyboard focus is always visible, and a sticky bar never covers it. [2.4.7, 2.4.11]
- Everything works with a keyboard alone, chart toggles and readouts included. [2.1.1]
- Color is never the only signal. Charts add labels, symbols (▲ ▼) or patterns, and status uses words. [1.4.1]
- Reduced motion is honored. When the device asks for less motion, charts and page transitions don't animate. [`prefers-reduced-motion`; 2.3.3 is level AAA, adopted here]
- Every meaningful image has alt text. Decorative images get empty alt text. [1.1.1]
- Every chart has a one-sentence text summary of its point, plus a table of its values. [1.1.1]

## Part 3: How we keep it

- The final version lives in the public repo as `docs/STYLE.md`. `AGENTS.md` tells every agent to follow it for public text.
- Every model that writes for the site gets this standard and the checklist below in its prompt: patch rundowns now, and the column when we build it.
- A style test checks public text in CI. It fails on our own words. When the flagged text is quoted from official notes, it only warns, because we quote Pearl Abyss as written.
- Your ear wins. If it doesn't sound like something you'd say, it goes.

### Pre-publish checklist

1. Every factual claim traces to Hub data or a linked official or primary source. No invented quotes or numbers.
2. Attribution names the source and the count ("3 Steam threads"), never "many players."
3. No inflated significance (testament, pivotal, landscape, marks a shift).
4. No promo adjectives (vibrant, groundbreaking, boasts, renowned).
5. If three or more AI-vocabulary words appear, rewrite.
6. "Is" and "has" over "serves as" and "stands as."
7. No "not X but Y" unless X is a real belief. No reflexive lists of three.
8. No "-ing" tail clauses that add meaning nobody sourced.
9. No hedging boilerplate. Say what we checked.
10. No chatbot chatter, placeholders, XX dates or tool artifacts.
11. Sentence-case headings, minimal bold, no emoji bullets, no stray Markdown in X posts.
12. Em dashes rare.
13. No formula endings. Stop when the content stops.
14. Every link clicked and working.
15. Read it aloud, and rewrite anything that sounds like a press release.

## Before and after, more examples

| Where | Today | Suggested |
|---|---|---|
| Home, readings | "Recorded data from Steam and the official notes, updated after each scan. It describes the game's activity, not whether a problem is fixed." | "From Steam, last checked Oct 18, 16:00 UTC." |
| Observatory intro | "The game, in context. Recorded reviews, audience activity, and the signals coming in from across the web." | "How the game is doing, patch by patch: reviews, players and stream viewers." |
| Method | "Official notes are context. Pearl Abyss said it. That starts a question, not an answer." | "Patch notes say what Pearl Abyss fixed. We check whether players still hit the problem afterward." |
| Observatory, weekly scan | "Kept 71 4.2% ... Not retained 1,515 90.5% ... including incomplete processing." | Move to the admin. Players don't need it. |

## Found while checking

**The Twitch card on the Observatory is a data bug first and a copy problem second.** Its default 24-hour view shows 12 captures, and its 7-day view shows 81 (Oct 11–18). The site already has Twitch numbers back to late July: the "Around the updates" table on the same page uses them. The card's query also stops at 96 hourly captures, so a full week of hourly data could never fit. And the page says Twitch is recorded every hour, while the card holds about one complete capture every two hours. Fix the card and check the collection before rewriting its caveat. The caveat may not be needed afterward.

---

## Appendix: the plan (not part of the standard)

### Direction

The site stays focused on Crimson Desert.

The planned home page is a data-led "check before you play" page: players online against a normal day, Steam mood, the latest patch, and the top live problems, drawn as strong, accessible charts. The audit clears the way for it with one vocabulary, answer-first copy, and charts that meet the accessibility rules above.

### Bylines and the human element

- The column runs as "State of the Game" and is signed Statusnone.
- Opinion pieces are signed Statusnone.
- A short "Who runs this" note in your own words, signed Statusnone and linked from the footer.
- Pseudonym only. The note, and everything else on the site, carry no legal name and no personal details.
- Keep "made with AI help", next to a person who answers for the site.

### The State of the Game column

Build it with this standard as its style guide.

- The 15-point checklist goes into both the writer prompt and the checker prompt.
- The first three editions run approve-first. Each one waits in /operator until you approve it, so you can tune the voice. After the third approved edition, the column switches automatically to the 24-hour hold, with auto-publish and your veto.

### AI on the site

The State of the Game column is the only on-site feature that will use the Anthropic API. The scanner stays on OpenRouter (DeepSeek V4.1 Flash) for now.

### The audit (after PRs 11 and 13 land)

1. Inventory. List every public string with the page it appears on: rendered pages plus source (headings, labels, buttons, alt text, page titles, feeds).
2. Score. Run an automated style pass and an accessibility check (contrast, target size, focus, keyboard). Review each page against Nielsen's 10 heuristics. Then I read every page as a player and mark what to cut, merge or rename.
3. Fix in small PRs, busiest pages first: home, patch pages and articles, issues, Observatory, Method and About, then the rest. Each PR comes with before and after screenshots on desktop and phone. Bugs found on the way, like the Twitch card, get their own small PRs.
4. Match the publish rule to "Reported". Today an issue goes public on an approved player report, on two different sites with at least one trusted, or on three sites. Every Steam forum thread counts as the same site, so ten separate threads about one crash still count once, and no issue has been published on 2.03.02. The code rule changes so separate threads from different people count, even on the same site. The scanner never reads author names, so telling people apart needs a privacy-safe check; the audit settles which.
5. Lock it in. Add the style test to CI, and put the standard and checklist in every writing prompt.

Who does what: I run it and bring every decision to you. A few subagents do the mechanical parts (string inventory, lint, screenshot diffs). You approve wording and write the personal parts.
