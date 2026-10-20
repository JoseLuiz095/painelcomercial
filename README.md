# Painel Comercial

Dashboard estático em português, adaptado para desktop e celular, para acompanhar vendas, metas, atingimento, faturamento e crescimento por supervisor e consultor.

## Como usar

1. Abra o endereço do GitHub Pages.
2. Selecione um ou mais arquivos `.xlsx`, `.xls`, `.xlsm` ou `.csv`.
3. Escolha o ano, supervisor e consultor nos filtros.
4. Escolha um ou mais meses no filtro **Meses analisados**.
5. Use **Exportar CSV** ou **Imprimir** para baixar uma cópia dos resultados.

Os arquivos são lidos no próprio navegador em um Web Worker. O painel não envia nem armazena os arquivos. Recarregar a página limpa os dados carregados.

## Abas reconhecidas

- Vendas: todas as abas que tenham código do consultor, classificação e valor. O ano vem da coluna de ano ou, se ela faltar, do nome da aba (por exemplo, `BASE_23`, `BASE_24`, `BASE_25` ou `BASE_26`).
- Metas por supervisor: `BASE_META`.
- Metas por consultor: `BASE_META_REP`.
- Relação consultor/supervisor: `Planilha2`.

As metas devem ter colunas de código, nome, ano, tipo, mês e valor. O painel inclui linhas `META` e ignora `COTA` quando há esse campo.

## Regras dos indicadores

- **Venda realizada:** soma dos valores classificados como `VENDAS` e `CANCEL`.
- **Faturamento:** soma dos valores classificados como `FATURA` e `DEVOLV`.
- **Atingimento:** venda dos meses selecionados dividida pela meta desses meses, quando o arquivo detalha metas mensais. Se só houver meta anual, o painel compara a venda selecionada com essa meta anual.
- **Perspectiva de crescimento:** meta do ano atual dividida pela venda realizada no ano anterior completo, menos 1.
- **Crescimento realizado:** venda do ano atual dividida pela venda do ano anterior nos mesmos meses selecionados, menos 1.

Ao carregar os dados, o filtro começa nos meses disponíveis do ano selecionado. Depois você pode selecionar meses específicos ou todos. A meta usa os valores mensais correspondentes quando a planilha tem esse detalhamento; se houver apenas uma meta anual, ela continua identificada como anual. A perspectiva depende de a venda do ano anterior ter os 12 meses. O painel mantém cada venda associada ao supervisor indicado na própria linha, e relações de consultores sem ano só são usadas quando não há mais de um supervisor possível.

## Publicação

O projeto não tem etapa de build. O GitHub Pages publica os arquivos da raiz do repositório. A biblioteca oficial SheetJS está incluída localmente (`xlsx.full.min.js`), então a leitura de planilhas não depende de carregar um CDN externo.

O projeto inclui SheetJS Community Edition 0.20.3, copyright © 2012–presente SheetJS LLC, sob a licença Apache 2.0. Consulte `LICENSE-SHEETJS.txt`.
