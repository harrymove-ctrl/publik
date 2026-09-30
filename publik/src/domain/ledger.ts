import Decimal from "decimal.js";
import type { SpendRequest } from "./policy";
import type { Agent, SpendDay } from "./types";

/** Fixed demo "today" so the week does not jump on every reload. Wednesday. */
export const DEMO_TODAY = "2026-09-30T12:00:00.000Z";
const LEGACY_SHIFT_MS = 175 * 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function shiftLegacyDemoDate(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time) || time >= Date.parse("2026-09-01T00:00:00.000Z")) return iso;
  return new Date(time + LEGACY_SHIFT_MS).toISOString();
}

export function weekEnding(todayIso = DEMO_TODAY): { label: string; day: string }[] {
  const end = new Date(todayIso);
  const days: { label: string; day: string }[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    days.push({ label: WEEKDAYS[date.getUTCDay()] ?? "Day", day: date.toISOString().slice(0, 10) });
  }
  return days;
}

export function spendHistoryFromRequests(requests: SpendRequest[], todayIso = DEMO_TODAY): SpendDay[] {
  return weekEnding(todayIso).map((bucket) => ({
    label: bucket.label,
    usdc: requests
      .filter((item) => completedUsdcOn(item, bucket.day))
      .reduce((sum, item) => sum + Number(new Decimal(item.amountBase).div(1_000_000).toFixed(2)), 0),
  }));
}

export function spentTodayFromRequests(requests: SpendRequest[], todayIso = DEMO_TODAY): string {
  const day = todayIso.slice(0, 10);
  return requests
    .filter((item) => completedUsdcOn(item, day))
    .reduce((sum, item) => sum.plus(item.amountBase), new Decimal(0))
    .toFixed(0);
}

/** Keeps saved agents, but moves old April demo dates onto this week and rebuilds the chart from completed payments only. */
export function alignDemoAgent(agent: Agent): Agent {
  if (agent.cluster !== "demo") return agent;
  const requests = agent.requests.map((item) => ({ ...item, createdAt: shiftLegacyDemoDate(item.createdAt) }));
  return {
    ...agent,
    createdAt: shiftLegacyDemoDate(agent.createdAt),
    requests,
    spendHistory: spendHistoryFromRequests(requests),
    spentTodayBase: spentTodayFromRequests(requests),
  };
}

function completedUsdcOn(item: SpendRequest, day: string): boolean {
  return item.status === "completed" && item.token === "USDC" && item.createdAt.slice(0, 10) === day;
}
