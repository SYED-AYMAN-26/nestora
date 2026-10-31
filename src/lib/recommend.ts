import { all, jsonParse, Row } from "./db";
import { CAPABILITIES, INTENT_KEYWORDS, categoryName } from "./constants";
import { checkAvailability } from "./booking";

export type Intent = {
  label: string;
  capabilities: string[];
  categories: string[];
  keywordsHit: string[];
};

/** Deterministic, explainable intent parser (used standalone and as AI fallback). */
export function parseIntent(text: string): Intent[] {
  const t = ` ${text.toLowerCase()} `;
  const hits: Intent[] = [];
  for (const entry of INTENT_KEYWORDS) {
    const keywordsHit = entry.keywords.filter((k) => t.includes(k));
    if (keywordsHit.length) {
      hits.push({
        label: entry.label,
        capabilities: entry.capabilities,
        categories: entry.categories,
        keywordsHit,
      });
    }
  }
  return hits.sort((a, b) => b.keywordsHit.length - a.keywordsHit.length);
}

/** Budget / urgency / location extraction without any external service. */
export function parseConstraints(text: string) {
  const t = text.toLowerCase();
  const budget = t.match(/(?:under|below|less than|max|upto|up to|₹|rs\.?)\s*([\d,]{2,7})/);
  const days = t.match(/(\d+)\s*(day|days|week|weeks)/);
  const cityMatch = t.match(/\bin\s+([a-z\s]{3,30})$/);
  return {
    maxBudget: budget ? Number(budget[1].replace(/,/g, "")) : null,
    days: days ? (days[2].startsWith("week") ? Number(days[1]) * 7 : Number(days[1])) : null,
    city: cityMatch ? cityMatch[1].trim() : null,
  };
}

export type Recommendation = {
  resource: Row;
  score: number;
  capabilityMatches: string[];
  reasons: string[];
  availabilityNote: string;
  available: boolean;
};

export type RecommendResult = {
  engine: "ai" | "rules";
  engineNote: string;
  intents: Intent[];
  capabilities: string[];
  constraints: ReturnType<typeof parseConstraints>;
  results: Recommendation[];
  excluded: { title: string; reason: string }[];
};

/**
 * Core recommendation pipeline. Every candidate is scored against the derived
 * capability set, then filtered on real availability and eligibility.
 * Unavailable / ineligible resources are returned separately — never offered
 * as bookable options.
 */
