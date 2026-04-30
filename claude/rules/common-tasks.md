# Common Task Patterns

Loaded automatically when Claude works with deal, meeting, people, or health files.

## New Deal / Evaluation

- Cloud storage: `[01] ENTITY_A/Deals/Active Pipeline/[Company Name]/`
- Brain: `[Memos] ENTITY_A - Company Name.md` (use Deal Note template)
- Status lives in frontmatter, not the filename: `status: Evaluating | In DD | Portfolio | Passed`

## New Deck

- Cloud storage: relevant entity folder under `Decks/`
- Brain: `[Decks] Entity - Description.md`

## New LP / Investor Contact

- Cloud storage: `[01] ENTITY_A/Fund/LP Targets/[LP Name]/` (or equivalent for your fund entity)
- Brain: `[People] LP Name.md`

## New Person

- Brain: `[People] First Last.md` (use Person Note template)
- Auto-update existing People notes after meetings — don't let them go stale.

## Meeting Note

- Brain: `[Meetings] Entity - YYYY-MM-DD Topic.md` (use Meeting Note template)
- Stated facts only — no auto-research.
- Selectivity: only board / deals / LP / new partnerships warrant a Brain note. Daily ops → ephemeral, no Brain file.

## Health Record

- Brain: `[Medical] Self - YYYY-MM-DD Description.md` for visits / events
- Brain: `[Medical] Self - Record Type.md` for living docs (e.g., `[Medical] Self - Vaccination History.md`)
- Auto-log health mentions from chat into the appropriate file.

## Travel

- Brain: `[Travel] YYYY-MM Destination.md` for the trip plan
- File flight confirmations / itineraries in the same note
- For personal travel, use neutral names if the trip is private — never reveal vacation destinations to teams or family by default.

## Memo Discipline

- `[Memos]` is **decision-grade**, IC/investor-facing. Never auto-generate. Only after explicit approval.
- `[Meetings]` is the place for deal stubs and meeting captures.
- `[Research]` is where competitor decks go — not `[Decks]` (which is for decks you intend to send out or re-use).
