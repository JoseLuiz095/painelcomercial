// Keep the parser available even when a mobile network blocks third-party CDNs.
importScripts("./xlsx.full.min.js");

const MONTHS = new Map([
  ["JAN",1],["JANEIRO",1],["JANUARY",1],
  ["FEV",2],["FEVEREIRO",2],["FEB",2],["FEBRUARY",2],
  ["MAR",3],["MARCO",3],["MARCH",3],
  ["ABR",4],["ABRIL",4],["APR",4],["APRIL",4],
  ["MAI",5],["MAIO",5],["MAY",5],
  ["JUN",6],["JUNHO",6],["JUNE",6],
  ["JUL",7],["JULHO",7],["JULY",7],
  ["AGO",8],["AGOSTO",8],["AUG",8],["AUGUST",8],
  ["SET",9],["SETEMBRO",9],["SEP",9],["SEPTEMBER",9],
  ["OUT",10],["OUTUBRO",10],["OCT",10],["OCTOBER",10],
  ["NOV",11],["NOVEMBRO",11],["NOVEMBER",11],
  ["DEZ",12],["DEZEMBRO",12],["DEC",12],["DECEMBER",12]
]);

function norm(value) {
  return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getCell(sheet, r, c) {
  if (Array.isArray(sheet)) return sheet[r] && sheet[r][c] ? sheet[r][c] : null;
  return sheet[XLSX.utils.encode_cell({ r, c })] || null;
}

function getValue(sheet, r, c) {
  if (c == null) return null;
  const cell = getCell(sheet, r, c);
  if (!cell || cell.v == null) return null;
  return cell.v;
}

function sheetRange(sheet) {
  try { return XLSX.utils.decode_range(sheet["!ref"] || "A1"); }
  catch (_) { return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }; }
}

function findHeader(sheet, requiredGroups, startAt) {
  const range = sheetRange(sheet);
  const endRow = Math.min(range.e.r, range.s.r + 15);
  const aliasSets = requiredGroups.map(group => group.map(norm));
  for (let r = startAt == null ? range.s.r : startAt; r <= endRow; r++) {
    const headers = new Map();
    for (let c = range.s.c; c <= range.e.c; c++) {
      const value = getValue(sheet, r, c);
      if (value != null && String(value).trim()) headers.set(norm(value), c);
    }
    const matches = aliasSets.every(set => set.some(alias => headers.has(alias)));
    if (matches) return { row: r, headers, range };
  }
  return null;
}

function findColumn(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.get(norm(alias));
    if (index != null) return index;
  }
  return null;
}

function findSheet(workbook, exactNames, predicate) {
  const names = workbook.SheetNames || [];
  const normalized = names.map(name => [name, norm(name)]);
  for (const wanted of exactNames) {
    const found = normalized.find(item => item[1] === norm(wanted));
    if (found) return { name: found[0], sheet: workbook.Sheets[found[0]] };
  }
  if (predicate) {
    for (const name of names) {
      const sheet = workbook.Sheets[name];
      if (predicate(sheet)) return { name, sheet };
    }
  }
  return null;
}

function cleanId(value) {
  if (value == null || String(value).trim() === "") return "";
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  const text = String(value).trim();
  return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
}

function parseYear(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear();
  const match = String(value == null ? "" : value).match(/(?:19|20|21)\d{2}/);
  return match ? Number(match[0]) : null;
}

function parseMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getMonth() + 1;
  if (typeof value === "number" && value >= 1 && value <= 12) return Math.floor(value);
  const key = norm(value);
  if (MONTHS.has(key)) return MONTHS.get(key);
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12 ? numeric : null;
}

function asAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const text = String(value).trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function emptyActual(year, consultantId, supervisorId, consultantName, supervisorName) {
  return { year, consultantId, supervisorId, consultantName, supervisorName, months: {} };
}

function addMonthly(actual, month, category, amount) {
  const monthKey = month == null ? "0" : String(month);
  if (!actual.months[monthKey]) actual.months[monthKey] = { sales: 0, revenue: 0, salesRows: 0, revenueRows: 0 };
  const bucket = actual.months[monthKey];
  if (category === "VENDAS" || category === "CANCEL") { bucket.sales += amount; bucket.salesRows++; }
  if (category === "FATURA" || category === "DEVOLV") { bucket.revenue += amount; bucket.revenueRows++; }
}

