---
paths:
  - "**/Brain/**/*.md"
  - "**/[00] Brain/**/*.md"
---

# Brain File Naming Convention

Loaded automatically when Claude reads or writes any file in the Brain vault.

**Pattern:** `[Type] Entity - Description.md`
- With date: `[Type] Entity - YYYY-MM-DD Description.md`
- No entity: `[Type] Description.md`
- Non-English content: description in the source language, tags/entity/date stay in English
- Always use `YYYY-MM-DD` dates, never quarters (e.g., `2025-01-15` not `2025-Q1`) — quarters make it impossible to distinguish iterations within a quarter.

## Work Types

| Type | What goes here |
|------|---------------|
| `[Research]` | Deep dives, analysis, reports, thematic research |
| `[Memos]` | Investment memos, IC memos, deal evaluations (polished, decision-grade) |
| `[Datarooms]` | Financial models, DD packages, deal data |
| `[Decks]` | Corporate, marketing, investment, pitch decks received or sent |
| `[Meetings]` | Meeting notes, call notes, board minutes |
| `[Legal]` | LPA, contracts, board resolutions, compliance |
| `[People]` | CRM — one note per person |
| `[Design]` | Logos, brand guidelines, creative assets, website copy |
| `[Events]` | Conferences, summits, roundtables, dinners |
| `[Inbox]` | Raw idea dumps and rough briefs — captured on the go (Apple Notes, voice memos), pasted into Claude Code when ready to act. Claude creates the Brain file with frontmatter. Once promoted to a real project, the Inbox file is deleted. |
| `[Ship]` | Engineering projects, tools, specs, system configs |

## Personal Types

| Type | What goes here |
|------|---------------|
| `[Medical]` | Doctor visits, labs, diagnoses, prescriptions |
| `[Wellness]` | Fitness, nutrition, supplements, sleep, recovery |
| `[Home]` | Real estate, renovations, property docs |
| `[Finance]` | Banking, accounts, personal investments |
| `[Travel]` | Trips, itineraries, flight details |
| `[Documents]` | IDs, passports, legal identity docs |

## Entity Tags

Edit this table during setup. Pattern: short uppercase tag → full entity name → scope.

| Tag | Entity | Scope |
|-----|--------|-------|
| `ENTITY_A` | (your primary entity) | (what it covers) |
| `ENTITY_B` | (your secondary entity) | (what it covers) |
| `ENTITY_C` | (your tertiary entity) | (what it covers) |
| `Workflow` | OS / Claude Code | Ideas for tuning Claude Code, automation improvements |

**How to pick the entity:** Tag by **who is doing the work**, not status. Whether a deal is pipeline or portfolio goes in the frontmatter `status` field (e.g., Evaluating, Active, Portfolio, Passed), not the filename.

Entity is optional — only include when it adds clarity. For personal health files, use the person's name instead of an entity tag. `Workflow` is only used with `[Inbox]` — never on finished work.

## Canonical Frontmatter Type Values

Every Brain file must have a `type:` field in frontmatter. Use these **lowercase** canonical values:

| Filename Prefix | Canonical `type:` | Required Fields |
|-----------------|-------------------|-----------------|
| `[Meetings]` | `meeting` | `type`, `entity`, `date` |
| `[People]` | `person` | `type` |
| `[Memos]` | `memo` or `deal-note` | `type`, `entity` |
| `[Research]` | `research` | `type` |
| `[Medical]` | `medical` | `type`, `person`, `date` |
| `[Wellness]` | `wellness` | `type`, `person` |
| `[Ship]` | `ship` | `type` |
| `[Events]` | `event` | `type`, `entity` |
| `[Decks]` | `deck` | `type`, `entity` |
| `[Home]` | `home` | `type` |
| `[Travel]` | `travel` | `type` |
| `[Inbox]` | `inbox` | `type`, `entity` |

Use `deal-note` (not `memo`) for screening memos and IC memos with a specific company.

## Brain Vault Rules

### 1. Living vs. Snapshot vs. Sent — pick before naming

This is the rule that prevents file clutter. Every Brain file falls into one of three categories:

