# Dashboard

---

## Quick Navigation

### Entity Indexes
- [[Indexes/Entity1|Entity 1]] — Primary entity index
- [[Indexes/Entity2|Entity 2]] — Secondary entity index
- [[Indexes/People|People]] — Contacts across all entities

### Master Documents
- [[Activity Log]] — Where did Claude file that thing? Check here.

---

## Recent Activity
> See [[Activity Log]] for full history. Last 5 entries:

| Date | Action | File |
|------|--------|------|
|      |        |      |

---

## Active Deals
```dataview
TABLE entity, stage, status
FROM ""
WHERE type = "deal-note" AND status != "Passed" AND status != "Portfolio"
SORT date_first_seen DESC
```

## Recent Meetings
```dataview
TABLE entity, attendees, type
FROM ""
WHERE type = "meeting"
SORT date DESC
LIMIT 10
```

---

## Templates
- [[Templates/Deal Note|New Deal]]
- [[Templates/Meeting Note|New Meeting]]
- [[Templates/Person Note|New Person]]

---

## Vault Health

### Files by Type
```dataview
TABLE length(rows) as "Count"
FROM ""
WHERE file.folder = "" AND type
GROUP BY type
SORT length(rows) DESC
```

### Missing Frontmatter
```dataview
LIST
FROM ""
WHERE file.folder = "" AND !type AND file.name != "Dashboard" AND file.name != "Activity Log"
```

### Recently Modified (7 days)
```dataview
TABLE file.mtime as "Modified", type, entity
FROM ""
WHERE file.mtime >= date(today) - dur(7 days) AND file.folder = ""
SORT file.mtime DESC
LIMIT 15
```

---

## Focus This Week
<!-- Update manually each Monday or ask Claude -->

## Waiting On
<!-- Things blocked on others -->
