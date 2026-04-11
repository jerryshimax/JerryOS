# Architecture

## System Diagram

```mermaid
graph TB
    subgraph "Claude Code"
        CM[CLAUDE.md<br/>Operating Context]
        SK[Skills<br/>22 specialized agents]
        MEM[Memory<br/>Persistent learned facts]
        
        subgraph "Safety Hooks"
            SG[safety-gate.sh<br/>Block dangerous commands]
            BB[backup-before-edit.sh<br/>Pre-edit snapshots]
            BG[brain-guard.sh<br/>Validate + log writes]
        end
    end
    
    subgraph "Obsidian Brain Vault"
        DASH[Dashboard.md]
        TMPL[Templates/]
        IDX[Indexes/]
        AL[Activity Log]
        FILES["[Type] Entity - Desc.md"]
    end
    
    subgraph "Modules"
        BOT[Cloud Bot<br/>Telegram]
        ARENA[Arena<br/>Multi-model]
        MCPM[MCP Memory<br/>Vault search]
        MCPT[MCP Tasks<br/>Google Tasks]
    end
    
    subgraph "Safety Layer"
        VAULT[~/.vault/<br/>AI-inaccessible backups]
    end
    
    CM --> SK
    CM --> MEM
    SG -->|blocks| CM
    BB -->|backs up to| VAULT
    BG -->|validates| FILES
    BG -->|logs to| AL
    BG -->|queues| IDX
    MCPM -->|searches| FILES
    BOT -->|dispatches to| CM
    ARENA -->|multi-model| CM
```

## Data Flow

1. **User input** → Claude Code reads CLAUDE.md for context
2. **Bash commands** → safety-gate.sh checks deny patterns → blocks or allows
3. **File edits** → backup-before-edit.sh snapshots → edit proceeds → brain-guard.sh validates
4. **Brain writes** → brain-guard.sh validates frontmatter, logs to Activity Log, queues index refresh
5. **Search** → MCP Memory searches vault via TF-IDF scoring
6. **Telegram** → Cloud Bot receives message → dispatches to Claude Code → sends response

## Key Principles

1. **Safety first**: Every destructive action is blocked or backed up
2. **Flat vault**: All Brain files at root level for speed
3. **Type-first naming**: `[Type]` prefix enables instant categorization
4. **Frontmatter as metadata**: Enables Dataview queries and validation
5. **AI-inaccessible backups**: `~/.vault/` is deny-listed in all tools
