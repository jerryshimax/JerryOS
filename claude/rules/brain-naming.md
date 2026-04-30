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
| `[Inbox]` | Raw idea dumps and rough briefs — captured on the go, promoted to real Brain files later |
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

1. **Duplicate check before creating.** Before creating a new Brain file, search for similar files. Common duplicate patterns: EN + native-language versions, meeting note promoted to memo with both kept, multiple timestamped versions of the same doc.
2. **Index awareness.** After creating or editing a Brain file, update the relevant `Indexes/*.md` if context allows. The PostToolUse `brain-guard` hook queues stale indexes for SessionEnd refresh.
3. **Activity Log is auto-maintained.** The `brain-guard.sh` hook appends to `Activity Log.md` on every Brain write. No manual logging needed.

## Examples

| File | Type |
|------|------|
| `[Memos] ENTITY_A - ACME IC Memo.md` | Investment memo |
| `[Decks] ENTITY_B - 2025-01-15 Corporate Deck.md` | Company deck |
| `[Meetings] ENTITY_C - 2025-03-18 LP Call.md` | Meeting note |
| `[Research] 2025-03-18 DeFi Lending Market.md` | Research (no entity) |
| `[People] John Smith.md` | CRM entry |
| `[Legal] ENTITY_A - Fund II LPA.md` | Legal document |
| `[Events] ENTITY_A - 2025-06 Industry Roundtable.md` | Event |
| `[Medical] Self - 2025-03-18 Annual Physical.md` | Health visit |
| `[Wellness] Self - Supplement Stack.md` | Living wellness doc |
| `[Travel] 2025-03 Singapore.md` | Trip file |

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
