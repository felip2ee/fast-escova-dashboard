# Integração do Dashboard com o Chatwoot

## Objetivo

Transformar o dashboard da Fast Escova em um relatório claro para o cliente sobre dois aspectos complementares:

1. resultado dos disparos de campanhas;
2. atendimento geral realizado pela equipe no Chatwoot.

O painel deve combinar os registros operacionais do schema `disparos` com os dados de conversas e mensagens do PostgreSQL do Chatwoot. O resultado deve ser compreensível para um público não técnico e permanecer consultável para qualquer período, com o último mês selecionado por padrão.

## Escopo aprovado

### Resultado dos disparos

O funil inicial mede somente:

- mensagens enviadas;
- mensagens entregues;
- mensagens lidas;
- pessoas que responderam;
- falhas confirmadas.

Agendamento, comparecimento, venda e outras etapas comerciais ficam fora desta fase.

Uma resposta pertence à campanha quando é a primeira mensagem recebida do contato até 48 horas depois do disparo. Se houver mais de um disparo elegível, a resposta pertence ao disparo mais recente anterior à mensagem.

### Atendimento geral

O relatório inclui todas as conversas da inbox Fast Escova, mesmo quando não estão relacionadas a uma campanha.

Somente atendimento humano público entra nas métricas da equipe. Devem ser excluídos:

- templates;
- bots e automações;
- notas privadas;
- mensagens de sistema;
- outros eventos internos do Chatwoot.

### Atendimento por atendente

As métricas individuais são atribuídas a quem efetivamente enviou cada mensagem, e não ao responsável atual da conversa. Quando duas ou mais atendentes participarem da mesma conversa, a conversa contará uma vez para cada participante.

## Fontes de dados

### Schema `disparos`

Continua sendo a fonte para:

- campanhas;
- destinatários;
- lista e volume planejado;
- checkpoints do fluxo de envio;
- IDs de contato, conversa e mensagem do Chatwoot;
- erros e estado operacional da campanha.

Os vínculos principais já disponíveis são:

- `campanha_destinatarios.chatwoot_message_id`;
- `campanha_destinatarios.chatwoot_conversation_id`;
- `campanha_destinatarios.chatwoot_contact_id`;
- `campanha_destinatarios.template_enviado_em`.

### PostgreSQL do Chatwoot

Será a fonte para:

- estado atualizado de entrega e leitura;
- mensagens recebidas dos clientes;
- mensagens públicas enviadas por humanos;
- autor real de cada resposta;
- conversas da inbox Fast Escova;
- datas necessárias para calcular tempos de resposta.

A conexão do dashboard com o Chatwoot deve usar um usuário somente leitura e com acesso restrito às tabelas necessárias.

## Arquitetura

O dashboard terá três componentes de servidor com responsabilidades separadas.

### Sincronizador Chatwoot

O sincronizador será executado sob demanda:

- ao abrir o dashboard;
- ao clicar em “Atualizar dados”;
- ao trocar ou aplicar o período consultado.

Não haverá polling contínuo nem agendamento a cada minuto.

Cada execução busca somente registros criados ou alterados depois do cursor persistido da última sincronização. Um bloqueio no banco impede que acessos simultâneos repitam o mesmo trabalho. A sincronização deve ser paginada e idempotente.

O primeiro acesso após a implantação executa a carga histórica paginada. As execuções seguintes processam somente as mudanças incrementais.

### Projeção analítica

Uma projeção mínima do Chatwoot será persistida em um schema próprio do banco usado pelo dashboard. Ela conterá apenas os campos necessários ao relatório:

- ID da mensagem;
- ID da conversa;
- ID da inbox;
- direção da mensagem;
- condição pública ou privada;
- classificação de mensagem humana, automação, template ou sistema;
- status de entrega;
- ID e nome do autor;
- datas de criação e atualização.

O conteúdo das mensagens não será copiado. O schema também armazenará o cursor da sincronização, o horário da última execução bem-sucedida e falhas operacionais sanitizadas.

### Motor de métricas

O motor de métricas consulta o schema `disparos` e a projeção analítica, aplica as regras aprovadas e entrega dados agregados à API do dashboard.

