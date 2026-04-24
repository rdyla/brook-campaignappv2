import type { CampaignRow, Catalog } from "../types";

// The CSV we get from ops sometimes contains a stray `â` where UTF-8 en-dash
// or right-single-quote got mis-decoded upstream. Restore the intended char so
// created campaign names are clean and matching against Zoom's queue list works.
export function cleanMojibake(s: string): string {
  return s.replace(/\s+â\s+/g, " – ").replace(/([A-Za-z])â([A-Za-z])/g, "$1'$2");
}

export function normalizeKey(s: string): string {
  return cleanMojibake(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function last10Digits(s: string): string {
  return s.replace(/\D/g, "").slice(-10);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export type SkipReason =
  | "duplicate-in-file"
  | "already-exists"
  | "queue-not-found"
  | "queue-ambiguous"
  | "phone-not-found"
  | "queue-and-phone-not-found";

export interface ResolvedRow {
  queueId?: string;
  phoneId?: string;
  queueSource: "csv" | "override" | "default" | "none";
  phoneSource: "csv" | "override" | "default" | "none";
  /** The normalized search key used for queue lookup — surfaced in UI on miss. */
  queueSearchKey?: string;
  /** How the queue was matched — transparency for the user. */
  queueMatchType?: "exact" | "contains" | "fuzzy-suggest" | "ambiguous" | "none";
  /** Closest-match queue name when CSV lookup had no exact hit. */
  queueSuggestion?: string;
  /** Candidate names when a contains-match was ambiguous (≥2 hits). */
  queueAmbiguous?: string[];
  skip: boolean;
  skipReason?: SkipReason;
  hasCsvQueue: boolean;
  hasCsvPhone: boolean;
}

export interface ResolverDefaults {
  queueId?: string;
  phoneId?: string;
}

export interface RowOverrideInput {
  queue_id?: string;
  phone_number_id?: string;
}

export function resolveRows(
  rows: CampaignRow[],
  catalog: Catalog,
  defaults: ResolverDefaults,
  overrides: Map<number, RowOverrideInput>
): ResolvedRow[] {
  const queueByKey = new Map<string, { id: string; name: string }>();
  for (const q of catalog.queues) queueByKey.set(normalizeKey(q.name), { id: q.id, name: q.name });
  const queueKeys = Array.from(queueByKey.keys());

  const phoneByDigits = new Map<string, string>();
  for (const p of catalog.phoneNumbers) phoneByDigits.set(last10Digits(p.number), p.id);

  const existingNameKeys = new Set<string>(
    (catalog.existingCampaigns ?? []).map((c) => normalizeKey(c.name))
  );

  const seenTriples = new Set<string>();

  // Pre-compute queue name word sets for the contains-all-words fallback.
  const queueWordSets = catalog.queues.map((q) => ({
    id: q.id,
    name: q.name,
    words: new Set(normalizeKey(q.name).split(" ").filter(Boolean)),
  }));

  return rows.map((row, idx) => {
    const ov = overrides.get(idx) ?? {};
    // Queue column alone is enough; organization is optional and collapses
    // when it duplicates the queue name (e.g. CSV row "YJH, YJH, …").
    const hasCsvQueue = Boolean(row.queue_name);
    const hasCsvPhone = Boolean(row.primary_did);

    // Queue resolution
    let queueId: string | undefined;
    let queueSource: ResolvedRow["queueSource"] = "none";
    let queueSearchKey: string | undefined;
    let queueMatchType: ResolvedRow["queueMatchType"];
    let queueSuggestion: string | undefined;
    let queueAmbiguous: string[] | undefined;

    if (ov.queue_id) {
      queueId = ov.queue_id;
      queueSource = "override";
      queueMatchType = "exact";
    } else if (hasCsvQueue) {
      const org = row.organization?.trim() ?? "";
      const queue = row.queue_name!;
      const orgKey = normalizeKey(org);
      const queueKey = normalizeKey(queue);
      const key = org && orgKey !== queueKey ? `${orgKey} ${queueKey}` : queueKey;
      queueSearchKey = key;

      // 1) Exact normalized match.
      const hit = queueByKey.get(key);
      if (hit) {
        queueId = hit.id;
        queueSource = "csv";
        queueMatchType = "exact";
      } else {
        // 2) Contains-all-words match — Zoom queue's word set ⊇ search key's words.
        const searchWords = key.split(" ").filter(Boolean);
        const containsMatches = queueWordSets.filter((q) =>
          searchWords.every((w) => q.words.has(w))
        );
        if (containsMatches.length === 1) {
          queueId = containsMatches[0].id;
          queueSource = "csv";
          queueMatchType = "contains";
        } else if (containsMatches.length > 1) {
          queueMatchType = "ambiguous";
          queueAmbiguous = containsMatches.map((q) => q.name);
        } else {
          // 3) Fuzzy suggestion (no auto-resolve).
          queueMatchType = "none";
          let bestKey: string | undefined;
          let bestDist = Infinity;
          for (const k of queueKeys) {
            const d = levenshtein(key, k);
            if (d < bestDist) {
              bestDist = d;
              bestKey = k;
            }
          }
          const threshold = Math.max(3, Math.floor(key.length * 0.2));
          if (bestKey && bestDist <= threshold) {
            queueSuggestion = queueByKey.get(bestKey)?.name;
            queueMatchType = "fuzzy-suggest";
          }
        }
      }
    } else if (defaults.queueId) {
      queueId = defaults.queueId;
      queueSource = "default";
      queueMatchType = "exact";
    }

    // Phone resolution
    let phoneId: string | undefined;
    let phoneSource: ResolvedRow["phoneSource"] = "none";

    if (ov.phone_number_id) {
      phoneId = ov.phone_number_id;
      phoneSource = "override";
    } else if (hasCsvPhone) {
      const hit = phoneByDigits.get(last10Digits(row.primary_did!));
      if (hit) {
        phoneId = hit;
        phoneSource = "csv";
      }
    } else if (defaults.phoneId) {
      phoneId = defaults.phoneId;
      phoneSource = "default";
    }

    // Skip determination — order matters. Check within-file dupe before existing
    // so a duplicated row in the CSV is reported as such, not as "already exists".
    let skip = false;
    let skipReason: SkipReason | undefined;

    const tripleKey = hasCsvQueue && row.campaign_suffix
      ? `t|${normalizeKey(row.organization ?? "")}|${normalizeKey(row.queue_name!)}|${normalizeKey(row.campaign_suffix)}`
      : `n|${normalizeKey(row.campaign_name)}`;

    if (seenTriples.has(tripleKey)) {
      skip = true;
      skipReason = "duplicate-in-file";
    } else {
      seenTriples.add(tripleKey);
    }

    if (!skip && existingNameKeys.has(normalizeKey(row.campaign_name))) {
      skip = true;
      skipReason = "already-exists";
    }

    if (!skip) {
      const noQueue = !queueId;
      const noPhone = !phoneId;
      const ambiguousQueue = queueMatchType === "ambiguous";
      if (noQueue && noPhone) {
        skip = true;
        skipReason = "queue-and-phone-not-found";
      } else if (ambiguousQueue) {
        skip = true;
        skipReason = "queue-ambiguous";
      } else if (noQueue) {
        skip = true;
        skipReason = "queue-not-found";
      } else if (noPhone) {
        skip = true;
        skipReason = "phone-not-found";
      }
    }

    return {
      queueId,
      phoneId,
      queueSource,
      phoneSource,
      queueSearchKey,
      queueMatchType,
      queueSuggestion,
      queueAmbiguous,
      skip,
      skipReason,
      hasCsvQueue,
      hasCsvPhone,
    };
  });
}

export function describeSkipReason(
  reason: SkipReason,
  opts: { searchKey?: string; suggestion?: string; ambiguous?: string[] } = {}
): string {
  const { searchKey, suggestion, ambiguous } = opts;
  const keyPart = searchKey ? ` (searched "${searchKey}")` : "";
  switch (reason) {
    case "duplicate-in-file":
      return "Duplicate in file";
    case "already-exists":
      return "Already exists in Zoom";
    case "queue-not-found":
      return suggestion
        ? `Queue not found${keyPart} — did you mean "${suggestion}"?`
        : `Queue not found${keyPart}`;
    case "queue-ambiguous": {
      const sample = ambiguous?.slice(0, 3).join(", ");
      const extra = ambiguous && ambiguous.length > 3 ? `, +${ambiguous.length - 3} more` : "";
      return `Queue ambiguous${keyPart} — matches ${sample ?? "multiple"}${extra}`;
    }
    case "phone-not-found":
      return "Phone number not found";
    case "queue-and-phone-not-found":
      return suggestion
        ? `Queue + phone not found${keyPart} — queue suggestion: "${suggestion}"`
        : `Queue + phone not found${keyPart}`;
  }
}
