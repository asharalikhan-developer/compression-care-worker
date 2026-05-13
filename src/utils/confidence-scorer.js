/**
 * Confidence scorer for comparing two OpenAI parse runs of the same document.
 *
 * Score meaning:
 *   1.0  = fields are identical
 *   0.0  = fields are completely different / one is null the other is not
 *   0–1  = partial string similarity via Jaro-Winkler
 *
 * Overall confidence = weighted average of all leaf field scores.
 */

// --- Jaro-Winkler string similarity (no external dep needed) ---
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix bonus (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

function normalizeString(val) {
  if (val === null || val === undefined) return null;
  return String(val).trim().toLowerCase();
}

// Compare two scalar values, returns 0–1
function compareScalar(a, b) {
  const na = normalizeString(a);
  const nb = normalizeString(b);

  if (na === null && nb === null) return 1.0;
  if (na === null || nb === null) return 0.0;
  if (na === nb) return 1.0;

  return jaroWinkler(na, nb);
}

// Compare two flat objects (one level deep), returns { score, fieldScores }
function compareObjects(objA, objB, weights = {}) {
  if (!objA && !objB) return { score: 1.0, fieldScores: {} };
  if (!objA || !objB) return { score: 0.0, fieldScores: {} };

  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const fieldScores = {};
  let totalWeight = 0;
  let weightedSum = 0;

  for (const key of keys) {
    const w = weights[key] ?? 1;
    const score = compareScalar(objA[key], objB[key]);
    fieldScores[key] = score;
    weightedSum += score * w;
    totalWeight += w;
  }

  return {
    score: totalWeight ? weightedSum / totalWeight : 1.0,
    fieldScores,
  };
}

// Compare two line_item arrays by best-match pairing on sku/description
function compareLineItems(arrA, arrB) {
  if (!arrA?.length && !arrB?.length) return 1.0;
  if (!arrA?.length || !arrB?.length) return 0.0;

  // Greedy best-match: for each item in A, find best match in B
  const used = new Set();
  let total = 0;

  for (const itemA of arrA) {
    let best = -1;
    let bestIdx = -1;
    for (let i = 0; i < arrB.length; i++) {
      if (used.has(i)) continue;
      const skuScore = compareScalar(itemA.sku, arrB[i].sku);
      const descScore = compareScalar(itemA.description, arrB[i].description);
      const qtyScore = compareScalar(
        String(itemA.quantity ?? ""),
        String(arrB[i].quantity ?? ""),
      );
      const combined = (skuScore + descScore + qtyScore) / 3;
      if (combined > best) {
        best = combined;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      total += best;
    }
  }

  return total / Math.max(arrA.length, arrB.length);
}

// --- Patient comparison ---
const PATIENT_WEIGHTS = {
  patient_first_name: 3,
  patient_last_name: 3,
  patient_date_of_birth: 3,
  patient_address: 2,
  patient_gender: 2,
  patient_email_address: 2,
  product_ordered: 2,
  source: 0.5,
  extraction_warnings: 0.2,
};

const INSURANCE_WEIGHTS = { id_number: 3, name: 2, group_number: 2 };
const PERSON_WEIGHTS = { first_name: 2, last_name: 2, email_address: 1 };
const PHYSICIAN_WEIGHTS = { first_name: 2, last_name: 2 };

function comparePatient(patA, patB) {
  if (!patA && !patB) return { score: 1.0, breakdown: {} };
  if (!patA || !patB) return { score: 0.0, breakdown: {} };

  const breakdown = {};
  const sections = [];

  // Scalar fields
  const scalars = [
    "patient_first_name",
    "patient_last_name",
    "patient_date_of_birth",
    "patient_address",
    "patient_gender",
    "patient_email_address",
    "product_ordered",
    "source",
  ];
  for (const field of scalars) {
    const s = compareScalar(patA[field], patB[field]);
    breakdown[field] = s;
    sections.push({ score: s, weight: PATIENT_WEIGHTS[field] ?? 1 });
  }

  // Insurance blocks
  for (const ins of ["primary_insurance", "secondary_insurance", "tertiary_insurance"]) {
    const { score, fieldScores } = compareObjects(
      patA[ins],
      patB[ins],
      INSURANCE_WEIGHTS,
    );
    breakdown[ins] = { score, fieldScores };
    sections.push({ score, weight: 2 });
  }

  // Therapist
  const { score: therapistScore, fieldScores: therapistFields } = compareObjects(
    patA.therapist,
    patB.therapist,
    PERSON_WEIGHTS,
  );
  breakdown.therapist = { score: therapistScore, fieldScores: therapistFields };
  sections.push({ score: therapistScore, weight: 2 });

  // Primary care physician
  const { score: pcpScore, fieldScores: pcpFields } = compareObjects(
    patA.primary_care_physician,
    patB.primary_care_physician,
    PHYSICIAN_WEIGHTS,
  );
  breakdown.primary_care_physician = { score: pcpScore, fieldScores: pcpFields };
  sections.push({ score: pcpScore, weight: 2 });

  const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
  const weightedSum = sections.reduce((s, x) => s + x.score * x.weight, 0);

  return {
    score: totalWeight ? weightedSum / totalWeight : 1.0,
    breakdown,
  };
}

// --- Shipment comparison (single shipment object) ---
const SHIPMENT_WEIGHTS = {
  tracking_number: 4,
  order_number: 3,
  ship_date: 2,
  shipper: 2,
  referral_status: 2,
  source: 0.5,
  extraction_warnings: 0.2,
};

function compareShipment(sA, sB) {
  if (!sA && !sB) return { score: 1.0, breakdown: {} };
  if (!sA || !sB) return { score: 0.0, breakdown: {} };

  const breakdown = {};
  const sections = [];

  const scalars = [
    "tracking_number",
    "order_number",
    "ship_date",
    "shipper",
    "referral_status",
    "source",
  ];
  for (const field of scalars) {
    const s = compareScalar(sA[field], sB[field]);
    breakdown[field] = s;
    sections.push({ score: s, weight: SHIPMENT_WEIGHTS[field] ?? 1 });
  }

  // Line items
  const lineScore = compareLineItems(sA.line_items, sB.line_items);
  breakdown.line_items = lineScore;
  sections.push({ score: lineScore, weight: 3 });

  const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
  const weightedSum = sections.reduce((s, x) => s + x.score * x.weight, 0);

  return {
    score: totalWeight ? weightedSum / totalWeight : 1.0,
    breakdown,
  };
}

// Match shipments from two runs by tracking_number, then order_number
function matchShipments(shipmentsA, shipmentsB) {
  const used = new Set();
  const pairs = [];

  for (const sA of shipmentsA) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < shipmentsB.length; i++) {
      if (used.has(i)) continue;
      const tnScore = compareScalar(sA.tracking_number, shipmentsB[i].tracking_number);
      const onScore = compareScalar(sA.order_number, shipmentsB[i].order_number);
      const combined = Math.max(tnScore, onScore);
      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      pairs.push([sA, shipmentsB[bestIdx]]);
    } else {
      pairs.push([sA, null]);
    }
  }

  // Unmatched from B
  for (let i = 0; i < shipmentsB.length; i++) {
    if (!used.has(i)) pairs.push([null, shipmentsB[i]]);
  }

  return pairs;
}

