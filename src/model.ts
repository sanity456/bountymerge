export type Page<T> = { items: T[]; total: number; next_offset: number };
export type Project = { id: string; name: string; description: string; owner: string; created_at: string };
export type Request = { id: string; project_id: string; title: string; details: string; requirements: string[]; exclusions: string[]; author: string; created_at: string; merged_into: string };
export type Result = { status: "MERGEABLE" | "SEPARATE" | "UNCLEAR"; reason: string; brief_lines: string[]; coverage_a: number[]; coverage_b: number[] };
export type Comparison = { id: string; project_id: string; request_a_id: string; request_b_id: string; author_a: string; author_b: string; result: Result; state: "AWAITING_APPROVAL" | "MERGED" | "CLOSED" | "REJECTED"; approved_a: boolean; approved_b: boolean; created_at: string };
export type Action = { method: string; args: (string | boolean)[]; label: string; description: string };

export const isWalletAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
export const shortAddress = (value: string) => value.length === 42 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
export const cleanLines = (value: string, max: number) => value.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, max + 1);
export const uniqueLines = (lines: string[]) => new Set(lines.map(x => x.toLowerCase())).size === lines.length;
export const selectedDistinctPair = (a: string, b: string) => Boolean(a && b && a !== b);

export function validateRequest(title: string, details: string, requirements: string[], exclusions: string[]) {
  if (!title.trim() || title.length > 120) return "Give this request a title under 120 characters.";
  if (!details.trim() || details.length > 800) return "Describe the feature in 800 characters or fewer.";
  if (!requirements.length || requirements.length > 4 || requirements.some(x => x.length > 240) || !uniqueLines(requirements)) return "Add 1–4 distinct requirements, one per line.";
  if (exclusions.length > 3 || exclusions.some(x => x.length > 240) || !uniqueLines(exclusions)) return "Use no more than 3 distinct exclusions.";
  return "";
}
