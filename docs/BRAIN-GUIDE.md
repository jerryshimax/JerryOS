# Brain Vault Guide

The Brain is an Obsidian vault where all your knowledge lives. It uses a flat structure with strict naming conventions so both you and Claude can find anything instantly.

## Structure

```
Brain/
├── .obsidian/          <- Obsidian config
├── Templates/          <- File templates
├── Indexes/            <- Auto-maintained catalogs per entity
├── Dashboard.md        <- Master index with Dataview queries
├── Activity Log.md     <- Auto-maintained by brain-guard.sh
└── *.md                <- All content files at root (flat)
```

## Naming Convention

**Pattern:** `[Type] Entity - Description.md`

| Variant | Example |
|---------|---------|
| With entity | `[Research] ACME - DeFi Analysis.md` |
| Without entity | `[Research] DeFi Lending Overview.md` |
| With date | `[Meetings] ACME - 2025-03-18 Call.md` |
| Person | `[People] John Smith.md` |

## Types

| Prefix | Type | Required Frontmatter |
|--------|------|---------------------|
| `[Research]` | research | `type` |
| `[Meetings]` | meeting | `type`, `entity`, `date` |
| `[People]` | person | `type` |
| `[Memos]` | memo / deal-note | `type`, `entity` |
| `[Decks]` | deck | `type`, `entity` |
| `[Events]` | event | `type`, `entity` |
| `[Legal]` | legal | `type` |
| `[Ship]` | ship | `type` |
| `[Finance]` | finance | `type` |
| `[Travel]` | travel | `type` |
| `[Home]` | home | `type` |
| `[Documents]` | documents | `type` |
| `[Inbox]` | inbox | `type` |

## Frontmatter

Every file must start with YAML frontmatter:

```yaml
---
type: meeting
entity: ACME
date: 2025-03-18
attendees:
  - John Smith
  - Jane Doe
---
```

The `brain-guard.sh` hook validates this automatically.

## Entity Tags

Tags are short uppercase identifiers for your organizations:

```
[Meetings] ACME - 2025-03-18 Partner Call.md
            ^^^^
            entity tag
```

Define your tags in `jerry-os.conf` when setting up.

## Templates

Templates live in `Brain/Templates/`. When creating a new file, Claude uses the appropriate template to set up frontmatter and structure.

## Activity Log

Auto-maintained by `brain-guard.sh`. Every time Claude creates or edits a Brain file, it gets logged:

```markdown
## 2025-03-18
- 14:30 **Created** [Research] DeFi Analysis.md
- 15:45 **Updated** [People] John Smith.md
```

## Indexes

One index file per entity in `Brain/Indexes/`. Auto-queued for refresh when related files change.

## Dashboard

Uses Dataview queries to show:
- Active deals/projects
- Recent meetings
- Vault health (files missing frontmatter)
- Recently modified files

Requires the Dataview Obsidian plugin.
