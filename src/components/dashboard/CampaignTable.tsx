import type { CampaignMetric } from "@/lib/dashboard-types";
const nf = (n: number) => n.toLocaleString("pt-BR");
const percent = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export function CampaignTable({ campaigns }: { campaigns: CampaignMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="pb-3">Campanha</th>
            <th className="text-right">Enviadas</th>
            <th className="text-right">Entregues</th>
            <th className="text-right">Lidas</th>
            <th className="text-right">Responderam</th>
            <th className="text-right">Falhas</th>
            <th className="text-right">Taxa de entrega</th>
            <th className="text-right">Taxa de leitura</th>
            <th className="text-right">Taxa de resposta</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-border/70">
              <td className="py-3 pr-4 font-medium">
                {c.nome}
                <span className="block text-xs font-normal text-muted-foreground">{c.data}</span>
              </td>
              <td className="text-right">{nf(c.enviadas)}</td>
              <td className="text-right">{nf(c.entregues)}</td>
              <td className="text-right">{nf(c.lidas)}</td>
              <td className="text-right font-medium text-primary">{nf(c.respondidas)}</td>
              <td className="text-right text-destructive">{nf(c.falhas)}</td>
              <td className="text-right">{percent(c.taxaEntrega)}</td>
              <td className="text-right">{percent(c.taxaLeitura)}</td>
              <td className="text-right font-medium text-primary">{percent(c.taxaResposta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!campaigns.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma campanha encontrada.
        </p>
      )}
    </div>
  );
}