function parseTransactions(workbook, result, stats) {
  const selected = findSheet(workbook, ["BASE_25", "BASE_24", "BASE", "VENDAS"]);
  let raw = selected;
  if (!raw) {
    raw = findSheet(workbook, [], sheet => !!findHeader(sheet, [
      ["CD_RP", "CODIGO_CONSULTOR", "CONSULTOR_ID"], ["ANO", "ANO_VENDA", "YEAR"], ["CONSTANT", "CATEGORIA", "CLASSIFICACAO"]
    ]));
  }
  if (!raw) return;
  const head = findHeader(raw.sheet, [
    ["CD_RP", "CODIGO_CONSULTOR", "CONSULTOR_ID"], ["ANO", "ANO_VENDA", "YEAR"], ["CONSTANT", "CATEGORIA", "CLASSIFICACAO"]
  ]);
  if (!head) return;
  const col = {
    consultantId: findColumn(head.headers, ["CD_RP", "CODIGO_CONSULTOR", "CONSULTOR_ID", "COD_REPRESENTANTE"]),
    supervisorId: findColumn(head.headers, ["COD_GER", "CODIGO_SUPERVISOR", "SUPERVISOR_ID", "COD_GERENTE"]),
    consultantName: findColumn(head.headers, ["NOMEFANTASIA_PESSOA", "NOME_CONSULTOR", "CONSULTOR", "REPRESENTANTE"]),
    supervisorName: findColumn(head.headers, ["NOMEFANTASIA_PESSOA3", "NOME_SUPERVISOR", "SUPERVISOR", "GERENTE"]),
    year: findColumn(head.headers, ["ANO", "ANO_VENDA", "YEAR"]),
    month: findColumn(head.headers, ["MES_COMPL", "MES_ABRV", "MES", "MONTH"]),
    date: findColumn(head.headers, ["DTEMISSAO_DOCFAT", "DATA", "DATA_VENDA", "EMISSAO"]),
    category: findColumn(head.headers, ["CONSTANT", "TIPO", "CATEGORIA", "CLASSIFICACAO", "STATUS_VENDA"]),
    amount: findColumn(head.headers, ["COLUNA5", "VALOR_VENDA", "VALOR_LIQUIDO", "VLR_TOTAL", "VALOR_TOTAL", "VALOR"])
  };
  if (col.consultantId == null || col.year == null || col.category == null || col.amount == null) return;
  const range = head.range;
  const buckets = new Map();
  const allowed = new Set(["VENDAS", "CANCEL", "FATURA", "DEVOLV"]);
  const years = new Set();
  for (let r = head.row + 1; r <= range.e.r; r++) {
    if (r % 12000 === 0) self.postMessage({ type: "progress", fileName: stats.fileName, detail: `Lendo vendas: linha ${r + 1} de ${range.e.r + 1}` });
    const category = norm(getValue(raw.sheet, r, col.category));
    if (!allowed.has(category)) continue;
    const amount = asAmount(getValue(raw.sheet, r, col.amount));
    const year = parseYear(getValue(raw.sheet, r, col.year));
    if (amount == null || year == null) continue;
    const consultantId = cleanId(getValue(raw.sheet, r, col.consultantId));
    const consultantName = String(getValue(raw.sheet, r, col.consultantName) || "").trim();
    if (!consultantId && !consultantName) continue;
    const supervisorId = cleanId(getValue(raw.sheet, r, col.supervisorId)) || "__sem_supervisor__";
    const supervisorName = String(getValue(raw.sheet, r, col.supervisorName) || "Sem supervisor").trim();
    const month = parseMonth(getValue(raw.sheet, r, col.month)) || parseMonth(getValue(raw.sheet, r, col.date)) || 0;
    const id = consultantId || `nome:${consultantName}`;
    const key = `${year}|${id}|${supervisorId}`;
    if (!buckets.has(key)) buckets.set(key, emptyActual(year, id, supervisorId, consultantName || `Consultor ${id}`, supervisorName));
    const record = buckets.get(key);
    if (!record.consultantName && consultantName) record.consultantName = consultantName;
    if (!record.supervisorName && supervisorName) record.supervisorName = supervisorName;
    addMonthly(record, month, category, amount);
    years.add(year);
    stats.actualRows++;
  }
  result.actuals.push(...buckets.values());
  result.actualYears = [...new Set([...result.actualYears, ...years])].sort((a,b)=>a-b);
  stats.rawSheet = raw.name;
}

