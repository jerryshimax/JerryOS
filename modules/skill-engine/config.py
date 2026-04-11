"""Configuration for the skill engine."""

from pathlib import Path

# Directories
SKILL_ENGINE_DIR = Path(__file__).parent
LEARNED_DIR = SKILL_ENGINE_DIR / "learned"
DB_PATH = SKILL_ENGINE_DIR / "skills.db"
LOGS_DIR = Path.home() / "Ship" / "logs"
CLAUDE_SKILLS_DIR = Path.home() / ".claude" / "skills"

# Skill detection thresholds
MIN_CONFIDENCE_DEFAULT = 0.3
NOVELTY_THRESHOLD = 0.7  # Below this similarity score = novel enough to create skill
GENERALIZABILITY_THRESHOLD = 0.5

# Skill improvement
CONFIDENCE_BOOST_ON_SUCCESS = 0.05
CONFIDENCE_DECAY_ON_FAILURE = 0.1
MAX_CONFIDENCE = 1.0
MIN_CONFIDENCE = 0.0

# Ensure directories exist
LEARNED_DIR.mkdir(parents=True, exist_ok=True)
