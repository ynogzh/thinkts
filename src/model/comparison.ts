export const COMPARISON: Record<string, string> = {
  EQ: "=",
  NEQ: "!=",
  "<>": "!=",
  GT: ">",
  EGT: ">=",
  LT: "<",
  ELT: "<=",
  NOTLIKE: "NOT LIKE",
  LIKE: "LIKE",
  NOTILIKE: "NOT ILIKE",
  ILIKE: "ILIKE",
  IN: "IN",
  NOTIN: "NOT IN",
};

const allowKeys = ["EXP", "BETWEEN", "NOT BETWEEN"];
const keys = Object.keys(COMPARISON);
export const COMPARISON_LIST = keys.concat(keys.map((k) => COMPARISON[k])).concat(allowKeys);

export function getComparison(comparison: string): string {
  let upper = comparison.toUpperCase();
  upper = COMPARISON[upper] ?? upper;
  if (COMPARISON_LIST.includes(upper)) return upper;
  throw new Error(`${comparison} is not valid`);
}
