import type { CampaignMetric } from "@/lib/dashboard-types";
const nf = (n: number) => n.toLocaleString("pt-BR");
const statusLabel: Record<string, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  processando: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
  falha: "Falha",
};
export function CampaignTable({ campaigns }: { campaigns: CampaignMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="pb-3">Campanha</th>
            <th>Tipo</th>
            <th>Status</th>
            <th className="text-right">Disparadas</th>
            <th className="text-right">Lidas</th>
            <th className="text-right">Oportunidades</th>
            <th className="text-right">Recebidas</th>
            <th className="text-right">Conversão</th>
            <th className="text-right">1ª resposta</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-border/70">
              <td className="py-3 pr-4 font-medium">
                {c.nome}
                <span className="block text-xs font-normal text-muted-foreground">{c.data}</span>
              </td>
              <td>{c.tipo}</td>
              <td>
                <span className="rounded-full border px-2.5 py-1 text-xs">
                  {statusLabel[c.status] ?? c.status}
                </span>
              </td>
              <td className="text-right">{nf(c.enviadas)}</td>
              <td className="text-right">{nf(c.lidas)}</td>
              <td className="text-right">{nf(c.conversas)}</td>
              <td className="text-right">{nf(c.mensagensRecebidas)}</td>
              <td className="text-right font-medium text-primary">{c.ctr.toFixed(1)}%</td>
              <td className="text-right">
                {c.primeiraRespostaMin == null ? "—" : `${c.primeiraRespostaMin.toFixed(1)} min`}
              </td>
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