function parseTargetSheet(workbook, sheet, scope, result, stats) {
  if (!sheet) return;
  const head = findHeader(sheet, [
    ["CODIGO_METASVEN", "CODIGO", "CD_RP"], ["ANO_METASVEN", "ANO", "YEAR"], ["META_01_MVENLIN", "META", "VALOR_META"]
  ]);
  if (!head) return;
  const col = {
    id: findColumn(head.headers, ["CODIGO_METASVEN", "CODIGO", "CD_RP", "COD_GER"]),
    name: findColumn(head.headers, ["CONTATO_PESSOA_END", "NOME", "NOME_CONSULTOR", "CONSULTOR"]),
    year: findColumn(head.headers, ["ANO_METASVEN", "ANO", "YEAR"]),
    type: findColumn(head.headers, ["TIPO", "TIPO_META"]),
    month: findColumn(head.headers, ["COLUNA1", "MES", "MES_META", "MES_COMPL"]),
    amount: findColumn(head.headers, ["META_01_MVENLIN", "META", "VALOR_META"])
  };
  if (col.id == null || col.year == null || col.amount == null) return;
  const range = head.range;
  const targetMap = new Map();
  for (let r = head.row + 1; r <= range.e.r; r++) {
    const type = norm(getValue(sheet, r, col.type));
    if (type && type !== "META") continue;
    const id = cleanId(getValue(sheet, r, col.id));
    const year = parseYear(getValue(sheet, r, col.year));
    const amount = asAmount(getValue(sheet, r, col.amount));
    if (!id || !year || amount == null) continue;
    const month = parseMonth(getValue(sheet, r, col.month)) || 0;
    const key = `${year}|${id}`;
    if (!targetMap.has(key)) targetMap.set(key, { scope, id, year, name: String(getValue(sheet, r, col.name) || "").trim(), months: {} });
    const record = targetMap.get(key);
    const monthKey = String(month);
    // Repeated keys within one source file are consolidated; repeated uploads are deduped by the app.
    record.months[monthKey] = (record.months[monthKey] || 0) + amount;
    stats.targetRows++;
  }
  result.targets.push(...targetMap.values());
  stats.targetSheets.push(scope);
}

function parseMappings(workbook, result) {
  const selected = findSheet(workbook, ["Planilha2", "MAPEAMENTO", "HIERARQUIA"]);
  if (!selected) return;
  const head = findHeader(selected.sheet, [
    ["CD_RP", "CODIGO_CONSULTOR", "CONSULTOR_ID"], ["COD_GER", "CODIGO_SUPERVISOR", "SUPERVISOR_ID"]
  ]);
  if (!head) return;
  const col = {
    consultantId: findColumn(head.headers, ["CD_RP", "CODIGO_CONSULTOR", "CONSULTOR_ID"]),
    supervisorId: findColumn(head.headers, ["COD_GER", "CODIGO_SUPERVISOR", "SUPERVISOR_ID"]),
    consultantName: findColumn(head.headers, ["NOMEFANTASIA_PESSOA", "NOME_CONSULTOR", "CONSULTOR"]),
    supervisorName: findColumn(head.headers, ["NOMEFANTASIA_PESSOA3", "NOME_SUPERVISOR", "SUPERVISOR"])
  };
  const range = head.range;
  for (let r = head.row + 1; r <= range.e.r; r++) {
    const consultantId = cleanId(getValue(selected.sheet, r, col.consultantId));
    const supervisorId = cleanId(getValue(selected.sheet, r, col.supervisorId));
    if (!consultantId || !supervisorId) continue;
    result.mappings.push({
      consultantId,
      supervisorId,
      consultantName: String(getValue(selected.sheet, r, col.consultantName) || "").trim(),
      supervisorName: String(getValue(selected.sheet, r, col.supervisorName) || "").trim()
    });
  }
}

function matchSheetName(workbook, exactNames) {
  const names = workbook.SheetNames || [];
  for (const wanted of exactNames) {
    const found = names.find(name => norm(name) === norm(wanted));
    if (found) return workbook.Sheets[found];
  }
  return null;
}

self.onmessage = async event => {
  const { file, requestId } = event.data || {};
  if (!file) return;
  const stats = { fileName: file.name, actualRows: 0, targetRows: 0, rawSheet: null, targetSheets: [] };
  const result = { fileName: file.name, actuals: [], targets: [], mappings: [], actualYears: [], targetYears: [] };
  try {
    self.postMessage({ type: "progress", requestId, fileName: file.name, detail: "Abrindo o Excel no navegador…" });
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array", dense: true, cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false });
    self.postMessage({ type: "progress", requestId, fileName: file.name, detail: "Identificando abas de vendas, metas e hierarquia…" });
    parseMappings(workbook, result);
    parseTransactions(workbook, result, stats);
    const managerMeta = matchSheetName(workbook, ["BASE_META"]);
    const consultantMeta = matchSheetName(workbook, ["BASE_META_REP", "BASE_META6"]);
    parseTargetSheet(workbook, managerMeta, "supervisor", result, stats);
    parseTargetSheet(workbook, consultantMeta, "consultor", result, stats);
    result.stats = stats;
    result.targetYears = [...new Set(result.targets.map(item => item.year))].sort((a,b)=>a-b);
    if (result.actuals.length === 0 && result.targets.length === 0) {
      throw new Error("Não encontrei as abas ou colunas de vendas e metas esperadas. Use o modelo de planilha do painel.");
    }
    self.postMessage({ type: "done", requestId, result });
  } catch (error) {
    self.postMessage({ type: "error", requestId, fileName: file.name, message: error && error.message ? error.message : "Falha ao ler o arquivo." });
  }
};