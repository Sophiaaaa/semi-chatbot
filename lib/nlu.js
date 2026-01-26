function normalizeLooseToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function containsAsciiToken(text, token) {
  const t = String(text || "");
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return re.test(t);
}

function buildCanonicalMapFromConfig(metricsConfig, filterDimension) {
  const dim = metricsConfig.filterDimensions.find((d) => d.id === filterDimension);
  if (!dim) return new Map();
  const map = new Map();
  for (const v of dim.values || []) {
    map.set(normalizeLooseToken(v.id), v.id);
    map.set(normalizeLooseToken(v.label), v.id);
  }
  return map;
}

function canonicalizeFilterValues(metricsConfig, filterDimension, rawValues) {
  if (!filterDimension) return [];
  const map = buildCanonicalMapFromConfig(metricsConfig, filterDimension);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawValues) ? rawValues : []) {
    const key = normalizeLooseToken(raw);
    const canonical = map.get(key);
    if (!canonical) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function extractFiltersFromText(metricsConfig, text) {
  const normalized = String(text || "");
  const normalizedLoose = normalizeLooseToken(normalized);

  const products = [];
  if (containsAsciiToken(normalized, "ct")) products.push("CT");
  if (containsAsciiToken(normalized, "sps")) products.push("SPS");
  if (containsAsciiToken(normalized, "es")) products.push("ES");
  if (containsAsciiToken(normalized, "3di")) products.push("3DI");
  if (containsAsciiToken(normalized, "certas")) products.push("CERTAS");

  const orgs = [];
  const isNonPsm =
    normalizedLoose.includes("非psm") ||
    normalizedLoose.includes("nonpsm") ||
    normalizedLoose.includes("notpsm");
  if (isNonPsm) {
    orgs.push("非PSM");
  } else if (containsAsciiToken(normalized, "psm")) {
    orgs.push("PSM");
  }

  if (products.length > 0) {
    return {
      filterDimension: "product",
      filterValues: canonicalizeFilterValues(metricsConfig, "product", products),
    };
  }
  if (orgs.length > 0) {
    return {
      filterDimension: "org",
      filterValues: canonicalizeFilterValues(metricsConfig, "org", orgs),
    };
  }
  return null;
}

module.exports = {
  canonicalizeFilterValues,
  extractFiltersFromText,
};
