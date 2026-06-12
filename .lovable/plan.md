# Otimização de custo de banco — sem mexer na contabilização

Objetivo: reduzir volume de linhas / WAL / disco **sem alterar nenhuma métrica** mostrada hoje (tempo ativo, pausas, almoço, inatividade, ranking, navegação, uso de apps). Tudo é feito em camadas que podem ser revertidas individualmente.

## Princípio de segurança

A contabilização **final** de cada sessão/navegação/uso é calculada no momento do `close` a partir de `inicio` e `fim` (mais `idleAccum` no caso da extensão). Os `PATCH` intermediários (heartbeat de 60s) só servem para "não perder muito" se o processo morrer. Logo: **espaçar os heartbeats não muda o resultado final** quando o ciclo fecha normalmente. Esse é o único ponto que mexemos no cliente.

Não tocamos em:
- Lógica de transição de status (`use-current-session.ts`).
- Cálculo de `duracao_segundos` / `inativo_segundos` no `close`.
- Threshold de inatividade (`INACTIVITY_LIMIT_MS`, `IDLE_THRESHOLD_S`).
- Heartbeats da extensão → app (mantém detecção de presença em outra aba).
- `presenca_desktop` (já é 1 linha por usuário, ótimo).

---

## Fase 1 — Reduzir gravação (zero migração, zero risco de métrica)

Apenas constantes:

- `extension/background.js`: heartbeat de `periodInMinutes: 1` → `5`. Continua chamando `fetchMacroStatus` e `broadcastHeartbeat` no mesmo alarme; trocamos para 2 alarmes separados: `appHeartbeat` (1 min, só envia mensagem para a aba do app — não escreve no banco) e `dbHeartbeat` (5 min, escreve `PATCH` em `navegacao_externa` e lê `monitor_idle_whitelist`/`registros_atividade`). Resultado: ~5× menos writes/reads do banco vindos da extensão; presença para o app continua a 1 min.
- `desktop/src/config.js`: `FLUSH_INTERVAL_MS` 60_000 → 300_000 (5 min). `MACRO_POLL_MS` 30_000 → 120_000. `POLL_INTERVAL_MS` mantém em 5s (é local, não escreve no banco — só dispara write quando o app ativo **muda**). `presenca_desktop` upsert mantém cadência atual (controlada pelo desktop; revisar para 60s mínimo se já não for).
- Descarte de "lixo" no insert (apenas no cliente, antes do POST):
  - `navegacao_externa`: não abre linha para `chrome://`, `about:`, nova aba vazia (já filtrado por `isTrackable`); adiciona descarte ao **fechar** se `duracao_segundos < 3` (ruído de troca rápida de aba).
  - `uso_aplicativos` (desktop): mesmo descarte `< 3s`.

Impacto na métrica: **nenhum**. Sessões com duração real ≥3s continuam contadas; ruído de menos de 3s não aparece em relatório hoje de qualquer modo.

## Fase 2 — Agregação diária + retenção (mantém drill-down recente)

Novas tabelas materializadas por job:

```text
uso_app_diario(usuario_id, dia, app_nome, segundos_totais, segundos_inativos, sessoes)
navegacao_diaria(usuario_id, dia, domain, segundos_totais, segundos_inativos, visitas)
atividade_diaria(usuario_id, dia, segundos_ativo, segundos_pausa, segundos_almoco, segundos_inativo, inicio_jornada, fim_jornada)
```

- Migration cria as 3 tabelas com PK composta (`usuario_id, dia, ...`), GRANTs e RLS espelhando as tabelas brutas (usuário lê o próprio, admin lê todos).
- Função `public.agregar_dia(p_dia date)` em PL/pgSQL faz `INSERT ... ON CONFLICT DO UPDATE` lendo das tabelas brutas onde `fim IS NOT NULL` e `inicio::date = p_dia`. Idempotente.
- Rota `src/routes/api/public/hooks/agregar-diario.ts` chama `agregar_dia(yesterday)` e depois `purgar_antigos()` (deleta linhas brutas de `navegacao_externa`, `uso_aplicativos`, `navegacao_paginas` com `inicio < now() - interval '30 days'`).
- `pg_cron` roda 03:00 UTC todos os dias.

