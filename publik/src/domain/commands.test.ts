import { describe, expect, test } from "bun:test";
import { filterCommands, type CommandItem } from "./commands";

const items: CommandItem[] = [
  { id: "rules", group: "Actions", label: "Edit rules", aliases: ["budget", "limits"], run: "review" },
  { id: "overview", group: "Navigate", label: "Overview", run: "navigate" },
];

describe("command search", () => {
  test("budget finds the rules action and does not execute it", () => {
    const found = filterCommands("budget", items);
    expect(found.map((item) => item.id)).toEqual(["rules"]);
    expect(found[0]?.run).toBe("review");
  });
});
