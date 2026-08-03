import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, MessageSquare, Send, Timer, Zap } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { DeliveryChart, MessagesChart, ResponseTimeChart } from "@/components/dashboard/Charts";
import { CampaignTable } from "@/components/dashboard/CampaignTable";
import type { DashboardData } from "@/lib/dashboard-types";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Métricas de campanhas | Fast Escova" },
      {
        name: "description",
        content: "Disparos, leituras, conversas e tempos de resposta da Fast Escova.",
      },
    ],
  }),
});
const nf = (n: number) => n.toLocaleString("pt-BR");
const min = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)} min`);

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <h1 className="text-xl font-semibold">Dashboard sem conexão com o banco</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {error} Confira <code>.env</code> e a variável <code>DATABASE_URL</code>.
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
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="rounded-xl bg-foreground px-3 py-2">
              <img src="/favicon.svg" alt="Fast Escova" className="h-8" />
            </span>
            <div>
              <h1 className="text-sm font-semibold">Painel de Campanhas</h1>
              <p className="text-xs text-muted-foreground">
                Seg–sáb · 08h–20h · janela de atribuição de 24h
              </p>
            </div>
          </div>
          <span className="rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-xs text-success">
            {o.campanhasAtivas} ativa(s)
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Mensagens disparadas"
            value={nf(o.enviadas)}
            hint={`${nf(o.entregues)} entregues`}
            icon={Send}
            accent
          />
          <StatCard
            label="Mensagens lidas"
            value={nf(o.lidas)}
            hint={`${o.entregues ? Math.round((o.lidas / o.entregues) * 100) : 0}% das entregues`}
            icon={Eye}
          />
          <StatCard
            label="Conversas geradas"
            value={nf(o.conversas)}
            hint="Resposta em até 24h"
            icon={MessageSquare}
          />
          <StatCard
            label="CTR"
            value={`${o.ctr.toFixed(1)}%`}
            hint="Conversas ÷ entregues"
            icon={Zap}
          />
          <StatCard
            label="1ª resposta média"
            value={min(o.primeiraRespostaMin)}
            hint="Somente horário comercial"
            icon={Timer}
          />
        </section>
        <section className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title="Mensagens por dia"
              subtitle="Disparos e entradas no horário comercial"
            >
              <MessagesChart data={data.messagesByDay} />
            </ChartCard>
          </div>
          <ChartCard title="Status de entrega" subtitle="Total filtrado">
            <DeliveryChart data={data.deliveryBreakdown} />
          </ChartCard>
        </section>
        <ChartCard
          title="Tempos de resposta"
          subtitle={`Primeira resposta e média geral · média atual ${min(o.respostaMediaMin)}`}
        >
          <ResponseTimeChart data={data.responseTimeByDay} />
        </ChartCard>
        <ChartCard
          title="Disparos por campanha"
          subtitle="Leitura, conversas atribuídas em 24h, CTR e primeira resposta"
        >
          <CampaignTable campaigns={data.campaigns} />
        </ChartCard>
        <footer className="text-center text-xs text-muted-foreground">
          Fast Escova · Postgres · atualizado em{" "}
          {new Date(data.atualizadoEm).toLocaleString("pt-BR")}
        </footer>
      </main>
    </div>
  );
}
