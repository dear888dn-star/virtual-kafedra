/** Model javobidan JSON'ni ajratadi: ``` belgilari va atrofdagi matnni olib tashlaydi. */
export function extractJson(s: string): string {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}