As métricas de campanha devem preferir os IDs do Chatwoot como vínculo. Normalização de telefone será usada apenas como fallback controlado para dados históricos que não possuam os IDs necessários. O fallback não pode atribuir a mesma resposta a mais de um disparo.

### API do dashboard

A API preserva filtros por período e passa a retornar três grupos explícitos:

- resumo e campanhas;
- atendimento geral;
- atendimento por atendente.

Ela também retorna o horário da última sincronização e o estado de atualização dos dados.

## Regras das métricas de campanha

Cada destinatário conta no máximo uma vez por campanha em cada estágio do funil.

- **Enviadas:** mensagens aceitas pelo Chatwoot.
- **Entregues:** mensagens com estado `delivered` ou `read`.
- **Lidas:** mensagens com estado `read`.
- **Respondidas:** destinatários com primeira mensagem recebida até 48 horas após o envio.
- **Falhas:** mensagens com falha confirmada, separadas de resultados incertos ou ainda pendentes.

As taxas são:

- entrega = entregues ÷ enviadas;
- leitura = lidas ÷ entregues;
- resposta = respondidas ÷ entregues.

Divisões por zero retornam zero para taxas e `null` para valores que não podem ser calculados de forma válida.

Os custos existentes permanecem no painel:

- custo estimado = mensagens enviadas × US$ 0,04;
- custo por resposta = custo estimado ÷ pessoas que responderam.

O valor fixo deve permanecer centralizado em configuração de domínio, e não repetido em componentes de interface.

## Regras das métricas de atendimento

### Métricas gerais

O relatório geral apresenta:

- conversas distintas atendidas;
- mensagens recebidas de clientes;
- mensagens públicas enviadas por humanos;
- tempo médio de primeira resposta humana;
- tempo médio de resposta humana;
- evolução diária desses volumes e tempos.

### Blocos de mensagens

Mensagens consecutivas do cliente antes de uma resposta humana formam um único bloco. O tempo começa na primeira mensagem do bloco e termina na próxima mensagem pública enviada por uma atendente.

Esse agrupamento impede que uma única resposta seja contada várias vezes quando o cliente envia várias mensagens seguidas.

### Métricas individuais

Para cada atendente, o painel mostra:

- mensagens públicas efetivamente enviadas;
- conversas distintas em que participou;
- tempo médio das respostas que enviou.

O intervalo de resposta é creditado à autora da mensagem que encerrou o bloco pendente do cliente. Uma conversa com participação de várias atendentes conta uma vez para cada uma delas.

### Horário útil

Os tempos consideram somente minutos úteis:

- segunda a sábado;
- das 08h às 20h;
- fuso `America/Araguaina`.

Domingos e períodos fora dessa janela não aumentam a duração medida. Os cálculos precisam cobrir intervalos que atravessem vários dias e limites exatos de abertura e fechamento.

## Interface do cliente

O dashboard será organizado em uma única leitura vertical.

### Resumo do período

Cards apresentam enviadas, entregues, lidas, pessoas que responderam, taxa de resposta, custo estimado e custo por resposta. Um funil mostra as perdas entre envio, entrega, leitura e resposta.

### Resultado das campanhas

A tabela por campanha apresenta:

- nome e data;
- enviadas;
- entregues;
- lidas;
- respondidas;
- falhas;
- taxas de entrega, leitura e resposta.

Um gráfico mostra a evolução diária do funil.

### Atendimento geral

A seção apresenta conversas atendidas, mensagens recebidas, respostas humanas, primeira resposta média, tempo médio de resposta e evolução diária.

### Atendimento por atendente

A tabela apresenta nome, conversas em que participou, mensagens enviadas e tempo médio de resposta.

### Linguagem e filtros

A interface usa termos de negócio como “pessoas que responderam” e “tempo para responder”. Termos técnicos como WABA, WAMID, checkpoint e schema não aparecem na visualização principal.

O último mês fica selecionado por padrão. O cliente também pode consultar hoje, ontem, mês atual, mês anterior e qualquer período personalizado. Não haverá limite funcional fixo para o período, embora consultas extensas possam usar agregações pré-calculadas para preservar desempenho.

## Atualização e falhas

Cada abertura ou atualização tenta sincronizar os dados antes de calcular o relatório.

