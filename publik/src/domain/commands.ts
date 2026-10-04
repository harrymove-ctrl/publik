export type CommandItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  aliases?: string[];
  run: "navigate" | "review";
};

export function filterCommands(query: string, items: CommandItem[]): CommandItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack = [item.label, item.hint ?? "", item.group, ...(item.aliases ?? [])].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
