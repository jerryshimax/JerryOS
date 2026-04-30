# Brain (Obsidian) Conventions

Brain is your knowledge layer. Flat vault, type-first naming, frontmatter-driven indexing.

## Path

Configured by `BRAIN_PATH` in `jerryos.conf` (default `$HOME/Brain`).

## Filename pattern

```
[Type] Entity - Description.md
[Type] Entity - YYYY-MM-DD Description.md   # for dated notes
```

- **Type** in square brackets, always first.
- **Entity** = your tag (e.g., `FUND`, `OPS`). Personal notes omit entity.
- **Date** in ISO format (YYYY-MM-DD), never quarters.
- Description ≤ 60 characters.

## Type catalog

### Work types
| Type | Use |
|------|-----|
| `[Research]` | Thematic deep dives, sector analysis |
| `[Memos]` | Polished, investor-facing memos only. Never auto-generate. |
| `[Datarooms]` | Diligence collateral organized for deal review |
| `[Decks]` | Decks received from others |
| `[Meetings]` | Meeting notes + deal stubs (only stated facts, no auto-research) |
| `[Legal]` | Contracts, structure docs, NDAs |
| `[People]` | One file per person — CRM record |
| `[Design]` | Brand/visual direction notes |
| `[Events]` | Conference notes, panel prep |
| `[Inbox]` | Raw brain dumps awaiting processing |
| `[Ship]` | Spec / build notes for engineering work |

### Personal types
| Type | Use |
|------|-----|
| `[Medical]` | Health records, doctor notes |
| `[Wellness]` | Whoop / sleep / training logs |
| `[Home]` | Property, household, vendors |
| `[Finance]` | Personal accounts, taxes |
| `[Travel]` | Trips, flights, hotels |
| `[Documents]` | Passports, IDs, certificates |

## Frontmatter spec

Every Brain note opens with YAML frontmatter:

```markdown
---
type: research                # required — lowercase type, no brackets
entity: FUND                  # required for work notes; omit for personal
date: 2026-04-29              # ISO date or omit
status: draft                 # draft | in-progress | done | superseded
tags: [ai, infra]             # optional
related: ["[[Other Note]]"]   # optional bidirectional links
---
```

Rule: `[Memos]` = polished IC/investor-facing only. `[Meetings]` = notes + deal stubs (stated facts only). `[Decks]` = received decks. Never auto-promote a meeting note to a memo.

## Indexes

Each entity has an index file under `Indexes/<TAG>.md`. The `brain-guard.sh` hook auto-queues index refreshes when new notes are added.

Default index sections: Memos / Meeting Notes / Research / Events. Customize per entity.

## Activity Log

Single rolling file `Activity Log.md`. The `brain-guard` hook appends one line per Brain write:

```
- 2026-04-29 14:32 — [Meetings] FUND - 2026-04-29 Acme Series B Call.md
```

## Templates

Live in `Templates/`. Reference via Obsidian's Templates plugin or the templater plugin if you have it. JerryOS ships templates for each type.

## Common tasks (auto-loaded)

When Claude touches a Brain file, `~/.claude/rules/common-tasks.md` is auto-loaded. It covers patterns like:

- New deal → GDrive folder + `[Memos] FUND - Company.md`
- Meeting note → `[Meetings] Entity - YYYY-MM-DD Topic.md`
- New person → `[People] First Last.md`

Customize that file to match your routing.

## Lint protocol

Weekly: scan for stale files (`status: in-progress` over 30 days), duplicates, orphans (no inbound links), index gaps. Run via Claude: `Run a Brain lint pass — flag stale, duplicate, and orphan notes.`

## What does NOT belong in Brain

- Live datasets — those go in `WORK_PATH` (Google Drive / Dropbox)
- Code — that's `SHIP_PATH` (e.g., `~/Ship/`)
- Secrets, credentials — never in Brain
- Photos / video — link from Brain, store in cloud