Se o Chatwoot estiver indisponível:

- o painel usa a última projeção sincronizada;
- mostra o horário da última atualização bem-sucedida;
- informa claramente que os dados podem estar desatualizados;
- nunca substitui valores anteriores por zero;
- não bloqueia a leitura de métricas já disponíveis.

Falhas confirmadas, pendências e resultados incertos de campanhas devem permanecer categorias distintas. Erros técnicos detalhados ficam em uma área operacional secundária e não poluem o relatório do cliente.

## Segurança e privacidade

- A credencial do Chatwoot é exclusiva do servidor e somente leitura.
- Nenhuma credencial usa prefixo público ou é enviada ao navegador.
- O conteúdo das mensagens não é persistido na projeção analítica.
- Logs e estados de erro não armazenam tokens, cabeçalhos ou payloads sensíveis.
- Consultas ao Chatwoot são limitadas à inbox Fast Escova.
- A escrita do dashboard fica restrita ao schema analítico e às migrações explicitamente aprovadas.

## Migração e implantação

1. Identificar a versão e o schema efetivos do Chatwoot em produção.
2. Criar o usuário PostgreSQL somente leitura para as tabelas necessárias.
3. Criar o schema e as tabelas da projeção analítica.
4. Configurar separadamente a conexão atual e a conexão do Chatwoot.
5. Executar a carga histórica paginada da inbox Fast Escova.
6. Conferir amostras de mensagens, estados, autores e conversas contra o Chatwoot.
7. Comparar os totais de campanhas e atendimento em períodos conhecidos.
8. Publicar o dashboard com atualização incremental sob demanda.

A carga inicial deve ser retomável. Uma interrupção não pode exigir apagar dados ou reiniciar todo o histórico.

## Estratégia de testes

### Testes unitários

Cobrir:

- entrega, leitura e falha;
- resposta dentro e fora das 48 horas;
- dois disparos elegíveis para o mesmo contato;
- deduplicação por destinatário e campanha;
- blocos consecutivos de mensagens do cliente;
- troca e participação de múltiplas atendentes;
- exclusão de templates, bots, automações, notas privadas e sistema;
- intervalos dentro e fora do horário útil;
- intervalos atravessando noites, domingos e vários dias;
- limites exatos de 08h e 20h;
- divisões por zero e períodos sem movimento.

### Testes de integração

Cobrir:

- sincronização inicial paginada;
- sincronização incremental idempotente;
- atualização posterior de status para `delivered` e `read`;
- bloqueio de sincronizações concorrentes;
- retomada depois de falha parcial;
- funcionamento com Chatwoot indisponível e dados anteriores preservados;
- união entre IDs do schema `disparos` e da projeção do Chatwoot.

### Validação antes da publicação

Selecionar campanhas e períodos conhecidos e conferir manualmente:

- contagem de mensagens enviadas, entregues e lidas;
- respostas atribuídas dentro das 48 horas;
- autores reais das respostas;
- conversas e mensagens do relatório geral;
- tempos calculados em horário útil;
- custos estimados.

O dashboard só deve substituir o relatório atual depois que essa reconciliação produzir resultados explicáveis e repetíveis.

## Fora de escopo

- Agendamentos, comparecimentos e vendas.
- Análise do conteúdo das mensagens.
- Sentimento, intenção ou classificação por IA.
- Alterações de conversas ou mensagens no Chatwoot.
- Polling contínuo em segundo plano.
- Rankings ou metas competitivas entre atendentes.
- Exportações e novos formatos de relatório, salvo solicitação posterior.

## Critérios de sucesso

- O cliente entende o funil de campanhas sem explicação técnica.
- Estados de entrega e leitura refletem o Chatwoot.
- Respostas são atribuídas uma única vez e respeitam a janela de 48 horas.
- O atendimento geral inclui toda a inbox Fast Escova.
- Métricas por atendente refletem quem efetivamente respondeu.
- Tempos consideram segunda a sábado, das 08h às 20h, em `America/Araguaina`.
- A atualização ocorre somente por acesso ou ação do usuário e processa mudanças incrementais.
- Uma falha do Chatwoot não apaga nem zera dados já sincronizados.
- O painel aceita qualquer período, com o último mês como padrão.
