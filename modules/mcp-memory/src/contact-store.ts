import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface ContactRecord {
  canonical_name: string;
  aliases: string[];
  chinese_name: string | null;
  source: "user_contacts" | "brain_people";
  file_path: string;
  entity_tags: string[];
  telegram_handles: string[];
  telegram_user_ids: string[];
  organizations: string[];
  roles: string[];
  relationship_summary: string;
  trust_level: "full" | "high" | "normal" | "unknown";
  last_modified_at: string;
}

export interface ContactConflict {
  canonical_name: string;
  reason: string;
  file_paths: string[];
  aliases: string[];
}

const HOME = os.homedir();
// Auto-detect the Claude project memory directory
function findUserContacts(): string {
  const projectsDir = path.join(HOME, ".claude", "projects");
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir).filter(d =>
      fs.existsSync(path.join(projectsDir, d, "memory", "user_contacts.md"))
    );
    if (dirs.length > 0) {
      return path.join(projectsDir, dirs[0], "memory", "user_contacts.md");
    }
  }
  return path.join(projectsDir, "default", "memory", "user_contacts.md");
}

const USER_CONTACTS_PATH = process.env.USER_CONTACTS_PATH || findUserContacts();
const BRAIN_DIR = process.env.BRAIN_DIR || path.join(HOME, "Brain");

// Entity tags are configurable — override via ENTITY_TAGS env var (comma-separated)
const ENTITY_TAGS = (process.env.ENTITY_TAGS || "").split(",").filter(Boolean);

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseAliases(rawName: string): { aliases: string[]; chineseName: string | null } {
  const parts = rawName
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const aliases = uniqueTrimmed(parts);
  const chinese = aliases.find((alias) => /[\u3400-\u9fff]/.test(alias)) || null;
  return { aliases, chineseName: chinese };
}

function inferTrustLevel(text: string): ContactRecord["trust_level"] {
  const lower = text.toLowerCase();
  if (lower.includes("full trust")) return "full";
  if (lower.includes("high trust") || lower.includes("high-level access")) return "high";
  if (lower.length > 0) return "normal";
  return "unknown";
}

function inferEntityTags(text: string): string[] {
  return ENTITY_TAGS.filter((tag) => text.includes(tag));
}

function inferOrganizations(text: string): string[] {
  const matches = Array.from(
    text.matchAll(/\b(?:Founder|CEO|CFO|Managing Partner|Partner|co-founder|law firm) of ([^.]+?)(?:[.,]|$)/gi)
  ).map((match) => match[1].trim());
  return uniqueTrimmed(matches);
}

function inferRoles(text: string): string[] {
  const matches = Array.from(
    text.matchAll(
      /\b(CEO|CFO|Founder|Managing Partner|Partner|co-founder|team member|investment team|middle office)\b/gi
    )
  ).map((match) => match[1]);
  return uniqueTrimmed(matches);
}

function buildRecord(
  source: ContactRecord["source"],
  filePath: string,
  rawName: string,
  summary: string,
  extra: Partial<ContactRecord> = {}
): ContactRecord {
  const stat = fs.statSync(filePath);
  const { aliases, chineseName } = parseAliases(rawName);
  const canonical = aliases.find((alias) => !/[\u3400-\u9fff]/.test(alias)) || aliases[0] || rawName.trim();

  return {
    canonical_name: canonical,
    aliases,
    chinese_name: chineseName,
    source,
    file_path: filePath,
    entity_tags: extra.entity_tags || inferEntityTags(summary),
    telegram_handles: uniqueTrimmed(extra.telegram_handles || []),
    telegram_user_ids: uniqueTrimmed(extra.telegram_user_ids || []),
    organizations: uniqueTrimmed(extra.organizations || inferOrganizations(summary)),
    roles: uniqueTrimmed(extra.roles || inferRoles(summary)),
    relationship_summary: summary.trim(),
    trust_level: extra.trust_level || inferTrustLevel(summary),
    last_modified_at: stat.mtime.toISOString(),
  };
}

