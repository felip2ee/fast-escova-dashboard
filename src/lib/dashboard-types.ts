import type { SyncFreshness } from "./chatwoot-types";

export type CampaignMetric = {
  id: string;
  nome: string;
  tipo: string;
  data: string;
  status: string;
  enviadas: number;
  entregues: number;
  lidas: number;
  falhas: number;
  pendentes: number;
  resultadosIncertos: number;
  respondidas: number;
  taxaEntrega: number;
  taxaLeitura: number;
  taxaResposta: number;
  conversas: number;
  mensagensRecebidas: number;
  ctr: number;
  primeiraRespostaMin: number | null;
};

export type AgentMetric = {
  id: string;
  nome: string;
  conversas: number;
  mensagensEnviadas: number;
  tempoRespostaMedioMin: number | null;
};

export type DashboardPeriod =
  "today" | "yesterday" | "thisMonth" | "7d" | "30d" | "lastMonth" | "custom";

export type DashboardData = {
  atualizadoEm: string;
  sync: SyncFreshness;
  overview: {
    campanhasAtivas: number;
    enviadas: number;
    entregues: number;
    lidas: number;
    respondidas: number;
    falhas: number;
    pendentes: number;
    resultadosIncertos: number;
    taxaEntrega: number;
    taxaLeitura: number;
    taxaResposta: number;
    conversas: number;
    mensagensRecebidas: number;
    ctr: number;
    primeiraRespostaMin: number | null;
    respostaMediaMin: number | null;
    custoEstimado: number;
    custoPorOportunidade: number | null;
    custoPorResposta: number | null;
  };
  atendimento: {
    totalConversas: number;
    mensagensRecebidas: number;
    respostasHumanas: number;
    mediaConversasDia: number;
    mediaEnviadasDia: number;
    mediaRecebidasDia: number;
    tempoRespostaMedioMin: number | null;
    primeiraRespostaMediaMin: number | null;
  };
  agents: AgentMetric[];
  campaigns: CampaignMetric[];
  dispatchesByDay: Array<{
    dia: string;
    disparadas: number;
    oportunidades: number;
    recebidas: number;
    entregues: number;
    lidas: number;
    respondidas: number;
    falhas: number;
  }>;
  messagesByDay: Array<{
    dia: string;
    conversas: number;
    enviadas: number;
    recebidas: number;
  }>;
  responseTimeByDay: Array<{ dia: string; primeira: number | null; media: number | null }>;
  deliveryBreakdown: Array<{ nome: string; valor: number; cor: string }>;
};