**Janela de retenção bruta: 30 dias.** Hoje os relatórios (a confirmar na implementação) tipicamente olham "hoje / semana / mês" — esse período cai inteiro dentro do bruto. Períodos maiores passam a ler do agregado.

### Ajuste nos relatórios

- Onde a query atual filtra por `inicio >= start AND inicio <= end`:
  - Se `start >= now() - 29 days`: continua lendo da tabela bruta (mesma fidelidade que hoje).
  - Caso contrário: lê de `*_diario` (somatórios por dia já materializados).
- Implementado em helpers em `src/lib/reports.ts` (novo) consumidos por `relatorios.tsx`, `ranking.tsx`, `operacional.tsx`, `index.tsx`. Cada chamada antiga vira `getUsoApp({from, to, userId})` que decide internamente bruto vs agregado.
- `registros_atividade` **não tem purge** (é a fonte primária do expediente; volume é baixo — 5–10 linhas/usuário/dia). Só ganha `atividade_diaria` para relatórios de período longo.

Impacto na métrica:
- Períodos ≤30 dias: idêntico (lê bruto).
- Períodos >30 dias: granularidade vira "por dia" em vez de "por sessão". Totais batem (a soma das sessões = total do dia). Drill-down sessão-a-sessão fica disponível só nos últimos 30 dias — comportamento padrão de qualquer sistema com retenção.

## Fase 3 — Opcional, depois de validar

- Particionar `navegacao_externa` / `uso_aplicativos` por mês para tornar o purge O(1) (`DROP PARTITION`) em vez de `DELETE`. Vale a pena só se o volume continuar alto após Fase 1+2.
- Export Parquet mensal para Storage como arquivo frio (auditoria), com link de download na tela de admin.

Não implemento Fase 3 agora — espero ver o efeito real das Fases 1 e 2.

---

## Ordem de execução desta resposta

1. **Migration** criando `uso_app_diario`, `navegacao_diaria`, `atividade_diaria` + RLS/GRANT + função `agregar_dia` + função `purgar_antigos`.
2. **Server route** `src/routes/api/public/hooks/agregar-diario.ts`.
3. **Agendar cron** via `supabase--insert` (`pg_cron` 03:00 UTC).
4. **Helpers** em `src/lib/reports.ts` que decidem bruto vs agregado.
5. **Refator das telas de relatório** para usar os helpers (sem mudar UI nem números exibidos para janelas ≤30 dias).
6. **Constantes** em `extension/background.js` e `desktop/src/config.js`.
7. **Filtro de duração mínima** (`<3s` descartado) na extensão e no desktop.

Cada passo é commitável isolado; se algo der ruim a reversão é localizada.

## Riscos e mitigação

- **Risco**: agregação calcular errado e relatório de período longo divergir. **Mitigação**: função idempotente, dá para rodar `select agregar_dia(generate_series(...))` para recomputar; testes manuais comparando soma do agregado vs soma do bruto para o mesmo dia antes de habilitar o cron.
- **Risco**: heartbeat mais espaçado piorar relatório "ao vivo". **Mitigação**: o relatório "ao vivo" hoje lê `registros_atividade` (não os 60s patches), então não muda.
- **Risco**: purge apagar dado antes do agregado rodar. **Mitigação**: a rota faz `agregar_dia` **antes** de `purgar_antigos`, e o purge mantém 30 dias (margem de 29 dias além do dia agregado).

## Pergunta antes de tocar nos relatórios

A janela de retenção bruta de **30 dias** é confortável? Se você costuma abrir drill-down sessão-a-sessão de meses anteriores, subo para 60 ou 90 dias (custo proporcional). Para tudo "≤ 30 dias" o comportamento é literalmente idêntico ao atual.
