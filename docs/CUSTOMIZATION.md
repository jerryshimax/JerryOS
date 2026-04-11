# Customization Guide

## Adding Entities

Edit `jerry-os.conf`:

```bash
ENTITIES=(
  "TRADE:Alpha Trading:Main trading activity"
  "RES:DeFi Research:Research arm"
  "NEW:New Venture:Side project"    # Add new entity
)
```

Re-run `./setup.sh` — it will create the new index file and update CLAUDE.md.

## Writing Custom Skills

Skills are markdown files that tell Claude how to behave for specific tasks.

Create `~/.claude/skills/your-skill/SKILL.md`:

```markdown
# Your Skill Name

## Identity
You are a [role]. You specialize in [domain].

## Workflow
1. Step one
2. Step two
3. Step three

## Output Format
[How results should look]
```

Invoke with `/your-skill` in Claude Code.

See [SKILLS-GUIDE.md](SKILLS-GUIDE.md) for the full format.

## Adding Safety Hook Patterns

Edit `~/.claude/hooks/safety-gate.sh` and add patterns to the `deny_patterns` array:

```bash
deny_patterns=(
  # ... existing patterns ...

  # Your custom blocks
  'your-dangerous-pattern'
  'another-pattern-to-block'
)
```

## Changing Backup Behavior

Edit `~/.claude/hooks/backup-before-edit.sh` to add more critical paths:

```bash
case "$file_path" in
  # ... existing patterns ...
  */your-important-dir/*.md)  critical=true ;;
esac
```

## Adding Brain File Types

1. Create a template in `brain/Templates/YourType.md`
2. Add the type mapping in `claude/hooks/brain-guard.sh`
3. Document it in your CLAUDE.md
