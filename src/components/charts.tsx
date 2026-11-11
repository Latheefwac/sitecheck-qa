"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }, cursor: { fill: "var(--accent)" } };

export function PassFailDonut({ passed, failed, warnings, notTested }: { passed: number; failed: number; warnings: number; notTested: number }) {
  const data = [
    { name: "Passed", value: passed, color: "var(--pass)" },
    { name: "Failed", value: failed, color: "var(--fail)" },
    { name: "Warnings", value: warnings, color: "var(--warn)" },
    { name: "Not tested", value: notTested, color: "var(--neutral)" },
  ].filter((d) => d.value > 0);
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="var(--card)">
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip {...tooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ScoreBars({ data }: { data: { name: string; value: number | null }[] }) {
  const d = data.map((x) => ({ ...x, value: x.value ?? 0, missing: x.value === null }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={d} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" height={50} />
        <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltip} />
        <Bar dataKey="value" name="Score" radius={[4, 4, 0, 0]}>
          {d.map((x) => <Cell key={x.name} fill={x.missing ? "var(--muted)" : x.value >= 90 ? "var(--pass)" : x.value >= 70 ? "var(--warn)" : "var(--fail)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SeverityBars({ data }: { data: { name: string; value: number }[] }) {
  const colors: Record<string, string> = { Critical: "var(--fail)", High: "color-mix(in oklch, var(--fail) 70%, var(--warn))", Medium: "var(--warn)", Low: "var(--neutral)" };
  if (!data.some((d) => d.value)) return <Empty text="No open issues" />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={60} />
        <Tooltip {...tooltip} />
        <Bar dataKey="value" name="Issues" radius={[0, 4, 4, 0]}>
          {data.map((d) => <Cell key={d.name} fill={colors[d.name]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLines({ data }: { data: { date: string; overall: number; performance?: number | null; accessibility?: number | null; seo?: number | null }[] }) {
  if (data.length < 1) return <Empty text="Run scans to see trends" />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltip} cursor={{ stroke: "var(--border)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="overall" name="Overall" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="performance" name="Performance" stroke="var(--info)" strokeWidth={1.5} dot={false} connectNulls />
        <Line type="monotone" dataKey="accessibility" name="Accessibility" stroke="var(--pass)" strokeWidth={1.5} dot={false} connectNulls />
        <Line type="monotone" dataKey="seo" name="SEO" stroke="var(--warn)" strokeWidth={1.5} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CategoryStack({ data }: { data: { name: string; pass: number; fail: number; warning: number; notTested: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={120} />
        <Tooltip {...tooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="pass" name="Passed" stackId="a" fill="var(--pass)" />
        <Bar dataKey="warning" name="Warnings" stackId="a" fill="var(--warn)" />
        <Bar dataKey="fail" name="Failed" stackId="a" fill="var(--fail)" />
        <Bar dataKey="notTested" name="Not tested" stackId="a" fill="var(--neutral)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const Empty = ({ text = "No data yet" }: { text?: string }) => <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{text}</div>;
