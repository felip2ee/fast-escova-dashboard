import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
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
import { AgentTable } from "@/components/dashboard/AgentTable";
import { CampaignTable } from "@/components/dashboard/CampaignTable";
import { ChartCard } from "@/components/dashboard/ChartCard";
import {
  DeliveryChart,
  DispatchesChart,
  MessagesChart,
  ResponseTimeChart,
} from "@/components/dashboard/Charts";
import { StatCard } from "@/components/dashboard/StatCard";
import { SyncStatus } from "@/components/dashboard/SyncStatus";
import type { DashboardData, DashboardPeriod } from "@/lib/dashboard-types";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Métricas de campanhas e atendimento | Fast Escova" },
      {
        name: "description",
        content: "Resultados de campanhas e atendimento da Fast Escova.",
      },
    ],
  }),
});

const nf = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const decimal = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const min = (value: number | null) => (value == null ? "—" : `${decimal(value)} min`);
const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
const today = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
};

function Dashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>("30d");
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [appliedFilter, setAppliedFilter] = useState({
    period: "30d" as DashboardPeriod,
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
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error);
        return response.json();
      })
      .then(setData)
      .catch((caught) =>
        setError(
          caught instanceof DOMException && caught.name === "AbortError"
            ? "A consulta excedeu 25 segundos."
            : caught.message,
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
        <h1 className="text-xl font-semibold">Não foi possível carregar o dashboard</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
      </main>
    );
  if (!data)
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Atualizando os dados…
      </main>
    );

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
                Resultados dos disparos e trabalho da equipe
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
                <option value="30d">Últimos 30 dias</option>
                <option value="today">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="thisMonth">Este mês</option>
                <option value="lastMonth">Mês passado</option>
                <option value="custom">Escolher datas</option>
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
      <DashboardReport data={data} />
    </div>
  );
}

export function DashboardReport({ data }: { data: DashboardData }) {
  const overview = data.overview;
  const service = data.atendimento;

  return (
    <main className="mx-auto max-w-7xl space-y-10 px-5 py-8">
      <SyncStatus sync={data.sync} />

      <section className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Campanhas
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Resumo do período</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Do envio até a resposta recebida em até 48 horas.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Mensagens enviadas" value={nf(overview.enviadas)} icon={Send} accent />
          <StatCard
            label="Mensagens entregues"
            value={nf(overview.entregues)}
            hint={`${decimal(overview.taxaEntrega)}% das enviadas`}
            icon={CheckCircle2}
          />
          <StatCard
            label="Mensagens lidas"
            value={nf(overview.lidas)}
            hint={`${decimal(overview.taxaLeitura)}% das entregues`}
            icon={Eye}
          />
          <StatCard
            label="Pessoas que responderam"
            value={nf(overview.respondidas)}
            hint="Primeira resposta em até 48 horas"
            icon={Users}
          />
          <StatCard
            label="Falhas confirmadas"
            value={nf(overview.falhas)}
            hint="Separadas de pendências"
            icon={AlertCircle}
          />
          <StatCard
            label="Taxa de resposta"
            value={`${decimal(overview.taxaResposta)}%`}
            hint="Respostas ÷ entregues"
            icon={TrendingUp}
          />
          <StatCard
            label="Custo estimado"
            value={money(overview.custoEstimado)}
            hint="US$ 0,04 por mensagem enviada"
            icon={DollarSign}
          />
          <StatCard
            label="Custo por resposta"
            value={overview.custoPorResposta == null ? "—" : money(overview.custoPorResposta)}
            hint="Custo estimado ÷ pessoas que responderam"
            icon={DollarSign}
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard title="Evolução do funil" subtitle="Envios, entregas, leituras e respostas">
              <DispatchesChart data={data.dispatchesByDay} />
            </ChartCard>
          </div>
          <ChartCard title="Status de entrega" subtitle="Período selecionado">
            <DeliveryChart data={data.deliveryBreakdown} />
          </ChartCard>
        </div>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Campanhas
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Resultado das campanhas</h2>
        </div>
        <ChartCard
          title="Comparativo por campanha"
          subtitle="Volumes e taxas calculados para cada campanha"
        >
          <CampaignTable campaigns={data.campaigns} />
        </ChartCard>
        <details className="surface-card p-5">
          <summary className="cursor-pointer text-sm font-semibold">Detalhes operacionais</summary>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <p className="rounded-xl bg-secondary p-3">
              <span className="block text-xs text-muted-foreground">Aguardando confirmação</span>
              <strong className="text-lg">{nf(overview.pendentes)}</strong>
            </p>
            <p className="rounded-xl bg-secondary p-3">
              <span className="block text-xs text-muted-foreground">Resultados incertos</span>
              <strong className="text-lg">{nf(overview.resultadosIncertos)}</strong>
            </p>
          </div>
        </details>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Atendimento
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Atendimento geral da equipe</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Somente mensagens públicas enviadas por pessoas da equipe.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Conversas atendidas"
            value={nf(service.totalConversas)}
            hint="Conversas distintas no período"
            icon={MessageCircle}
            accent
          />
          <StatCard
            label="Mensagens recebidas"
            value={nf(service.mensagensRecebidas)}
            hint="Enviadas pelos clientes"
            icon={MessageSquare}
          />
          <StatCard
            label="Respostas humanas"
            value={nf(service.respostasHumanas)}
            hint="Enviadas pela equipe"
            icon={Send}
          />
          <StatCard
            label="Primeira resposta média"
            value={min(service.primeiraRespostaMediaMin)}
            hint="Em horário útil"
            icon={Eye}
          />
          <StatCard
            label="Tempo médio para responder"
            value={min(service.tempoRespostaMedioMin)}
            hint="Em horário útil"
            icon={Timer}
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="Mensagens de atendimento"
            subtitle="Clientes e equipe ao longo do período"
          >
            <MessagesChart data={data.messagesByDay} />
          </ChartCard>
          <ChartCard
            title="Tempos de resposta"
            subtitle="Primeira resposta e média em minutos úteis"
          >
            <ResponseTimeChart data={data.responseTimeByDay} />
          </ChartCard>
        </div>
      </section>

      <section className="space-y-5 border-t border-border/70 pt-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Equipe</p>
          <h2 className="mt-1 text-2xl font-semibold">Desempenho por atendente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada mensagem é atribuída a quem realmente a enviou.
          </p>
        </div>
        <ChartCard
          title="Participação no atendimento"
          subtitle="Conversas, mensagens e tempo de resposta"
        >
          <AgentTable agents={data.agents} />
        </ChartCard>
      </section>

      <footer className="text-center text-xs text-muted-foreground">
        Fast Escova · relatório atualizado sob demanda
      </footer>
    </main>
  );
}