function scanUserContacts(): ContactRecord[] {
  if (!fs.existsSync(USER_CONTACTS_PATH)) return [];

  const raw = fs.readFileSync(USER_CONTACTS_PATH, "utf-8");
  const records: ContactRecord[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- **")) continue;

    const nameMatch = trimmed.match(/^- \*\*(.+?)\*\*/);
    if (!nameMatch) continue;

    const rawName = nameMatch[1].trim();
    const handleMatches = Array.from(
      trimmed.matchAll(/\bTG:\s*([A-Za-z0-9_]+)/g)
    ).map((match) => match[1]);
    const userIdMatches = Array.from(
      trimmed.matchAll(/\buser_id:\s*([0-9]+)/g)
    ).map((match) => match[1]);
    const summary = trimmed.split("—").slice(1).join("—").trim();

    records.push(
      buildRecord("user_contacts", USER_CONTACTS_PATH, rawName, summary, {
        telegram_handles: handleMatches,
        telegram_user_ids: userIdMatches,
      })
    );
  }

  return records;
}

function listPeopleFiles(): string[] {
  if (!fs.existsSync(BRAIN_DIR)) return [];

  return fs
    .readdirSync(BRAIN_DIR)
    .filter((entry) => entry.startsWith("[People]") && entry.endsWith(".md"))
    .map((entry) => path.join(BRAIN_DIR, entry));
}

function scanBrainPeople(): ContactRecord[] {
  const records: ContactRecord[] = [];

  for (const filePath of listPeopleFiles()) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const fileName = path.basename(filePath).replace(/^\[People\]\s*/, "").replace(/\.md$/, "");
    const summary = raw
      .replace(/^---[\s\S]*?---\n?/, "")
      .trim()
      .split(/\n{2,}/)
      .slice(0, 2)
      .join(" ")
      .slice(0, 600);

    const handleMatches = Array.from(
      raw.matchAll(/\b(?:TG|Telegram|@)(?:\s*:\s*|\s+)?([A-Za-z0-9_]{3,})/g)
    ).map((match) => match[1]);
    const userIdMatches = Array.from(
      raw.matchAll(/\buser[_ ]?id:\s*([0-9]+)/gi)
    ).map((match) => match[1]);

    records.push(
      buildRecord("brain_people", filePath, fileName, summary, {
        telegram_handles: handleMatches,
        telegram_user_ids: userIdMatches,
      })
    );
  }

  return records;
}

export function scanContacts(): ContactRecord[] {
  return [...scanUserContacts(), ...scanBrainPeople()].sort((a, b) =>
    a.canonical_name.localeCompare(b.canonical_name)
  );
}

export function findContact(query: string): ContactRecord[] {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];

  return scanContacts().filter((record) => {
    const haystacks = [
      record.canonical_name,
      record.chinese_name || "",
      record.relationship_summary,
      ...record.aliases,
      ...record.telegram_handles,
      ...record.telegram_user_ids,
      ...record.organizations,
      ...record.roles,
    ];
    return haystacks.some((value) => value.toLowerCase().includes(normalized));
  });
}

export function getContactByCanonicalName(name: string): ContactRecord | null {
  const normalized = name.toLowerCase().trim();
  return (
    scanContacts().find(
      (record) => record.canonical_name.toLowerCase() === normalized
    ) || null
  );
}

export function detectContactConflicts(
  records: ContactRecord[] = scanContacts()
): ContactConflict[] {
  const groups = new Map<string, ContactRecord[]>();

  for (const record of records) {
    const keys = new Set<string>([
      record.canonical_name.toLowerCase(),
      ...record.aliases.map((alias) => alias.toLowerCase()),
    ]);
    for (const key of keys) {
      const list = groups.get(key) || [];
      list.push(record);
      groups.set(key, list);
    }
  }

  const conflicts: ContactConflict[] = [];
  const seen = new Set<string>();

  for (const [key, matches] of groups.entries()) {
    const distinctFiles = uniqueTrimmed(matches.map((match) => match.file_path));
    if (distinctFiles.length < 2) continue;

    const signature = distinctFiles.slice().sort().join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);

    conflicts.push({
      canonical_name: matches[0].canonical_name,
      reason: `Alias collision on "${key}" across ${distinctFiles.length} files`,
      file_paths: distinctFiles,
      aliases: uniqueTrimmed(matches.flatMap((match) => match.aliases)),
    });
  }

  return conflicts.sort((a, b) =>
    a.canonical_name.localeCompare(b.canonical_name)
  );
}
