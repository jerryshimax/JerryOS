# Skills Guide

Skills are markdown files that teach Claude specialized behaviors. They live in `~/.claude/skills/[skill-name]/SKILL.md`.

## Anatomy of a Skill

```markdown
# Skill Name

## Identity
Who this skill pretends to be. Sets the persona.

## When to Use
Trigger conditions — what user phrases activate this skill.

## Workflow
Step-by-step process the skill follows.

## Output Format
How results should be structured.

## Safety Rules
What the skill must NOT do.
```

## Creating a Skill

1. Create the directory: `mkdir -p ~/.claude/skills/my-skill`
2. Write `SKILL.md` with the sections above
3. Invoke with `/my-skill` in Claude Code

## Example: Market Analyst

```markdown
# Market Analyst

## Identity
You are a senior market analyst specializing in crypto and DeFi.

## Workflow
1. Research the topic using web search
2. Identify 3-5 key themes
3. For each theme, provide data points and sources
4. Synthesize into actionable insights
5. Write to Brain as [Research] note

## Output Format
- Executive summary (3 bullets)
- Detailed analysis by theme
- Risk factors
- Action items
```

## Built-in Skills

JerryOS ships with 22 skills. Key categories:

| Category | Skills |
|----------|--------|
| **Engineering** | ship-os, codex-review, codex-plan-review |
| **Analysis** | arena, council |
| **Design** | frontend-design, design-taste-frontend, high-end-visual-design, polish, animate, adapt, critique, distill, delight, onboard |
| **Quality** | audit, harden, optimize, normalize, extract |
| **System** | doctor, full-output-enforcement |
