# Auditoria — Dashboard e estrutura de agregação/custo

> Data: 2026-06-12. Escopo: precisão dos números do dashboard, paleta visual e a nova
> estrutura de economia de custo (tabelas `*_diario` + `agregar_dia` + purge).
> As correções de **precisão** e **paleta** já foram implementadas (ver seções 1 e 2).
> A seção 3 (vulnerabilidades da estrutura de custo) é **recomendação documentada** — ainda
> não aplicada — aguardando aprovação por ser mudança em segurança/banco.

---

## 1. Precisão dos números — corrigido

**Sintoma:** apps desktop registravam ociosidade mas o card "Inativo" mostrava zero.

**Causa-raiz:** existem dois conceitos de ócio que não conversavam:

1. **INATIVO macro** — linha em `registros_atividade` com `status='INATIVO'`, criada só após
   10 min contínuos sem input. O card "Inativo" usava só isto.
2. **Ócio granular** — `inativo_segundos` por sessão de app/site, gravado pelo desktop e pela
   extensão. Só aparecia como faixa dentro dos gráficos de barra; não somava em indicador de topo.

Além disso, o desktop só converte ATIVO→INATIVO macro quando **é dono da sessão**
(`desktopOwnsSession`). Com a aba web aberta, o desktop acumula `inativo_segundos` mas **nunca
dispara INATIVO macro** → ócio capturado, card "Inativo" = 0.

**Correção aplicada** (`src/routes/_authenticated/index.tsx`, `src/lib/format.ts`):

- `monitored` agora expõe `ocioso: { apps, web, total }` (segundos), reaproveitando
  `deskIdleSec`/`chromeIdleSec` já desduplicados. Funciona nas duas trilhas (bruto ≤25d e
  agregado >25d).
- Novo card **"Ociosidade detectada"** (apps + navegação) na grade de stats.
- Card "Inativo" renomeado para **"Inativo (sessão)"** com hint "parado >10 min", para não
  confundir os dois números.
- Legenda sob o donut informando quanto do tempo trabalhado é ócio detectado (sem dupla
  contagem — decisão de produto foi card separado, não subtrair do trabalhado).

---

## 2. Paleta / consistência visual — corrigido

**Problema:** o vermelho `destructive` era usado tanto para INATIVO quanto para o ócio das
barras — alarmante e sem distinção semântica.

**Correção aplicada** (`src/styles.css`, `src/lib/format.ts`, `index.tsx`):

| Estado | Antes | Agora |
|---|---|---|
| ATIVO / Trabalhado | verde `--success` | verde (mantido) |
| PAUSA | âmbar `--warning` | mantido |
| ALMOÇO | azul `--info` | mantido |
| INATIVO (sessão) | vermelho `--destructive` | **slate `--muted-foreground`** (afastado ≠ erro) |
| Ociosidade detectada | vermelho nas barras | **novo `--idle`** (âmbar `oklch(0.7 0.15 55)`) |
| ENCERRADO | cinza | mantido |

- Novo token `--idle`/`--color-idle` (light + dark) em `src/styles.css`.
- Vermelho `destructive` reservado para ações destrutivas (Encerrar/parar).
- Mapa de cores centralizado em `STATUS_COLOR` (`format.ts`) e reaproveitado na timeline,
  eliminando a duplicação.

---

## 3. Estrutura de custo — vulnerabilidades e melhorias (NÃO implementado)

Achados sobre `supabase/migrations/20260612120639_*.sql`, `..._20260612120704_*.sql` e
`src/routes/api/public/hooks/agregar-diario.ts`.

**Pontos positivos (já bem feitos):** RLS habilitada e restritiva nas 3 tabelas `*_diario`;
`agregar_dia`/`purgar_brutos_antigos` são `SECURITY DEFINER` com `EXECUTE` só para
`service_role`; agregação idempotente (DELETE+INSERT); purge só toca sessões fechadas
(`fim IS NOT NULL`) e tem piso de 7 dias; índices `(usuario_id, inicio)` cobrem a agregação.

### 3.1 [ALTA] Endpoint de agregação/purge autenticado pela anon key
`agregar-diario.ts` compara `apikey` com a `SUPABASE_ANON_KEY`/`PUBLISHABLE_KEY` — que é
**pública** (vai no frontend e na extensão). Qualquer um com ela pode disparar
`{"purgar":true,"retencao_dias":7}` e **apagar dados brutos em massa**.
**Recomendação:** segredo dedicado (`CRON_SECRET`) que não circula no cliente; separar o purge
num caminho próprio com segredo adicional; idealmente exigir 2ª chave/confirmação para `purgar`.

### 3.2 [MÉDIA] Fuso horário UTC vs dia local
`agregar_dia` usa fronteiras de dia em **UTC** e o webhook calcula "ontem" em UTC, mas o
dashboard agrupa por **dia local** (`setHours(0,0,0,0)`). Em UTC-3, até 3h de cada dia caem no
balde errado → métricas do histórico >25d divergem do recente.
**Recomendação:** agregar por `America/Sao_Paulo` para casar com o agrupamento local.

### 3.3 [MÉDIA] Purge sem verificação de integridade
`purgar_brutos_antigos` deleta o bruto independentemente de a agregação daquele dia ter
rodado/conferido.
**Recomendação:** antes de deletar, validar por dia que `SUM(bruto) == SUM(agregado)`; só purgar
dias já conferidos.

### 3.4 [MÉDIA] Acoplamento de retenção (25 vs 30)
Dashboard troca para agregado em `daysAgo > 25`; purge default é 30 dias. Margem de só 5 dias e
desacoplada: baixar `retencao_dias` para perto de 25 deixa um buraco (8–25d sem bruto e sem
agregado para os breakdowns).
**Recomendação:** constante compartilhada e invariante `retenção_purge ≥ limiar_agregado`.

### 3.5 [BAIXA] `atividade_diaria` é populada mas nunca lida
O dashboard sempre lê os totais macro de `registros_atividade` (que **não** é purgada — sobrevive
para sempre), então `atividade_diaria` hoje é peso morto e não gera economia.
**Recomendação:** ou o dashboard passa a usar `atividade_diaria` para faixas longas, ou remover a
tabela. (Os totais de topo estão seguros porque `registros_atividade` nunca é purgada.)

### 3.6 [BAIXA/operacional] Validar o cron já agendado
O agendamento está no painel Supabase. Documentar verificação de saúde: alertar se
`MAX(updated_at)` das tabelas `*_diario` ficar mais velho que ~26h (cron falhou). Sem isso, a
trilha >25d silenciosamente esvazia.
