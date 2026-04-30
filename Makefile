# JerryOS — sanitization & verification

.PHONY: lint check-secrets check-paths help

help:
	@echo "JerryOS Makefile targets:"
	@echo "  make lint           — run all sanitization checks (fail on hit)"
	@echo "  make check-secrets  — grep for committed secrets / tokens"
	@echo "  make check-paths    — grep for hardcoded developer paths"

# All sanitization gates rolled into one. CI-friendly: exits non-zero on any hit.
lint: check-personal-names check-paths check-secrets
	@echo "✓ All sanitization checks passed."

# Reject Jerry-specific identifiers anywhere in the shipped tree. Update this
# allow-list only when intentionally adding new placeholder names.
check-personal-names:
	@echo "→ Checking for personal names / entity names…"
	@! grep -rInE "jerryshi@synergiscap|jerryshi(max)?@|施童洲|施哲|Synergis Capital|UUL Global|Current Equities|\\bSYN\\b|\\bCE\\b|\\bUUL\\b|\\bFO\\b|\\bNYFW\\b|\\bMatt\\b|\\bAngel Zhou\\b|\\bJosie Rao\\b|\\bDora\\b|\\bOwen\\b|\\bVictoria\\b|Tongzhou" \
	  --include="*.md" --include="*.sh" --include="*.json" --include="*.template" --include="*.example" \
	  --exclude-dir=".git" --exclude-dir="modules" --exclude-dir="cloud-bot" \
	  claude/ docs/ examples/ brain/ README.md setup.sh upgrade.sh jerryos.conf.example 2>/dev/null \
	  || (echo "✗ Found personal names / entity tags. Sanitize before commit." && exit 1)
	@echo "  ✓ no personal names / entity tags found"

check-paths:
	@echo "→ Checking for hardcoded /Users/<name> paths…"
	@! grep -rInE "/Users/jerryshi" \
	  --include="*.md" --include="*.sh" --include="*.json" --include="*.template" --include="*.example" \
	  --exclude-dir=".git" --exclude-dir=".claude" --exclude-dir="modules" --exclude-dir="cloud-bot" \
	  claude/ docs/ examples/ brain/ README.md setup.sh upgrade.sh 2>/dev/null \
	  || (echo "✗ Found hardcoded developer paths. Use \$$HOME instead." && exit 1)
	@echo "  ✓ no hardcoded developer paths found"

check-secrets:
	@echo "→ Checking for committed secrets…"
	@! grep -rInE "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xoxb-[0-9]+-[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{30,}|7[0-9]{9}:[A-Za-z0-9_-]{20,})" \
	  --include="*.md" --include="*.sh" --include="*.json" --include="*.ts" --include="*.template" --include="*.example" \
	  --exclude-dir=".git" \
	  . 2>/dev/null \
	  || (echo "✗ Found committed secrets. Remove and rotate." && exit 1)
	@echo "  ✓ no committed secrets found"
