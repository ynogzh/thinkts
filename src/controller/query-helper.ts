/** Convert frontend-style query operators ($gt, $gte, etc.) to Think-model format. */
const OP_MAP: Record<string, string> = {
  $eq: "EQ",
  $ne: "NEQ",
  $gt: "GT",
  $gte: "EGT",
  $lt: "LT",
  $lte: "ELT",
  $like: "LIKE",
  $in: "IN",
  $nin: "NOTIN",
  $notlike: "NOTLIKE",
  $ilike: "ILIKE",
  $notilike: "NOTILIKE",
};

export function normalizeWhere(where: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(where)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const obj: Record<string, unknown> = {};
      for (const [op, v] of Object.entries(val as Record<string, unknown>)) {
        const mapped = OP_MAP[op] ?? op;
        obj[mapped] = v;
      }
      result[key] = obj;
    } else {
      result[key] = val;
    }
  }
  return result;
}
