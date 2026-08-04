import type { CampaignMetric } from "@/lib/dashboard-types";
const nf = (n: number) => n.toLocaleString("pt-BR");
export function CampaignTable({ campaigns }: { campaigns: CampaignMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="pb-3">Campanha</th>
            <th className="text-right">Quantidade disparada</th>
            <th className="text-right">Conversão</th>
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
              <td className="text-right font-medium text-primary">{c.ctr.toFixed(1)}%</td>
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