| Category | Date in filename? | New file or update existing? | Examples |
|---|---|---|---|
| **Living doc** — working draft, evolving plan, ongoing strategy, deck in progress, master memo | NO | Always update in place. Iterations live in git history, not filenames. | `[Ship] ENTITY_A - Strategic Round Deck.md`, `[Memos] ENTITY_A - Master Strategic Plan.md`, `[Wellness] Self - Supplement Stack.md` |
| **Snapshot** — meeting note, point-in-time research, dated brief for one recipient on one day | YES | New file per event | `[Meetings] ENTITY_A - 2026-05-04 Partner Call.md`, `[Research] 2026-03-18 Market Analysis.md` |
| **Sent artifact** — memo sent to LPs, deck shared externally, signed legal doc | YES | New file when the version-of-record changes; old version goes to `_superseded/` | `[Memos] ENTITY_A - 2025-Q4 Fund II IC Memo.md` |

**Default when in doubt: living doc, no date.** Adding a date "just in case" creates the clutter problem. The single biggest cause of Brain bloat is treating evolving working docs as snapshots and stamping them with today's date every iteration.

**Never use version suffixes (`v1`, `v2`, `v3`, `Working Doc`) in filenames.** If you find yourself wanting to add `v2`, the existing file should be updated in place instead, OR (rare) it's genuinely a new artifact and the old one should be moved to `_superseded/`.

### 2. Pre-creation duplicate gate

Before creating any `[Ship]`/`[Memos]`/`[Research]` file, fuzzy-match against the last 14 days for same `[Type]` + same entity + overlapping keywords. If a sibling exists, **default to UPDATING** the existing file. Only fork into a new file if the new artifact has a genuinely different audience/purpose (e.g. an internal working doc vs. a polished memo sent to LPs). When forking, mark the old file as superseded (see rule 3).

Common duplicate patterns to catch:
- EN + native-language versions of the same doc
- Meeting note promoted to memo with both kept
- Multiple versions with timestamps or `v1`/`v2` suffixes
- "Working Doc" + "Wireframe" + "Synthesis" of the same artifact

### 3. Supersede + archive flow

When a new file genuinely replaces an old one:
1. New file frontmatter: `supersedes: [old-filename.md]`
2. Old file frontmatter: `superseded_by: [new-filename.md]` and `status: superseded`
3. Move the old file to `_superseded/` (still in git history, out of the main vault listing)
4. Add Activity Log entry: `- HH:MM **Superseded** old.md → new.md`

The `_superseded/` folder is the archive. Never delete superseded files — they're version history. But never reference them as current either.

### 4. Index awareness

After creating or editing a Brain file, update the relevant `Indexes/*.md` if context allows. The PostToolUse `brain-guard` hook queues stale indexes for SessionEnd refresh.

### 5. Activity Log is auto-maintained

The `brain-guard.sh` hook appends to `Activity Log.md` on every Brain write. No manual logging needed.

## Examples

| File | Type |
|------|------|
| `[Memos] ENTITY_A - ACME IC Memo.md` | Investment memo (living until sent) |
| `[Decks] ENTITY_B - 2025-01-15 Corporate Deck.md` | Deck snapshot (sent artifact) |
| `[Meetings] ENTITY_C - 2026-03-18 LP Call.md` | Meeting note (snapshot) |
| `[Research] 2026-03-18 Market Analysis.md` | Research snapshot (no entity) |
| `[People] John Smith.md` | CRM entry (living) |
| `[Legal] ENTITY_A - Fund II LPA.md` | Legal doc (living until signed) |
| `[Events] ENTITY_A - 2026-06 Industry Roundtable.md` | Event |
| `[Medical] Self - 2026-03-18 Annual Physical.md` | Health visit (snapshot) |
| `[Wellness] Self - Supplement Stack.md` | Living wellness doc |
| `[Travel] 2026-03 Singapore.md` | Trip file |
| `[Research] ENTITY_A - AI代理基础设施分析.md` | Non-English content (description in source language) |

## Storage Naming (project folders, separate from Brain)

| Type | Convention | Example |
|------|-----------|---------|
| Project folder | `[YYYY-QN] Name` | `[2025-Q1] Corporate Deck` |

**Finder color tags (macOS):**
- Red = Urgent / Hard deadline
- Orange = In Review / Needs action
- Yellow = Draft / WIP
- Green = Final / Signed
- Blue = Reference / FYI
