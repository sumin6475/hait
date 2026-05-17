import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { conditionLabel } from "@/lib/mockData";

const decisionData = [
  { condition: "C1", accuracy: 80 },
  { condition: "C2", accuracy: 100 },
  { condition: "C3", accuracy: 60 },
  { condition: "C4", accuracy: 40 },
  { condition: "CTRL", accuracy: 20 },
];

const poolingData = [
  { condition: "C1", rate: 72 },
  { condition: "C2", rate: 85 },
  { condition: "C3", rate: 58 },
  { condition: "C4", rate: 65 },
  { condition: "CTRL", rate: 35 },
];

const durationData = [
  { condition: "C1", minutes: 20 },
  { condition: "C2", minutes: 17 },
  { condition: "C3", minutes: 19 },
  { condition: "C4", minutes: 18 },
  { condition: "CTRL", minutes: 16 },
];

const trustData = [
  { condition: "C1", competence: 3.7, benevolence: 3.5, integrity: 3.5 },
  { condition: "C2", competence: 4.7, benevolence: 3.5, integrity: 4.5 },
  { condition: "C3", competence: 3.2, benevolence: 3.8, integrity: 3.3 },
  { condition: "C4", competence: 3.8, benevolence: 3.2, integrity: 3.6 },
];

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl bg-card p-6 shadow-card space-y-4">
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="h-64">{children}</div>
  </div>
);

const Analytics = () => (
  <div className="p-8 space-y-6">
    <h1 className="text-2xl font-semibold">Analytics</h1>
    <p className="text-sm text-muted-foreground">
      Key metrics across experiment conditions (mock data)
    </p>

    <div className="grid grid-cols-2 gap-6">
      <ChartCard title="Decision Accuracy (% choosing Candidate C)">
        <ResponsiveContainer>
          <BarChart data={decisionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="condition" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Information Pooling Rate (%)">
        <ResponsiveContainer>
          <BarChart data={poolingData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="condition" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
            <Tooltip />
            <Bar dataKey="rate" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Average Session Duration (minutes)">
        <ResponsiveContainer>
          <BarChart data={durationData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="condition" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, 25]} />
            <Tooltip />
            <Bar dataKey="minutes" fill="hsl(var(--status-info))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Trust Scores by Condition (1-5 Likert)">
        <ResponsiveContainer>
          <BarChart data={trustData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="condition" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[1, 5]} />
            <Tooltip />
            <Legend />
            <Bar dataKey="competence" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="benevolence" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="integrity" fill="hsl(var(--status-success))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  </div>
);

export default Analytics;
