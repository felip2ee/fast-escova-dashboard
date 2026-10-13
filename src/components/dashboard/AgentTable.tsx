import type { AgentMetric } from "@/lib/dashboard-types";

const nf = (value: number) => value.toLocaleString("pt-BR");
const minutes = (value: number | null) =>
  value == null
    ? "—"
    : `${value.toLocaleString("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} min`;

export function AgentTable({ agents }: { agents: AgentMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="pb-3">Atendente</th>
            <th className="text-right">Conversas</th>
            <th className="text-right">Mensagens enviadas</th>
            <th className="text-right">Tempo médio para responder</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.id} className="border-t border-border/70">
              <td className="py-3 pr-4 font-medium">{agent.nome}</td>
              <td className="text-right">{nf(agent.conversas)}</td>
              <td className="text-right">{nf(agent.mensagensEnviadas)}</td>
              <td className="text-right font-medium text-primary">
                {minutes(agent.tempoRespostaMedioMin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!agents.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento humano encontrado no período.
        </p>
      )}
    </div>
  );
}
