export type CampaignMetric = {
  id: string;
  nome: string;
  tipo: string;
  data: string;
  status: string;
  enviadas: number;
  entregues: number;
  lidas: number;
  conversas: number;
  mensagensRecebidas: number;
  ctr: number;
  primeiraRespostaMin: number | null;
};

export type DashboardPeriod = "today" | "7d" | "30d";

export type DashboardData = {
  atualizadoEm: string;
  overview: {
    campanhasAtivas: number;
    enviadas: number;
    entregues: number;
    lidas: number;
    conversas: number;
    mensagensRecebidas: number;
    ctr: number;
    primeiraRespostaMin: number | null;
    respostaMediaMin: number | null;
    custoEstimado: number;
    custoPorOportunidade: number | null;
  };
  atendimento: {
    totalConversas: number;
    mediaConversasDia: number;
    mediaEnviadasDia: number;
    mediaRecebidasDia: number;
    tempoRespostaMedioMin: number | null;
    primeiraRespostaMediaMin: number | null;
  };
  campaigns: CampaignMetric[];
  dispatchesByDay: Array<{
    dia: string;
    disparadas: number;
    oportunidades: number;
    recebidas: number;
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
