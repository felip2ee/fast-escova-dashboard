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
  ctr: number;
  primeiraRespostaMin: number | null;
};

export type DashboardData = {
  atualizadoEm: string;
  overview: {
    campanhasAtivas: number;
    enviadas: number;
    entregues: number;
    lidas: number;
    conversas: number;
    ctr: number;
    primeiraRespostaMin: number | null;
    respostaMediaMin: number | null;
  };
  campaigns: CampaignMetric[];
  messagesByDay: Array<{ dia: string; enviadas: number; recebidas: number }>;
  responseTimeByDay: Array<{ dia: string; primeira: number | null; media: number | null }>;
  deliveryBreakdown: Array<{ nome: string; valor: number; cor: string }>;
};
