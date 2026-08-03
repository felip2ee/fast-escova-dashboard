import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "@/lib/dashboard-types";

const axis = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};
const tooltipStyle = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    fontSize: "12px",
    color: "var(--color-popover-foreground)",
  },
  labelStyle: { color: "var(--color-muted-foreground)" },
};

export function MessagesChart({ data }: { data: DashboardData["messagesByDay"] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="dia" {...axis} />
        <YAxis {...axis} />
        <Tooltip {...tooltipStyle} />
        <Area
          type="monotone"
          dataKey="enviadas"
          name="Disparadas"
          stroke="var(--color-chart-1)"
          fill="var(--color-chart-1)"
          fillOpacity={0.22}
        />
        <Area
          type="monotone"
          dataKey="recebidas"
          name="Recebidas"
          stroke="var(--color-chart-3)"
          fill="var(--color-chart-3)"
          fillOpacity={0.16}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ResponseTimeChart({ data }: { data: DashboardData["responseTimeByDay"] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="dia" {...axis} />
        <YAxis {...axis} unit="m" />
        <Tooltip {...tooltipStyle} />
        <Line
          type="monotone"
          dataKey="primeira"
          name="1ª resposta"
          stroke="var(--color-chart-1)"
          strokeWidth={2.5}
        />
        <Line
          type="monotone"
          dataKey="media"
          name="Resposta média"
          stroke="var(--color-chart-2)"
          strokeWidth={2.5}
          strokeDasharray="5 4"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DeliveryChart({ data }: { data: DashboardData["deliveryBreakdown"] }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie
            data={data}
            dataKey="valor"
            nameKey="nome"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={3}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.nome} fill={d.cor} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="w-full space-y-2">
        {data.map((d) => (
          <li key={d.nome} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: d.cor }} />
            <span className="flex-1 text-muted-foreground">{d.nome}</span>
            <strong>{d.valor.toLocaleString("pt-BR")}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