/**
 * Main entry point.
 * Compares two full OpenAI parse results (runA, runB) for the same document.
 *
 * Returns:
 * {
 *   confidenceScore: 0–1,
 *   label: "Very Stable" | "Minor Differences" | "Moderate Drift" | "High Variance",
 *   type: "not_relevant" | "patient" | "shipment" | "type_mismatch",
 *   breakdown: { ... field-level scores ... }
 * }
 */
export function compareRuns(runA, runB) {
  // Type mismatch
  if (runA.type !== runB.type) {
    return {
      confidenceScore: 0.0,
      label: "High Variance",
      type: "type_mismatch",
      detail: `Run A classified as '${runA.type}', Run B as '${runB.type}'`,
      breakdown: {},
    };
  }

  const type = runA.type;

  if (type === "not_relevant") {
    return {
      confidenceScore: 1.0,
      label: "Very Stable",
      type,
      breakdown: { reason: compareScalar(runA.reason, runB.reason) },
    };
  }

  if (type === "patient") {
    const { score, breakdown } = comparePatient(runA.patient, runB.patient);
    return {
      confidenceScore: parseFloat(score.toFixed(4)),
      label: scoreLabel(score),
      type,
      breakdown,
    };
  }

  if (type === "shipment") {
    const shipmentsA = runA.shipments ?? [];
    const shipmentsB = runB.shipments ?? [];
    const pairs = matchShipments(shipmentsA, shipmentsB);

    const pairResults = pairs.map(([sA, sB]) => compareShipment(sA, sB));
    const avg =
      pairResults.length
        ? pairResults.reduce((s, r) => s + r.score, 0) / pairResults.length
        : 1.0;

    return {
      confidenceScore: parseFloat(avg.toFixed(4)),
      label: scoreLabel(avg),
      type,
      breakdown: pairResults.map((r, i) => ({
        shipment: i + 1,
        score: parseFloat(r.score.toFixed(4)),
        fields: r.breakdown,
      })),
    };
  }

  return { confidenceScore: 0.0, label: "Unknown", type, breakdown: {} };
}

function scoreLabel(score) {
  if (score >= 0.95) return "Very Stable";
  if (score >= 0.80) return "Minor Differences";
  if (score >= 0.60) return "Moderate Drift";
  return "High Variance";
}