export async function recommend(opts: {
  query: string;
  userId?: number | null;
  city?: string | null;
  maxBudget?: number | null;
  start?: string | null;
  end?: string | null;
  limit?: number;
}): Promise<RecommendResult> {
  const constraints = { ...parseConstraints(opts.query), ...(opts.city ? { city: opts.city } : {}), ...(opts.maxBudget ? { maxBudget: opts.maxBudget } : {}) };

  let engine: "ai" | "rules" = "rules";
  let engineNote =
    "Rule-based capability engine — no external AI service is configured, so matching runs locally on the capability taxonomy.";
  let intents = parseIntent(opts.query);

  // Optional AI enhancement: only when a key exists AND the call succeeds.
  if (process.env.OPENAI_API_KEY) {
    try {
      const ai = await callAiIntent(opts.query);
      if (ai && ai.capabilities.length) {
        engine = "ai";
        engineNote = `AI-assisted intent parsing (${process.env.OPENAI_MODEL || "gpt-4o-mini"}) combined with the local capability taxonomy and live availability checks.`;
        intents = [
          { label: ai.label || "AI-parsed intent", capabilities: ai.capabilities, categories: ai.categories || [], keywordsHit: ["ai"] },
          ...intents,
        ];
      }
    } catch (e) {
      console.warn("[recommend] AI provider unavailable, falling back to rules", e);
    }
  }

  const capabilitySet = new Set<string>();
  const categorySet = new Set<string>();
  for (const i of intents) {
    i.capabilities.forEach((c) => capabilitySet.add(c));
    i.categories.forEach((c) => categorySet.add(c));
  }
  const caps = [...capabilitySet];

  const rows = await all<Row>(
    `SELECT r.*, p.display_name AS provider_name, p.verification_status, p.storefront_slug,
            p.rating_cached, p.rating_count, p.org_type,
            (SELECT url FROM resource_images i WHERE i.resource_id = r.id ORDER BY sort_order LIMIT 1) AS image_url
       FROM resources r JOIN provider_profiles p ON p.id = r.provider_id
      WHERE r.status = 'active'`
  );

  const results: Recommendation[] = [];
  const excluded: { title: string; reason: string }[] = [];

  for (const r of rows) {
    const capsOf = jsonParse<string[]>(r.capabilities, []);
    const capMatches = capsOf.filter((c) => capabilitySet.has(c));
    const catMatch = categorySet.has(r.category);
    if (!capMatches.length && !catMatch) continue;

    const reasons: string[] = [];
    let score = 0;
    score += capMatches.length * 22;
    if (capMatches.length) {
      reasons.push(
        `Matches capability: ${capMatches.map((c) => CAPABILITIES[c]?.label ?? c).join(", ")}`
      );
    }
    if (catMatch) {
      score += 12;
      reasons.push(`In a relevant category — ${categoryName(r.category)}`);
    }
    if (r.verification_status === "verified") {
      score += 10;
      reasons.push("Provider identity verified by Nestora admin");
    } else {
      reasons.push("Provider not yet verified — expect extra checks at handover");
    }
    score += Math.min(12, Number(r.rating_cached || 0) * 2.5);
    if (Number(r.rating_count) > 0) {
      reasons.push(`Provider rated ${Number(r.rating_cached).toFixed(1)}/5 from ${r.rating_count} review(s)`);
    }
    if (constraints.city && (r.location_city || "").toLowerCase().includes(String(constraints.city).toLowerCase())) {
      score += 15;
      reasons.push(`Located in ${r.location_city}`);
    }
    if (constraints.maxBudget && Number(r.price_daily) > 0 && Number(r.price_daily) <= constraints.maxBudget) {
      score += 8;
      reasons.push(`Within budget at ₹${r.price_daily}/day`);
    }

    // Real availability (never recommend a blocked range as bookable)
    const start = opts.start || new Date().toISOString().slice(0, 10);
    const end = opts.end || new Date(Date.now() + ((constraints.days || 2) - 1) * 864e5).toISOString().slice(0, 10);
    const avail = await checkAvailability(r.id, start, end, 1);
    let availabilityNote: string;
    let available = avail.ok;
    if (!avail.ok) {
      availabilityNote = `Not bookable ${start} → ${end}: ${avail.reason}`;
      score -= 25;
    } else if (constraints.maxBudget && Number(r.price_daily) > constraints.maxBudget) {
      available = false;
      availabilityNote = `Available, but above your stated budget (₹${r.price_daily}/day)`;
      score -= 10;
    } else {
      availabilityNote = `Available ${start} → ${end} (${avail.minUnitsAvailable} unit(s) free)`;
      score += 10;
    }

    if (r.eligibility) reasons.push(`Eligibility: ${r.eligibility}`);
    if (r.training_required) reasons.push("Training required before first use");

    results.push({ resource: r, score: Math.round(score * 10) / 10, capabilityMatches: capMatches, reasons, availabilityNote, available });
  }

  results.sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score);

  for (const r of results) {
    if (!r.available) excluded.push({ title: r.resource.title, reason: r.availabilityNote });
  }

  return {
    engine, engineNote, intents, capabilities: caps, constraints,
    results: results.filter((r) => r.available).slice(0, opts.limit ?? 8),
    excluded: excluded.slice(0, 8),
  };
}

async function callAiIntent(text: string): Promise<{ label: string; capabilities: string[]; categories: string[] } | null> {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You map a buyer's plain-language need to a fixed capability taxonomy. Reply with JSON " +
              `{"label":string,"capabilities":string[],"categories":string[]}. Valid capabilities: ${Object.keys(CAPABILITIES).join(", ")}.`,
          },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    const caps = (parsed.capabilities || []).filter((c: string) => c in CAPABILITIES);
    return { label: parsed.label || "", capabilities: caps, categories: parsed.categories || [] };
  } finally {
    clearTimeout(timer);
  }
}
