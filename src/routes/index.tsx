import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  DollarSign,
  Eye,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { ChartCard } from "@/components/dashboard/ChartCard";
import {
  DeliveryChart,
  DispatchesChart,
  MessagesChart,
  ResponseTimeChart,
} from "@/components/dashboard/Charts";
import { CampaignTable } from "@/components/dashboard/CampaignTable";
import type { DashboardData, DashboardPeriod } from "@/lib/dashboard-types";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Métricas de campanhas e atendimento | Fast Escova" },
      { name: "description", content: "Disparos, oportunidades e atendimento da Fast Escova." },
    ],
  }),
});

const nf = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const min = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} min`);
const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
const today = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
};

function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>("thisMonth");
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [appliedFilter, setAppliedFilter] = useState({
    period: "thisMonth" as DashboardPeriod,
    startDate: "",
    endDate: "",
  });
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setError("");
    setLoading(true);
    const params = new URLSearchParams({ period: appliedFilter.period });
    if (appliedFilter.period === "custom") {
      params.set("start", appliedFilter.startDate);
      params.set("end", appliedFilter.endDate);
    }
    fetch(`/api/dashboard?${params}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      })
      .then(setData)
      .catch((e) =>
        setError(
          e instanceof DOMException && e.name === "AbortError"
            ? "A consulta excedeu 25 segundos."
            : e.message,
        ),
      )
      .finally(() => {
        window.clearTimeout(timeout);
        setLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [appliedFilter]);
  if (error)
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <h1 className="text-xl font-semibold">Dashboard sem conexão com o banco</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {error} Confira <code>.env</code> e <code>DATABASE_URL</code>.
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Consultando o Postgres…
      </main>
    );
  const o = data.overview;
  const a = data.atendimento;
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="rounded-xl bg-foreground px-3 py-2">
              <img src="/favicon.svg" alt="Fast Escova" className="h-8" />
            </span>
            <div>
              <h1 className="text-sm font-semibold">Painel de Campanhas e Atendimento</h1>
              <p className="text-xs text-muted-foreground">
                Oportunidades, conversão e operação das atendentes
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative flex items-center rounded-xl border bg-background shadow-sm">
              <CalendarDays className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
              <select
                aria-label="Período do dashboard"
                value={period}
                onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
                className="cursor-pointer appearance-none bg-transparent py-2 pl-9 pr-8 text-xs font-semibold text-foreground outline-none [color-scheme:light]"
              >
                <option className="bg-background text-foreground" value="today">
                  Hoje
                </option>
                <option className="bg-background text-foreground" value="yesterday">
                  Ontem
                </option>
                <option className="bg-background text-foreground" value="thisMonth">
                  Este mês
                </option>
                <option className="bg-background text-foreground" value="lastMonth">
                  Mês passado
                </option>
                <option className="bg-background text-foreground" value="custom">
                  Escolher datas
                </option>
              </select>
              <span className="pointer-events-none absolute right-3 text-[10px] text-muted-foreground">
                ▾
              </span>
            </div>
            {period === "custom" && (
              <div className="flex items-center gap-2 rounded-xl border bg-background px-2 py-1">
                <input
                  aria-label="Data inicial"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="bg-transparent text-xs outline-none"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <input
                  aria-label="Data final"
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={today()}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="bg-transparent text-xs outline-none"
                />
              </div>
            )}
            <button
              type="button"
              disabled={loading || (period === "custom" && (!startDate || !endDate))}
              onClick={() => setAppliedFilter({ period, startDate, endDate })}
              className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar dados
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-10 px-5 py-8">
        <section className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Disparos
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Performance das campanhas</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Mensagens disparadas"
              value={nf(o.enviadas)}
              hint={`${nf(o.entregues)} entregues`}
              icon={Send}
              accent
            />
            <StatCard
              label="Custo estimado"
              value={money(o.custoEstimado)}
              hint="US$ 0,04 por disparo"
              icon={DollarSign}
            />
            <StatCard
              label="Oportunidades geradas"
              value={nf(o.conversas)}
              hint="Resposta do mesmo número em até 48 horas"
              icon={Users}
            />
            <StatCard
              label="Conversão"
              value={`${o.ctr.toFixed(1)}%`}
              hint="Mensagem → oportunidade"
              icon={TrendingUp}
            />
            <StatCard
              label="Custo por oportunidade"
              value={o.custoPorOportunidade == null ? "—" : money(o.custoPorOportunidade)}
              hint="Custo estimado ÷ oportunidades"
              icon={DollarSign}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard
                title="Disparos por dia"
                subtitle="Mensagens disparadas e oportunidades geradas"
              >
                <DispatchesChart data={data.dispatchesByDay} />
              </ChartCard>
            </div>
            <ChartCard title="Status de entrega" subtitle="Período selecionado">
              <DeliveryChart data={data.deliveryBreakdown} />
            </ChartCard>
          </div>
          <ChartCard
            title="Disparos por campanha"
            subtitle="Nome da campanha, quantidade disparada e conversão em oportunidades"
          >
            <CampaignTable campaigns={data.campaigns} />
          </ChartCard>
        </section>

        <section className="space-y-5 border-t border-border/70 pt-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Atendimento
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Conversas das atendentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Somente mensagens de conversa; automações não entram como envio de atendente.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Mensagens de atendimento"
              subtitle="Enviadas pelas atendentes e recebidas dos clientes"
            >
              <MessagesChart data={data.messagesByDay} />
            </ChartCard>
            <ChartCard
              title="Tempos de resposta"
              subtitle="Resposta média e primeira resposta por conversa/dia"
            >
              <ResponseTimeChart data={data.responseTimeByDay} />
            </ChartCard>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Total de conversas"
              value={nf(a.totalConversas)}
              hint="Conversas únicas no período"
              icon={MessageCircle}
              accent
            />
            <StatCard
              label="Conversas por dia"
              value={nf(a.mediaConversasDia)}
              hint="Média no período"
              icon={Users}
            />
            <StatCard
              label="Mensagens enviadas por dia"
              value={nf(a.mediaEnviadasDia)}
              hint="Média das atendentes"
              icon={Send}
            />
            <StatCard
              label="Mensagens recebidas por dia"
              value={nf(a.mediaRecebidasDia)}
              hint="Média dos clientes"
              icon={MessageSquare}
            />
            <StatCard
              label="Tempo médio de resposta"
              value={min(a.tempoRespostaMedioMin)}
              hint="Próxima resposta da atendente"
              icon={Timer}
            />
            <StatCard
              label="1ª resposta média/dia"
              value={min(a.primeiraRespostaMediaMin)}
              hint="Primeira entrada por conversa/dia"
              icon={Eye}
            />
          </div>
        </section>
        <footer className="text-center text-xs text-muted-foreground">
          Fast Escova · Postgres · atualizado em{" "}
          {new Date(data.atualizadoEm).toLocaleString("pt-BR")}
        </footer>
      </main>
    </div>
  );
}
