import { useEffect, useState } from "react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import type { SpendDay } from "@/domain/types";

export function SpendingChart({ history }: { history: SpendDay[] }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const total = history.reduce((sum, day) => sum + day.usdc, 0);
  if (history.length === 0 || total === 0) {
    return <p className="text-sm text-muted-foreground">No spending in the last 7 days.</p>;
  }

  const data = history.map((day) => ({ day: day.label, spent: day.usdc }));

  return (
    <div>
      <p className="mb-1 text-sm text-muted-foreground">
        <span className="tabular-nums text-foreground">{total}</span> Test USDC in the last 7 days.
      </p>
      <BarChart
        animationDuration={reduced ? 0 : 800}
        aspectRatio="3.4 / 1"
        data={data}
        margin={{ top: 12, right: 4, bottom: 28, left: 4 }}
        xDataKey="day"
      >
        <Grid horizontal />
        <Bar dataKey="spent" fill="var(--chart-line-primary)" lineCap={8} />
        <BarXAxis showAllLabels />
        <ChartTooltip
          rows={(point) => [
            {
              color: "var(--chart-line-primary)",
              label: String(point.day),
              value: `${point.spent} Test USDC`,
            },
          ]}
        />
      </BarChart>
      <table className="sr-only">
        <caption>Spending for the last 7 days in Test USDC</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Test USDC</th>
          </tr>
        </thead>
        <tbody>
          {history.map((day) => (
            <tr key={day.label}>
              <td>{day.label}</td>
              <td>{day.usdc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
