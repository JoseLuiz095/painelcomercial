# Painel Comercial

Dashboard estático em português, adaptado para desktop e celular, para acompanhar vendas, metas, atingimento, faturamento e crescimento por supervisor e consultor.

## Como usar

1. Abra o endereço do GitHub Pages.
2. Selecione um ou mais arquivos `.xlsx`, `.xls`, `.xlsm` ou `.csv`.
3. Escolha o ano, supervisor e consultor nos filtros.
4. Use **Exportar CSV** ou **Imprimir** para baixar uma cópia dos resultados.

Os arquivos são lidos no próprio navegador em um Web Worker. O painel não envia nem armazena os arquivos. Recarregar a página limpa os dados carregados.

## Abas reconhecidas

- Vendas: `BASE_25`, `BASE_24`, `BASE` ou uma aba com colunas de consultor, ano e classificação.
- Metas por supervisor: `BASE_META`.
- Metas por consultor: `BASE_META_REP`.
- Relação consultor/supervisor: `Planilha2`.

As metas devem ter colunas de código, nome, ano, tipo, mês e valor. O painel inclui linhas `META` e ignora `COTA` quando há esse campo.

## Regras dos indicadores

- **Venda realizada:** soma dos valores classificados como `VENDAS` e `CANCEL`.
- **Faturamento:** soma dos valores classificados como `FATURA` e `DEVOLV`.
- **Atingimento:** venda realizada dividida pela meta anual.
- **Perspectiva de crescimento:** meta do ano atual dividida pela venda realizada no ano anterior completo, menos 1.
- **Crescimento realizado:** venda do ano atual dividida pela venda do ano anterior nos mesmos meses, menos 1.

O painel deixa o comparativo anual indisponível quando o ano anterior carregado não contém todos os 12 meses. A comparação realizada usa apenas meses equivalentes. Se metas ou vendas de consultores estiverem ausentes no arquivo, esses indicadores ficam em branco no nível correspondente.

## Publicação

O projeto não tem etapa de build. O GitHub Pages publica os arquivos da raiz do repositório. A biblioteca SheetJS é carregada de seu CDN oficial para abrir os arquivos Excel.
