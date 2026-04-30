---
paths:
  - "**/Downloads/**"
  - "**/My Drive/**"
  - "**/GoogleDrive-*/**"
  - "**/Dropbox/**"
---

# Cloud Storage Structure & Auto-Filing

Loaded automatically when Claude works with Downloads or cloud storage files.

This file is **templated**. Edit the entity folders during setup to match your actual structure. The `[NN]` prefix preserves sort order in macOS Finder.

## Structure (template)

```
My Drive/
├── [00] Brain/                     ← Obsidian vault — md files only (see brain-naming.md)
├── [01] ENTITY_A/                  ← Your primary entity
│   ├── Deals/                      ← One subfolder per company (if relevant)
│   ├── Fund/                       ← Fund-level docs (if applicable)
│   ├── Decks/                      ← Presentations
│   ├── Research/                   ← Thematic research
│   ├── Meetings/                   ← Meeting notes
│   ├── Legal/                      ← Contracts, compliance, tax forms
│   ├── Design/                     ← Branding, marketing assets
│   ├── Events/                     ← Conferences, roundtables
│   └── _Admin/                     ← HR, internal ops
├── [02] ENTITY_B/                  ← Secondary entity (mirror sub-structure)
│   ├── Decks/
│   ├── Strategy/
│   ├── Operations/
│   ├── Finance/
│   └── _Admin/
├── [03] ENTITY_C/                  ← Tertiary entity
├── [04] Portfolio/                 ← One subfolder per portfolio company
├── [05] Network/                   ← External networks, memberships, communities
├── [06] Personal/                  ← Personal life
│   ├── Self/                       ← Medical/, Wellness/, Documents/, Finance/
│   ├── Family/                     ← Family member subfolders
│   ├── Home/                       ← Real estate, property
│   ├── Travel/                     ← Trips
│   ├── Finance/                    ← Personal finance
│   └── Estate/                     ← Wills, trusts, insurance
└── [99] Archive/                   ← Old files
```

## Auto-Filing Routing (Downloads → Cloud Storage)

A downloads watcher (see `modules/_README.md → downloads-filer`) tags incoming files as `[Type] Entity - Description.ext`. Routing follows the pattern below — extend the table to match your entities.

| File Pattern | Destination |
|-------------|-------------|
| `[Decks] ENTITY_A -` | `[01] ENTITY_A/Decks/` |
| `[Legal] ENTITY_A -` | `[01] ENTITY_A/Legal/` |
| `[Research] ENTITY_B -` | `[02] ENTITY_B/Research/` |
| `[Meetings] ENTITY_C -` | `[03] ENTITY_C/Meetings/` |
| `[Design] ENTITY_C -` | `[03] ENTITY_C/Design/` |
| `[Medical] Self -` | `[06] Personal/Self/Medical/` |
| `[Wellness] Self -` | `[06] Personal/Self/Wellness/` |
| `[Documents] Self -` | `[06] Personal/Self/Documents/` |
| `[Travel]` | `[06] Personal/Travel/` |
| `[Home]` | `[06] Personal/Home/` |
| `[Finance]` (personal) | `[06] Personal/Finance/` |

Deal-specific files route to `[ENTITY_X]/Deals/[CompanyName]/` when a company name is detected in the filename.

## Customization

The setup script reads your `jerryos.conf` and renders this file with real entity names. To add or rename an entity later, edit `jerryos.conf` and re-run `./setup.sh`.
