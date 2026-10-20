(() => {
  "use strict";

  const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const MONTH_WORDS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const ALL_MONTHS = new Set(Array.from({ length: 12 }, (_, index) => index + 1));
  const CONSULTANT_KEY_SEPARATOR = "\u241f";
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const currency2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat("pt-BR");

  const state = {
    actuals: new Map(),
    targets: new Map(),
    mappings: new Map(),
    names: new Map(),
    supervisorNames: new Map(),
    consultantNames: new Map(),
    sourceFiles: [],
    fingerprints: new Set(),
    collapsed: new Set(),
    years: [],
    selectedYear: null,
    selectedMonths: new Set(ALL_MONTHS),
    monthSelectionTouched: false
  };

  const $ = id => document.getElementById(id);
  const fileInputs = [$("fileInput"), ...document.querySelectorAll(".file-input-proxy")];
  const elements = {
    year: $("yearFilter"), supervisor: $("supervisorFilter"), consultant: $("consultantFilter"), search: $("searchInput"),
    monthFilter: $("monthFilterControl"), monthSummary: $("monthSummary"), monthOptions: $("monthOptions"),
    dataStatus: $("dataStatus"), fileList: $("fileList"), empty: $("emptyState"), dashboard: $("dashboard"),
    growthChart: $("growthChart"), trendChart: $("trendChart"), monthlyChart: $("monthlyChart"), rankingChart: $("rankingChart"),
    growthHint: $("growthHint"), detailRows: $("detailRows"), tableEmpty: $("tableEmpty"), dataQuality: $("dataQuality")
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function normalizeId(value) {
    if (value == null) return "";
    const text = String(value).trim();
    return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, "") : text;
  }

  function formatMoney(value, exact = false) {
    if (value == null || !Number.isFinite(value)) return "—";
    return (exact ? currency2 : currency).format(value);
  }

  function formatPercent(value) {
    return value == null || !Number.isFinite(value) ? "—" : percent.format(value);
  }

  function safeNumber(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function normalizeMonthScope(monthScope = state.selectedMonths) {
    if (typeof monthScope === "number") return new Set(Array.from({ length: Math.max(0, Math.min(12, monthScope)) }, (_, index) => index + 1));
    if (monthScope instanceof Set) return monthScope;
    return ALL_MONTHS;
  }

  function totalMonths(months, key, monthScope = state.selectedMonths) {
    if (!months) return 0;
    const selected = normalizeMonthScope(monthScope);
    if (!selected.size) return 0;
    const details = Object.keys(months).some(month => Number(month) >= 1 && Number(month) <= 12);
    const annual = months["0"];
    if (key == null && annual != null && (!details || (selected.size === 12 && safeNumber(annual) !== 0))) return safeNumber(annual);
    let total = 0;
    for (const [month, values] of Object.entries(months)) {
      const m = Number(month);
      if (selected.has(m)) total += safeNumber(typeof values === "number" ? values : values[key]);
    }
    if (selected.size === 12 && annual != null && key != null) total += safeNumber(typeof annual === "number" ? 0 : annual[key]);
    return total;
  }

  function actualTotal(record, metric, monthScope = state.selectedMonths) {
    return record ? totalMonths(record.months, metric, monthScope) : 0;
  }

  function targetTotal(record, monthScope = state.selectedMonths) {
    return record ? totalMonths(record.months, null, monthScope) : 0;
  }

  function consultantKey(consultantId, supervisorId) {
    return `${consultantId}${CONSULTANT_KEY_SEPARATOR}${supervisorId || "__sem_supervisor__"}`;
  }

  function splitConsultantKey(value) {
    const parts = String(value || "").split(CONSULTANT_KEY_SEPARATOR);
    return parts.length > 1 ? { consultantId: parts[0], supervisorId: parts.slice(1).join(CONSULTANT_KEY_SEPARATOR) } : { consultantId: parts[0] || "", supervisorId: "" };
  }

  function monthLabel(months = state.selectedMonths) {
    const selected = [...normalizeMonthScope(months)].sort((a, b) => a - b);
    if (!selected.length) return "Nenhum mês";
    if (selected.length === 12) return "Todos os meses";
    if (selected.every((month, index) => index === 0 || month === selected[index - 1] + 1)) {
      return selected.length === 1 ? MONTH_NAMES[selected[0] - 1] : `${MONTH_NAMES[selected[0] - 1]}–${MONTH_NAMES[selected[selected.length - 1] - 1]}`;
    }
    return `${selected.length} meses selecionados`;
  }

  function hasAmount(record, metric, monthScope = state.selectedMonths) {
    if (!record) return false;
    const selected = normalizeMonthScope(monthScope);
    return Object.entries(record.months || {}).some(([month, value]) => {
      const numberMonth = Number(month);
      const included = selected.has(numberMonth) || (numberMonth === 0 && selected.size === 12);
      return included && (safeNumber(value[metric]) !== 0 || value[metric + "Rows"] > 0);
    });
  }

  function renderMonthOptions() {
    elements.monthOptions.innerHTML = MONTH_NAMES.map((month, index) => `<label class="month-option"><input type="checkbox" value="${index + 1}"${state.selectedMonths.has(index + 1) ? " checked" : ""}><span>${month}</span></label>`).join("");
    elements.monthOptions.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
      state.selectedMonths = new Set([...elements.monthOptions.querySelectorAll("input:checked")].map(item => Number(item.value)));
      state.monthSelectionTouched = true;
      updateMonthSummary();
      renderDashboard();
    }));
    updateMonthSummary();
  }

  function updateMonthSummary() {
    if (elements.monthSummary) elements.monthSummary.textContent = monthLabel();
  }

  function setSelectedMonths(months) {
    state.selectedMonths = new Set(months);
    if (elements.monthOptions) elements.monthOptions.querySelectorAll("input").forEach(input => { input.checked = state.selectedMonths.has(Number(input.value)); });
    updateMonthSummary();
  }

  function setDefaultMonthsForYear(year) {
    const max = maxActualMonth(year);
    setSelectedMonths(max ? Array.from({ length: max }, (_, index) => index + 1) : ALL_MONTHS);
  }

  function mergeActual(incoming) {
    for (const row of incoming) {
      const consultantId = normalizeId(row.consultantId);
      const supervisorId = normalizeId(row.supervisorId) || "__sem_supervisor__";
      const key = `${row.year}|${consultantId}|${supervisorId}`;
      if (!state.actuals.has(key)) {
        state.actuals.set(key, { ...row, consultantId, supervisorId, months: {} });
      }
      const target = state.actuals.get(key);
      target.consultantName = row.consultantName || target.consultantName;
      target.supervisorName = row.supervisorName || target.supervisorName;
      for (const [month, values] of Object.entries(row.months || {})) {
        if (!target.months[month]) target.months[month] = { sales: 0, revenue: 0, salesRows: 0, revenueRows: 0 };
        target.months[month].sales += safeNumber(values.sales);
        target.months[month].revenue += safeNumber(values.revenue);
        target.months[month].salesRows += safeNumber(values.salesRows);
        target.months[month].revenueRows += safeNumber(values.revenueRows);
      }
      if (row.consultantName) state.consultantNames.set(consultantId, row.consultantName);
      if (row.supervisorName) state.supervisorNames.set(supervisorId, row.supervisorName);
    }
  }

  function mergeTargets(incoming) {
    for (const row of incoming) {
      const id = normalizeId(row.id);
      const key = `${row.scope}|${row.year}|${id}`;
      if (!state.targets.has(key)) state.targets.set(key, { ...row, id, months: {} });
      const target = state.targets.get(key);
      target.name = row.name || target.name;
      // If the same month appears in a later file, use its latest value instead of counting it twice.
      for (const [month, value] of Object.entries(row.months || {})) target.months[month] = safeNumber(value);
      if (row.scope === "supervisor" && row.name) state.supervisorNames.set(id, row.name);
      if (row.scope === "consultor" && row.name) state.consultantNames.set(id, row.name);
    }
  }

  function mergeMappings(incoming) {
    for (const row of incoming) {
      const consultantId = normalizeId(row.consultantId);
      const supervisorId = normalizeId(row.supervisorId);
      if (!consultantId || !supervisorId) continue;
      const year = Number.isFinite(Number(row.year)) && Number(row.year) > 0 ? Number(row.year) : null;
      const key = `${year || "*"}|${consultantId}|${supervisorId}`;
      if (!state.mappings.has(key)) state.mappings.set(key, { ...row, consultantId, supervisorId, year });
      const entry = state.mappings.get(key);
      entry.consultantName = row.consultantName || entry.consultantName;
      entry.supervisorName = row.supervisorName || entry.supervisorName;
      if (row.consultantName) state.consultantNames.set(consultantId, row.consultantName);
      if (row.supervisorName) state.supervisorNames.set(supervisorId, row.supervisorName);
    }
  }

  function fingerprint(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function showLoading(title, description) {
    let overlay = document.querySelector(".loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "loading-overlay";
      overlay.setAttribute("role", "status");
      overlay.innerHTML = '<div class="loading-card"><h3 class="loading-title"></h3><p class="loading-description"></p><div class="loading-progress"><span></span></div></div>';
      document.body.append(overlay);
    }
    overlay.querySelector(".loading-title").textContent = title;
    overlay.querySelector(".loading-description").textContent = description;
    overlay.hidden = false;
  }

  function updateLoading(description) {
    const node = document.querySelector(".loading-description");
    if (node) node.textContent = description;
  }

  function hideLoading() {
    const overlay = document.querySelector(".loading-overlay");
    if (overlay) overlay.remove();
  }

  function toast(message, isError = false) {
    let node = document.querySelector(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.append(node);
    }
    node.className = `toast${isError ? " error" : ""}`;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 5200);
  }

  function processFile(file) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("./parser-worker.js");
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      worker.onmessage = event => {
        const message = event.data || {};
        if (message.requestId && message.requestId !== requestId) return;
        if (message.type === "progress") updateLoading(`${file.name}: ${message.detail}`);
        if (message.type === "done") { worker.terminate(); resolve(message.result); }
        if (message.type === "error") { worker.terminate(); reject(new Error(message.message)); }
      };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message || "Não foi possível carregar o leitor de Excel.")); };
      worker.postMessage({ file, requestId });
    });
  }

  async function handleFiles(fileList) {
    const files = [...fileList].filter(file => /\.(xlsx|xls|xlsm|csv)$/i.test(file.name));
    const unique = files.filter(file => !state.fingerprints.has(fingerprint(file)));
    if (!unique.length) {
      toast(files.length ? "Esse arquivo já foi carregado." : "Selecione um arquivo Excel ou CSV.", !files.length);
      return;
    }
    let loaded = 0;
    showLoading("Lendo as planilhas", `Processamento local no navegador. Iniciando ${unique.length} arquivo(s)…`);
    for (const file of unique) {
      try {
        const result = await processFile(file);
        mergeActual(result.actuals || []);
        mergeTargets(result.targets || []);
        mergeMappings(result.mappings || []);
        state.sourceFiles.push({ name: file.name, stats: result.stats || {}, actualYears: result.actualYears || [], targetYears: result.targetYears || [] });
        state.fingerprints.add(fingerprint(file));
        loaded++;
      } catch (error) {
        toast(`${file.name}: ${error.message || "falha ao ler o arquivo"}`, true);
      }
    }
    hideLoading();
    if (loaded) {
      refreshYearOptions();
      renderDashboard();
      toast(`${loaded} arquivo(s) carregado(s) com sucesso.`);
    } else if (!state.actuals.size && !state.targets.size) {
      renderDashboard();
    }
  }

  fileInputs.forEach(input => input.addEventListener("change", event => {
    const files = event.target.files;
    if (files && files.length) handleFiles(files);
    event.target.value = "";
  }));

  function refreshYearOptions() {
    const years = new Set();
    for (const row of state.actuals.values()) years.add(Number(row.year));
    for (const row of state.targets.values()) years.add(Number(row.year));
    state.years = [...years].filter(year => Number.isFinite(year)).sort((a, b) => a - b);
    const current = Number(elements.year.value);
    const selected = state.years.includes(current) ? current : (state.years.includes(2026) ? 2026 : (state.years[state.years.length - 1] || 2026));
    state.selectedYear = selected;
    elements.year.innerHTML = (state.years.length ? state.years : [2026]).map(year => `<option value="${year}">${year}</option>`).join("");
    elements.year.value = String(selected);
    if (!state.monthSelectionTouched) setDefaultMonthsForYear(selected);
  }

  function actualRows(year) {
    return [...state.actuals.values()].filter(row => Number(row.year) === Number(year));
  }

  function actualRowsByYear(year, predicate) {
    return [...state.actuals.values()].filter(row => Number(row.year) === Number(year) && (!predicate || predicate(row)));
  }

  function targetRecord(scope, id, year) {
    return state.targets.get(`${scope}|${year}|${normalizeId(id)}`) || null;
  }

  function maxActualMonth(year, predicate = null) {
    let max = 0;
    for (const row of actualRowsByYear(year, predicate)) {
      for (const month of Object.keys(row.months || {})) {
        const value = Number(month);
        if (value >= 1 && value <= 12) max = Math.max(max, value);
      }
    }
    return max;
  }

  function hasComparableMonths(year) {
    if (!state.selectedMonths.size) return false;
    const currentMax = maxActualMonth(year);
    const previousMax = maxActualMonth(year - 1);
    return currentMax > 0 && previousMax > 0 && [...state.selectedMonths].every(month => month <= currentMax && month <= previousMax);
  }

  function actualValue(year, metric, monthScope = state.selectedMonths, predicate = null) {
    let total = 0;
    let found = false;
    for (const row of actualRowsByYear(year, predicate)) {
      const value = actualTotal(row, metric, monthScope);
      if (value !== 0 || hasAmount(row, metric, monthScope)) found = true;
      total += value;
    }
    return { value: total, found };
  }

  function hasYearData(year) {
    return actualRows(year).length > 0;
  }

  function getTarget(scope, id, year, monthScope = state.selectedMonths) {
    return targetTotal(targetRecord(scope, id, year), monthScope);
  }

  function sumTargetRows(scope, year, predicate = null, monthScope = state.selectedMonths) {
    let value = 0;
    let found = false;
    for (const row of state.targets.values()) {
      if (row.scope !== scope || Number(row.year) !== Number(year) || (predicate && !predicate(row))) continue;
      value += targetTotal(row, monthScope);
      found = true;
    }
    return { value, found };
  }

  function managerName(id, year) {
    if (id === "__sem_supervisor__") return "Sem supervisor";
    const rows = actualRowsByYear(year, row => row.supervisorId === id);
    const target = targetRecord("supervisor", id, year);
    return (rows.find(row => row.supervisorName)?.supervisorName || target?.name || state.supervisorNames.get(id) || `Supervisor ${id}`).trim();
  }

  function consultantName(id, year, supervisorId = null) {
    const rows = actualRowsByYear(year, row => row.consultantId === id && (!supervisorId || row.supervisorId === supervisorId));
    const target = targetRecord("consultor", id, year);
    return (rows.find(row => row.consultantName)?.consultantName || target?.name || state.consultantNames.get(id) || `Consultor ${id}`).trim();
  }

  function managerChoices(year) {
    const ids = new Set();
    actualRows(year).forEach(row => ids.add(row.supervisorId));
    for (const row of state.targets.values()) if (row.scope === "supervisor" && Number(row.year) === Number(year)) ids.add(row.id);
    for (const row of state.targets.values()) {
      if (row.scope !== "consultor" || Number(row.year) !== Number(year)) continue;
      const choices = mappingChoices(row.id, year);
      if (choices.length) choices.forEach(choice => ids.add(choice.id));
      else ids.add("__sem_supervisor__");
    }
    return [...ids].filter(Boolean).map(id => ({ id, name: managerName(id, year) })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function mappingChoices(consultantId, year) {
    const exact = actualRowsByYear(year, row => row.consultantId === consultantId);
    const found = new Map();
    for (const row of exact) if (row.supervisorId) found.set(row.supervisorId, row.supervisorName || managerName(row.supervisorId, year));
    if (found.size) return [...found].map(([id, name]) => ({ id, name }));

    const yearMappings = [...state.mappings.values()].filter(row => row.consultantId === consultantId && Number(row.year) === Number(year));
    const applicable = yearMappings.length ? yearMappings : [...state.mappings.values()].filter(row => row.consultantId === consultantId && row.year == null);
    for (const row of applicable) if (!found.has(row.supervisorId)) found.set(row.supervisorId, row.supervisorName || state.supervisorNames.get(row.supervisorId) || `Supervisor ${row.supervisorId}`);
    // An unscoped code with multiple possible managers is ambiguous. Keep it unassigned
    // instead of borrowing a relation from another year or placing it under each manager.
    if (!yearMappings.length && found.size > 1) return [];
    if (found.size) return [...found].map(([id, name]) => ({ id, name }));
    return [];
  }

  function fillFilters() {
    const year = Number(elements.year.value || state.selectedYear || 2026);
    const chosenSupervisor = elements.supervisor.value;
    const chosenConsultant = elements.consultant.value;
    const managers = managerChoices(year);
    elements.supervisor.innerHTML = '<option value="">Todos os supervisores</option>' + managers.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join("");
    if (managers.some(row => row.id === chosenSupervisor)) elements.supervisor.value = chosenSupervisor;

    const consultantEntries = new Map();
    const addConsultant = (id, managerId) => {
      const key = consultantKey(id, managerId);
      if (!consultantEntries.has(key)) consultantEntries.set(key, { id, managerId, key });
    };
    for (const row of actualRows(year)) addConsultant(row.consultantId, row.supervisorId);
    for (const row of state.targets.values()) {
      if (row.scope !== "consultor" || Number(row.year) !== year) continue;
      const choices = mappingChoices(row.id, year);
      if (choices.length) choices.forEach(choice => addConsultant(row.id, choice.id));
      else addConsultant(row.id, "__sem_supervisor__");
    }
    for (const id of new Set([...state.mappings.values()].map(row => row.consultantId))) {
      if (actualRowsByYear(year, row => row.consultantId === id).length || targetRecord("consultor", id, year)) continue;
      const choices = mappingChoices(id, year);
      choices.forEach(choice => addConsultant(id, choice.id));
    }
    let consultants = [...consultantEntries.values()];
    const managerFilter = elements.supervisor.value;
    if (managerFilter) consultants = consultants.filter(row => row.managerId === managerFilter);
    const duplicateIds = new Set(consultants.filter(row => consultants.filter(item => item.id === row.id).length > 1).map(row => row.id));
    consultants = consultants.map(row => {
      const managerNameText = managerName(row.managerId, year);
      const name = consultantName(row.id, year, row.managerId);
      return { ...row, name: duplicateIds.has(row.id) ? `${name} · ${managerNameText}` : name };
    }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    elements.consultant.innerHTML = '<option value="">Todos os consultores</option>' + consultants.map(row => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.name)}</option>`).join("");
    if (consultants.some(row => row.key === chosenConsultant)) elements.consultant.value = chosenConsultant;
  }

  function buildConsultantSummaries(year, managerId = null) {
    const previousYear = year - 1;
    const ids = new Set(actualRows(year).map(row => row.consultantId));
    for (const row of state.targets.values()) if (row.scope === "consultor" && Number(row.year) === year) ids.add(row.id);
    for (const row of state.mappings.values()) if (mappingChoices(row.consultantId, year).length) ids.add(row.consultantId);
    const summaries = [];
    for (const id of ids) {
      const current = actualRowsByYear(year, row => row.consultantId === id);
      let managers = [...new Set(current.map(row => row.supervisorId).filter(Boolean))];
      if (!managers.length) managers = mappingChoices(id, year).map(row => row.id);
      if (!managers.length) managers = ["__sem_supervisor__"];
      if (managerId) managers = managers.includes(managerId) ? [managerId] : [];
      if (!managers.length) continue;
      const meta = targetRecord("consultor", id, year);
      const managerSales = managers.map(idManager => {
        const rows = current.filter(row => row.supervisorId === idManager);
        const lastMonth = rows.reduce((latest, row) => Math.max(latest, ...Object.entries(row.months || {}).filter(([, value]) => safeNumber(value.sales) !== 0 || value.salesRows > 0).map(([month]) => Number(month))), 0);
        return { id: idManager, lastMonth, sales: rows.reduce((sum, row) => sum + actualTotal(row, "sales", ALL_MONTHS), 0) };
      });
      const yearMapping = [...state.mappings.values()].filter(row => row.consultantId === id && Number(row.year) === Number(year));
      const explicitOwner = yearMapping.length === 1 ? managerSales.find(row => row.id === yearMapping[0].supervisorId)?.id : null;
      const metaOwner = explicitOwner || managerSales.slice().sort((a, b) => b.lastMonth - a.lastMonth || b.sales - a.sales || a.id.localeCompare(b.id))[0]?.id || managers[0];
      for (const idManager of managers) {
        const currentRows = current.filter(row => row.supervisorId === idManager);
        const priorRows = actualRowsByYear(previousYear, row => row.consultantId === id && row.supervisorId === idManager);
        const previousAnnual = priorRows.reduce((sum, row) => sum + actualTotal(row, "sales", ALL_MONTHS), 0);
        const previousComparable = priorRows.reduce((sum, row) => sum + actualTotal(row, "sales"), 0);
        const currentComparable = currentRows.reduce((sum, row) => sum + actualTotal(row, "sales"), 0);
        const currentSale = currentRows.reduce((sum, row) => sum + actualTotal(row, "sales"), 0);
        const revenue = currentRows.reduce((sum, row) => sum + actualTotal(row, "revenue"), 0);
        const ownsTarget = !!meta && idManager === metaOwner;
        const metaPeriod = ownsTarget ? targetTotal(meta) : 0;
        const metaAnnual = ownsTarget ? targetTotal(meta, ALL_MONTHS) : 0;
        const comparisonPreviousAnnual = maxActualMonth(previousYear) >= 12;
        summaries.push({
          id, key: consultantKey(id, idManager), name: consultantName(id, year, idManager), managerId: idManager,
          managerName: managerName(idManager, year),
          sales: currentSale, hasSales: currentRows.some(row => hasAmount(row, "sales")),
          revenue, hasRevenue: currentRows.some(row => hasAmount(row, "revenue")),
          target: metaPeriod, annualTarget: metaAnnual, hasTarget: ownsTarget,
          attainment: metaPeriod ? currentSale / metaPeriod : null,
          expectedGrowth: ownsTarget && previousAnnual > 0 && comparisonPreviousAnnual ? metaAnnual / previousAnnual - 1 : null,
          realizedGrowth: previousComparable > 0 && hasComparableMonths(year) ? currentComparable / previousComparable - 1 : null,
          currentComparable, previousComparable, previousAnnual,
          months: actualMonthsForConsultant(id, year, idManager), metaMonths: ownsTarget ? meta?.months || {} : {}
        });
      }
    }
    return summaries;
  }

  function actualMonthsForConsultant(id, year, managerId = null) {
    const months = {};
    for (const row of actualRowsByYear(year, item => item.consultantId === id && (!managerId || item.supervisorId === managerId))) {
      for (const [month, values] of Object.entries(row.months || {})) {
        if (!months[month]) months[month] = { sales: 0, revenue: 0 };
        months[month].sales += safeNumber(values.sales);
        months[month].revenue += safeNumber(values.revenue);
      }
    }
    return months;
  }

  function managerSummary(id, year, consultantSummaries = null) {
    const previousYear = year - 1;
    const currentRows = actualRowsByYear(year, row => row.supervisorId === id);
    const previousRows = actualRowsByYear(previousYear, row => row.supervisorId === id);
    const target = targetRecord("supervisor", id, year);
    const children = consultantSummaries || buildConsultantSummaries(year, id);
    const childTarget = children.filter(row => row.managerId === id && row.hasTarget).reduce((sum, row) => sum + row.target, 0);
    const childAnnualTarget = children.filter(row => row.managerId === id && row.hasTarget).reduce((sum, row) => sum + row.annualTarget, 0);
    const sale = currentRows.reduce((sum, row) => sum + actualTotal(row, "sales"), 0);
    const revenue = currentRows.reduce((sum, row) => sum + actualTotal(row, "revenue"), 0);
    const priorAnnual = previousRows.reduce((sum, row) => sum + actualTotal(row, "sales", ALL_MONTHS), 0);
    const currentComparable = sale;
    const priorComparable = previousRows.reduce((sum, row) => sum + actualTotal(row, "sales"), 0);
    const goal = target ? targetTotal(target) : childTarget;
    const annualGoal = target ? targetTotal(target, ALL_MONTHS) : childAnnualTarget;
    const isTargetFound = !!target || children.some(row => row.managerId === id && row.hasTarget);
    return {
      id, name: managerName(id, year), sales: sale, hasSales: currentRows.some(row => hasAmount(row, "sales")),
      revenue, hasRevenue: currentRows.some(row => hasAmount(row, "revenue")), target: goal, annualTarget: annualGoal, hasTarget: isTargetFound,
      attainment: goal ? sale / goal : null,
      expectedGrowth: annualGoal && priorAnnual > 0 && maxActualMonth(previousYear) >= 12 ? annualGoal / priorAnnual - 1 : null,
      realizedGrowth: priorComparable > 0 && hasComparableMonths(year) ? currentComparable / priorComparable - 1 : null,
      currentComparable, priorComparable, priorAnnual
    };
  }

  function managerChildRows(managerId, year, allConsultants) {
    return allConsultants.filter(row => row.managerId === managerId).sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name, "pt-BR"));
  }

  function filterSummaries(year) {
    const query = elements.search.value.trim().toLocaleLowerCase("pt-BR");
    const supervisorId = elements.supervisor.value;
    const consultantKeyFilter = elements.consultant.value;
    const managers = managerChoices(year).filter(row => !supervisorId || row.id === supervisorId);
    const consultantSummaries = buildConsultantSummaries(year, supervisorId || null);
    const visibleManagers = managers.map(item => ({ ...item, ...managerSummary(item.id, year, consultantSummaries) }));
    return visibleManagers.map(manager => {
      let children = managerChildRows(manager.id, year, consultantSummaries);
      if (consultantKeyFilter) children = children.filter(row => row.key === consultantKeyFilter);
      if (query) children = children.filter(row => `${row.name} ${row.id} ${manager.name}`.toLocaleLowerCase("pt-BR").includes(query));
      const managerMatches = !query || `${manager.name} ${manager.id}`.toLocaleLowerCase("pt-BR").includes(query);
      if (query && !managerMatches && !children.length) return null;
      return { ...manager, children };
    }).filter(Boolean);
  }

  function visibleConsultants(groups) {
    return groups.flatMap(group => group.children);
  }

  function selectedContext(year, groups) {
    const consultantKeyFilter = elements.consultant.value;
    const managerId = elements.supervisor.value;
    if (consultantKeyFilter) {
      const row = visibleConsultants(groups).find(item => item.key === consultantKeyFilter);
      if (row) return { scope: "consultor", row, predicate: actual => actual.consultantId === row.id && actual.supervisorId === row.managerId };
    }
    if (managerId) {
      const row = groups.find(item => item.id === managerId);
      if (row) return { scope: "supervisor", row, predicate: actual => actual.supervisorId === managerId };
    }
    const sale = actualValue(year, "sales");
    const revenue = actualValue(year, "revenue");
    const target = sumTargetRows("supervisor", year);
    const allConsultantsTarget = sumTargetRows("consultor", year);
    const selectedTarget = target.found ? target : allConsultantsTarget;
    const targetAnnual = sumTargetRows("supervisor", year, null, ALL_MONTHS);
    const allConsultantsAnnualTarget = sumTargetRows("consultor", year, null, ALL_MONTHS);
    const selectedAnnualTarget = targetAnnual.found ? targetAnnual : allConsultantsAnnualTarget;
    const priorFull = actualValue(year - 1, "sales", ALL_MONTHS);
    const priorComparable = actualValue(year - 1, "sales");
    const currentComparable = actualValue(year, "sales");
    const hasFullPrevious = maxActualMonth(year - 1) >= 12;
    return {
      scope: "total", row: {
        sales: sale.value, hasSales: sale.found, revenue: revenue.value, hasRevenue: revenue.found,
        target: selectedTarget.value, annualTarget: selectedAnnualTarget.value, hasTarget: selectedTarget.found,
        attainment: selectedTarget.value ? sale.value / selectedTarget.value : null,
        expectedGrowth: selectedAnnualTarget.value && priorFull.value > 0 && hasFullPrevious ? selectedAnnualTarget.value / priorFull.value - 1 : null,
        realizedGrowth: priorComparable.value > 0 && hasComparableMonths(year) ? currentComparable.value / priorComparable.value - 1 : null,
        currentComparable: currentComparable.value, priorComparable: priorComparable.value,
        priorAnnual: priorFull.value
      }, predicate: null
    };
  }

  function updateKpis(year, context) {
    const row = context.row;
    $("kpiSales").textContent = row.hasSales ? formatMoney(row.sales) : "—";
    $("kpiTarget").textContent = row.hasTarget ? formatMoney(row.target) : "—";
    $("kpiAttainment").textContent = row.attainment == null ? "—" : formatPercent(row.attainment);
    $("kpiRevenue").textContent = row.hasRevenue ? formatMoney(row.revenue) : "—";
    $("attainmentBar").style.width = `${Math.max(0, Math.min(100, (row.attainment || 0) * 100))}%`;
    $("attainmentLabel").textContent = row.attainment == null ? "Meta não encontrada" : row.attainment >= 1 ? "Meta atingida" : "Em andamento";
    const period = monthLabel();
    $("kpiTargetNote").textContent = row.hasTarget ? `${year} · ${period}` : "Sem meta nesse nível";
    const goalHasMonths = targetRecordsForContext(year, context).some(record => Object.keys(record.months || {}).some(month => Number(month) >= 1 && Number(month) <= 12));
    $("kpiTargetLabel").textContent = state.selectedMonths.size === 12 ? "Meta do ano" : goalHasMonths ? "Meta dos meses" : "Meta anual";
    $("kpiTargetDescription").textContent = goalHasMonths && state.selectedMonths.size < 12 ? "Meta somada nos meses selecionados" : "Meta anual consolidada";
    $("kpiAttainmentLabel").textContent = state.selectedMonths.size === 12 || goalHasMonths ? "Venda ÷ meta selecionada" : "Venda do período ÷ meta anual";
    $("kpiSalesPeriod").textContent = `Vendas · ${period}`;
    $("kpiRevenuePeriod").textContent = `Faturamento · ${period}`;
    const previous = year - 1;
    $("growthExpected").textContent = formatPercent(row.expectedGrowth);
    $("growthRealized").textContent = formatPercent(row.realizedGrowth);
    $("growthExpectedNote").textContent = row.expectedGrowth == null ? `Meta anual ${year} ÷ venda anual ${previous} − 1` : `${formatMoney(row.annualTarget ?? row.target)} de meta anual ÷ ${formatMoney(row.priorAnnual)} de venda em ${previous}`;
    $("growthRealizedNote").textContent = row.realizedGrowth == null ? `Venda ${year} ÷ venda ${previous} em ${period}` : `${formatMoney(row.currentComparable)} em ${period} ÷ ${formatMoney(row.priorComparable)} nos mesmos meses de ${previous}`;
    $("comparisonPeriod").textContent = `Meses: ${period}`;
  }

  function targetRecordsForContext(year, context) {
    if (context.scope === "consultor") {
      const record = targetRecord("consultor", context.row.id, year);
      return record ? [record] : [];
    }
    if (context.scope === "supervisor") {
      const supervisorTarget = targetRecord("supervisor", context.row.id, year);
      if (supervisorTarget) return [supervisorTarget];
      return [...state.targets.values()].filter(row => row.scope === "consultor" && Number(row.year) === Number(year) && mappingChoices(row.id, year).some(item => item.id === context.row.id));
    }
    const supervisors = [...state.targets.values()].filter(row => row.scope === "supervisor" && Number(row.year) === Number(year));
    return supervisors.length ? supervisors : [...state.targets.values()].filter(row => row.scope === "consultor" && Number(row.year) === Number(year));
  }

  function svgText(x, y, text, cls = "axis-label", anchor = "start") {
    return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${escapeHtml(text)}</text>`;
  }

  function moneyShort(value) {
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${(value / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (abs >= 1000) return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
    return number.format(Math.round(value));
  }

  function annualChartData(year) {
    const years = [...new Set([...state.years, year])].sort((a,b)=>a-b);
    const supervisorFilter = elements.supervisor.value;
    const consultantFilter = splitConsultantKey(elements.consultant.value);
    return years.map(itemYear => {
      let sale = 0, revenue = 0, target = 0;
      let actualFound = false, targetFound = false;
      if (consultantFilter.consultantId) {
        const actual = actualValue(itemYear, "sales", state.selectedMonths, row => row.consultantId === consultantFilter.consultantId && row.supervisorId === consultantFilter.supervisorId);
        const meta = targetRecord("consultor", consultantFilter.consultantId, itemYear);
        const owner = buildConsultantSummaries(itemYear).find(row => row.id === consultantFilter.consultantId && row.managerId === consultantFilter.supervisorId);
        sale = actual.value; actualFound = actual.found;
        target = owner?.hasTarget ? targetTotal(meta) : 0; targetFound = !!owner?.hasTarget;
      } else if (supervisorFilter) {
        const actual = actualValue(itemYear, "sales", state.selectedMonths, row => row.supervisorId === supervisorFilter);
        const meta = targetRecord("supervisor", supervisorFilter, itemYear);
        sale = actual.value; actualFound = actual.found;
        target = targetTotal(meta); targetFound = !!meta;
        if (!targetFound) {
          const children = sumTargetRows("consultor", itemYear, row => mappingChoices(row.id, itemYear).some(m => m.id === supervisorFilter));
          target = children.value; targetFound = children.found;
        }
      } else {
        const actual = actualValue(itemYear, "sales");
        const meta = sumTargetRows("supervisor", itemYear);
        const repMeta = sumTargetRows("consultor", itemYear);
        sale = actual.value; actualFound = actual.found;
        target = meta.found ? meta.value : repMeta.value; targetFound = meta.found || repMeta.found;
      }
      return { year: itemYear, sale, revenue, target, actualFound, targetFound };
    });
  }

  function renderAnnualChart(year) {
    const data = annualChartData(year);
    if (!data.length) { elements.trendChart.innerHTML = '<div class="chart-empty">Carregue metas ou vendas para visualizar a evolução.</div>'; return; }
    const W = 800, H = 238, left = 57, right = 18, top = 18, bottom = 34;
    const plotW = W - left - right, plotH = H - top - bottom;
    const maxValue = Math.max(1, ...data.flatMap(item => [item.sale, item.target]));
      const tick = 10 ** Math.floor(Math.log10(maxValue / 4));
      const topValue = Math.ceil(maxValue / (tick * 4)) * tick * 4 || maxValue;
    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Comparação anual de venda e meta">`;
    for (let i = 0; i <= 4; i++) {
      const value = topValue * i / 4;
      const y = top + plotH - plotH * i / 4;
      svg += `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" class="gridline"/>${svgText(left-8,y+3,moneyShort(value),"axis-label","end")}`;
    }
    const groupW = plotW / data.length;
    data.forEach((item, index) => {
      const center = left + groupW * (index + .5);
      const barW = Math.min(27, groupW * .25);
      const salesH = item.sale / topValue * plotH;
      const targetH = item.target / topValue * plotH;
      const sx = center - barW - 3, tx = center + 3;
      svg += `<rect x="${sx}" y="${top+plotH-salesH}" width="${barW}" height="${Math.max(item.actualFound?2:0,salesH)}" rx="4" class="bar-sales${item.actualFound?"":" bar-empty"}"><title>${item.year} venda: ${escapeHtml(formatMoney(item.sale))}</title></rect>`;
      svg += `<rect x="${tx}" y="${top+plotH-targetH}" width="${barW}" height="${Math.max(item.targetFound?2:0,targetH)}" rx="4" class="bar-target${item.targetFound?"":" bar-empty"}"><title>${item.year} meta: ${escapeHtml(formatMoney(item.target))}</title></rect>`;
      svg += svgText(center, H-10, String(item.year), "year-label", "middle");
    });
    svg += `<line x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}" class="axis-line"/></svg>`;
    elements.trendChart.innerHTML = svg;
  }

  function targetForMonth(record, month) {
    if (!record) return 0;
    const value = record.months && record.months[String(month)];
    return value == null ? 0 : safeNumber(value);
  }

  function metricsForContext(year, context, month) {
    const monthScope = new Set([month]);
    if (context.scope === "consultor") {
      const rows = actualRowsByYear(year, row => row.consultantId === context.row.id && row.supervisorId === context.row.managerId);
      const target = targetRecord("consultor", context.row.id, year);
      return {
        sale: rows.reduce((sum,row)=>sum+actualTotal(row,"sales",monthScope),0),
        target: context.row.hasTarget ? targetForMonth(target, month) : 0,
        prior: actualValue(year-1,"sales",monthScope,row=>row.consultantId===context.row.id&&row.supervisorId===context.row.managerId).value
      };
    }
    if (context.scope === "supervisor") {
      const rows = actualRowsByYear(year, row => row.supervisorId === context.row.id);
      const target = targetRecord("supervisor", context.row.id, year);
      const childTargets = buildConsultantSummaries(year, context.row.id).filter(row=>row.hasTarget).reduce((sum,row)=>sum+targetForMonth(targetRecord("consultor",row.id,year),month),0);
      return {
        sale: rows.reduce((sum,row)=>sum+actualTotal(row,"sales",monthScope),0),
        target: target ? targetForMonth(target, month) : childTargets,
        prior: actualValue(year-1,"sales",monthScope,row=>row.supervisorId===context.row.id).value
      };
    }
    const sale = actualValue(year,"sales",monthScope);
    const target = sumTargetRows("supervisor",year,null,monthScope);
    const repTarget = sumTargetRows("consultor",year,null,monthScope);
    return { sale:sale.value,target:target.found?target.value:repTarget.value,prior:actualValue(year-1,"sales",monthScope).value };
  }

  function renderMonthlyChart(year, context) {
    const W = 900, H = 286, left = 55, right = 12, top = 20, bottom = 38;
    const plotW = W-left-right, plotH = H-top-bottom;
    const points = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const current = metricsForContext(year, context, m);
      return { month:m, sale:Math.max(0,current.sale), target:Math.max(0,current.target), prior:Math.max(0,current.prior), selected:state.selectedMonths.has(m) };
    });
    const maxValue = Math.max(1,...points.flatMap(point=>[point.sale,point.target,point.prior]));
    const topValue = Math.ceil(maxValue / 4 / 1000000) * 1000000 * 4 || maxValue;
    const groupW=plotW/12, barW=Math.min(12,groupW*.2);
    let svg=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Comparação mensal de vendas, metas e ano anterior">`;
    for(let i=0;i<=4;i++){
      const value=topValue*i/4,y=top+plotH-plotH*i/4;
      svg+=`<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" class="gridline"/>${svgText(left-8,y+3,moneyShort(value),"axis-label","end")}`;
    }
    points.forEach((point,index)=>{
      const cx=left+groupW*(index+.5);const values=[["sale","bar-sales",cx-barW-7],["target","bar-target",cx-barW/2],["prior","bar-prior",cx+7]];
      for(const [key,cls,x] of values){
        const value=point[key],height=value/topValue*plotH;
        svg+=`<rect x="${x}" y="${top+plotH-height}" width="${barW}" height="${value?Math.max(2,height):1}" rx="3" class="${cls}${value?"":" bar-empty"}${point.selected?"":" month-unselected"}"><title>${MONTH_WORDS[point.month-1]}${point.selected?"":" (fora da seleção)"}: ${key==="sale"?"venda":key==="target"?"meta":"ano anterior"} ${escapeHtml(formatMoney(value))}</title></rect>`;
      }
      svg+=svgText(cx,H-12,MONTH_NAMES[index],"month-label","middle");
    });
    svg+=`<line x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}" class="axis-line"/></svg>`;
    elements.monthlyChart.innerHTML=svg;
  }

  function renderGrowthChart(groups) {
    const visible = groups.slice().sort((a,b)=>((b.realizedGrowth??-Infinity)-(a.realizedGrowth??-Infinity))||a.name.localeCompare(b.name,"pt-BR"));
    if (!visible.length) { elements.growthChart.innerHTML='<div class="chart-empty">Sem supervisores para comparar.</div>'; return; }
    const values=visible.flatMap(row=>[row.expectedGrowth,row.realizedGrowth]).filter(value=>value!=null&&Number.isFinite(value));
    if (!values.length) { elements.growthChart.innerHTML='<div class="chart-empty">Carregue a venda do ano anterior para calcular o crescimento.</div>'; return; }
    const maxAbs=Math.max(.1,...values.map(Math.abs));
    const minValue=Math.min(0,...values),maxValue=Math.max(0,...values);
    const low=Math.min(minValue,-maxAbs*.1),high=Math.max(maxValue,maxAbs*.1);
    const W=700,rowH=35,top=25,H=top+visible.length*rowH+12,left=135,right=74,plotW=W-left-right;
    const xFor=value=>left+(value-low)/(high-low)*plotW;
    const zero=xFor(0);
    let svg=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Crescimento esperado e realizado por supervisor">`;
    for(let i=0;i<=4;i++){
      const value=low+(high-low)*i/4,x=xFor(value);
      svg+=`<line x1="${x}" y1="${top-9}" x2="${x}" y2="${H-7}" class="${Math.abs(value)<.0001?"zero-line":"gridline"}"/>${svgText(x,12,formatPercent(value),"axis-label","middle")}`;
    }
    visible.forEach((row,index)=>{
      const y=top+index*rowH;
      svg+=svgText(left-10,y+13,row.name.length>19?row.name.slice(0,18)+"…":row.name,"axis-label","end");
      const items=[[row.expectedGrowth,"#e5a15e",y+2,"Perspectiva"],[row.realizedGrowth,"#2c8064",y+14,"Realizado"]];
      for(const [value,color,barY,label] of items){
        if(value==null){svg+=svgText(W-right+5,barY+8,"—","axis-label");continue;}
        const x=xFor(value),start=Math.min(zero,x),width=Math.max(1,Math.abs(x-zero));
        svg+=`<rect x="${start}" y="${barY}" width="${width}" height="7" rx="3" fill="${color}"><title>${escapeHtml(row.name)} · ${label}: ${escapeHtml(formatPercent(value))}</title></rect>`;
        svg+=svgText(W-right+5,barY+8,formatPercent(value),"value-label");
      }
    });
    svg+='</svg>';
    elements.growthChart.innerHTML=svg;
  }

  function renderRanking(groups) {
    const children=visibleConsultants(groups).filter(row=>row.hasSales).sort((a,b)=>b.sales-a.sales).slice(0,10);
    if(!children.length){elements.rankingChart.innerHTML='<div class="chart-empty">Carregue vendas realizadas para ver o ranking.</div>';return;}
    const maxValue=Math.max(1,...children.flatMap(row=>[row.sales,row.target||0]));
    elements.rankingChart.innerHTML=children.map((row,index)=>{
      const salesWidth=Math.min(100,row.sales/maxValue*100);
      const marker=row.hasTarget?Math.min(100,row.target/maxValue*100):0;
      const attainment=row.attainment==null?"Sem meta":formatPercent(row.attainment);
      return `<div class="ranking-item" title="${escapeHtml(row.name)} — ${escapeHtml(formatMoney(row.sales))} vendidos">
        <span class="ranking-name"><b>${String(index+1).padStart(2,"0")}</b> ${escapeHtml(row.name)}</span>
        <div class="ranking-meter"><span class="ranking-meter-fill" style="width:${salesWidth}%"></span>${row.hasTarget?`<i class="ranking-meta-marker" style="--marker:${marker}%" title="Meta: ${escapeHtml(formatMoney(row.target))}"></i>`:""}</div>
        <span class="ranking-value">${escapeHtml(moneyShort(row.sales))}<small>${escapeHtml(attainment)} da meta</small></span>
      </div>`;
    }).join("")+'<div class="rank-legend"><span class="legend-dot sales-dot"></span>Venda realizada <span class="legend-dot target-dot"></span>Meta indicada pela linha</div>';
  }

  function attainmentCell(row) {
    if (row.attainment == null) return '<span class="growth-neutral">—</span>';
    const width=Math.max(0,Math.min(100,row.attainment*100));
    return `<span class="attain-cell"><span>${escapeHtml(formatPercent(row.attainment))}${row.attainment>=1?'<i class="pill-over">Meta</i>':''}</span><span class="attain-mini"><span style="width:${width}%"></span></span></span>`;
  }

  function growthClass(value) {
    return value == null ? "growth-neutral" : value >= 0 ? "growth-positive" : "growth-negative";
  }

  function renderTable(groups, year) {
    const hasAny = groups.length > 0;
    elements.tableEmpty.hidden = hasAny;
    if(!hasAny){elements.detailRows.innerHTML="";return;}
    const allManagers=managerChoices(year);
    const query=elements.search.value.trim().toLocaleLowerCase("pt-BR");
    const consultantFilter=elements.consultant.value;
    let html="";
    for(const group of groups){
      const isCollapsed=state.collapsed.has(group.id);
      const salesRows=actualRowsByYear(year,row=>row.supervisorId===group.id);
      const childCount=new Set(salesRows.map(row=>row.consultantId)).size || group.children.length;
      const previousFull=maxActualMonth(year-1)>=12;
      html+=`<tr class="supervisor-row">
        <td><span class="name-cell"><button class="expand-button" data-toggle="${escapeHtml(group.id)}" aria-label="${isCollapsed?"Expandir":"Recolher"} ${escapeHtml(group.name)}">${isCollapsed?"+":"−"}</button><span class="entity-name">${escapeHtml(group.name)} <span class="entity-code">${escapeHtml(group.id==="__sem_supervisor__"?"":group.id)}</span></span></span></td>
        <td>${group.hasSales?escapeHtml(formatMoney(group.sales)):"—"}</td><td>${group.hasTarget?escapeHtml(formatMoney(group.target)):"—"}</td><td>${attainmentCell(group)}</td><td>${group.hasRevenue?escapeHtml(formatMoney(group.revenue)):"—"}</td>
        <td class="${growthClass(group.expectedGrowth)}">${escapeHtml(formatPercent(group.expectedGrowth))}</td><td class="${growthClass(group.realizedGrowth)}">${escapeHtml(formatPercent(group.realizedGrowth))}</td>
      </tr>`;
      if(isCollapsed) continue;
      for(const row of group.children){
        html+=`<tr class="consultant-row">
          <td><span class="name-cell"><span class="entity-name">${escapeHtml(row.name)} <span class="entity-code">${escapeHtml(row.id)}</span></span></span></td>
          <td>${row.hasSales?escapeHtml(formatMoney(row.sales)):"—"}</td><td>${row.hasTarget?escapeHtml(formatMoney(row.target)):"—"}</td><td>${attainmentCell(row)}</td><td>${row.hasRevenue?escapeHtml(formatMoney(row.revenue)):"—"}</td>
          <td class="${growthClass(row.expectedGrowth)}">${escapeHtml(formatPercent(row.expectedGrowth))}</td><td class="${growthClass(row.realizedGrowth)}">${escapeHtml(formatPercent(row.realizedGrowth))}</td>
        </tr>`;
      }
    }
    elements.detailRows.innerHTML=html;
    elements.detailRows.querySelectorAll("[data-toggle]").forEach(button=>button.addEventListener("click",()=>{
      const id=button.dataset.toggle;
      if(state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
      renderDashboard();
    }));
  }

  function renderQuality(year) {
    const previousYear=year-1;
    const hasPrev=hasYearData(previousYear);
    const currentMonth=maxActualMonth(year);
    const previousMonth=maxActualMonth(previousYear);
    const consultantTargets=[...state.targets.values()].some(row=>row.scope==="consultor"&&Number(row.year)===year);
    const hasSupervisorTargets=[...state.targets.values()].some(row=>row.scope==="supervisor"&&Number(row.year)===year);
    const messages=[];
    if(!hasPrev) messages.push(`<strong>Comparativo pendente:</strong> a base carregada não contém venda realizada de ${previousYear}. Carregue também o arquivo desse ano para calcular perspectiva e crescimento realizado.`);
    else if(previousMonth<12) messages.push(`<strong>Base parcial:</strong> a venda de ${previousYear} chega até ${MONTH_NAMES[Math.max(0,previousMonth-1)]}. A perspectiva anual fica indisponível até haver os 12 meses; o realizado compara ${monthLabel()} nos dois anos.`);
    if(hasPrev && !hasComparableMonths(year)) messages.push(`<strong>Comparação incompleta:</strong> a base não contém todos os meses selecionados nos dois anos; o crescimento realizado fica indisponível.`);
    if(!consultantTargets && hasSupervisorTargets) messages.push(`<strong>Meta por consultor ausente:</strong> neste ano há meta consolidada por supervisor, sem detalhamento de meta individual.`);
    const monthsLabel=currentMonth?`A base de ${year} contém movimentos até ${MONTH_NAMES[currentMonth-1]}.`:`Não há vendas realizadas em ${year} na base carregada.`;
    if(currentMonth && currentMonth<12) messages.push(`<strong>Base parcial:</strong> ${monthsLabel} Os indicadores usam ${monthLabel()} conforme o filtro; a perspectiva continua comparando a meta anual com a venda total do ano anterior.`);
    elements.dataQuality.hidden=!messages.length;
    elements.dataQuality.innerHTML=messages.join("<br>");
    const hint=[];
    if(!hasPrev) hint.push(`A base carregada não tem venda realizada de ${previousYear}; os dois indicadores de crescimento ficam sem valor até esse ano ser carregado.`);
    else if(previousMonth<12) hint.push(`A venda de ${previousYear} não chega a dezembro; a perspectiva anual fica sem valor. O crescimento realizado usa ${monthLabel()} nos dois anos.`);
    if(!consultantTargets && hasSupervisorTargets) hint.push(`A planilha tem metas por supervisor em ${year}, mas não metas individuais por consultor.`);
    elements.growthHint.hidden=!hint.length;
    elements.growthHint.textContent=hint.join(" ");
  }

  function updateDataStatus(year) {
    const actualYears=[...new Set([...state.actuals.values()].map(row=>Number(row.year)))].sort((a,b)=>a-b);
    const targetYears=[...new Set([...state.targets.values()].map(row=>Number(row.year)))].sort((a,b)=>a-b);
    elements.dataStatus.classList.add("ready");
    elements.dataStatus.innerHTML=`<span class="status-dot"></span> ${state.sourceFiles.length} arquivo(s) · ${actualYears.length?`vendas ${actualYears.join(", ")}`:"sem venda realizada"} · metas ${targetYears.join(", ")||"—"}`;
    elements.fileList.hidden=!state.sourceFiles.length;
    elements.fileList.innerHTML=state.sourceFiles.map(item=>`<span class="file-chip"><strong>${escapeHtml(item.name)}</strong>${item.stats?.actualRows?` · ${number.format(item.stats.actualRows)} linhas de venda`:""}${item.stats?.targetRows?` · ${number.format(item.stats.targetRows)} metas`:""}</span>`).join("");
  }

  function downloadCsv() {
    const year=Number(elements.year.value||state.selectedYear||2026);
    const groups=filterSummaries(year);
    const rows=[["Ano","Meses analisados","Nível","Supervisor","Código supervisor","Consultor","Código consultor","Venda realizada","Meta do período","Atingimento","Faturamento","Perspectiva anual de crescimento","Crescimento realizado"]];
    for(const group of groups){
      rows.push([year,monthLabel(),"Supervisor",group.name,group.id,"","",group.hasSales?group.sales:"",group.hasTarget?group.target:"",group.attainment??"",group.hasRevenue?group.revenue:"",group.expectedGrowth??"",group.realizedGrowth??""]);
      for(const child of group.children) rows.push([year,monthLabel(),"Consultor",group.name,group.id,child.name,child.id,child.hasSales?child.sales:"",child.hasTarget?child.target:"",child.attainment??"",child.hasRevenue?child.revenue:"",child.expectedGrowth??"",child.realizedGrowth??""]);
    }
    const csv="\uFEFF"+rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=`painel-comercial-${year}.csv`;link.style.display="none";document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(`CSV de ${year} gerado. Confira os downloads do navegador.`);
  }

  function renderDashboard() {
    const anyData=state.actuals.size>0||state.targets.size>0;
    elements.empty.hidden=anyData;
    elements.dashboard.hidden=!anyData;
    if(!anyData){
      elements.dataStatus.classList.remove("ready");
      elements.dataStatus.innerHTML='<span class="status-dot"></span> Aguardando planilha';
      elements.fileList.hidden=true;
      return;
    }
    const year=Number(elements.year.value||state.selectedYear||2026);
    state.selectedYear=year;
    fillFilters();
    const groups=filterSummaries(year);
    const context=selectedContext(year,groups);
    updateKpis(year,context);
    renderGrowthChart(groups);
    renderAnnualChart(year);
    renderMonthlyChart(year,context);
    renderRanking(groups);
    renderTable(groups,year);
    renderQuality(year);
    updateDataStatus(year);
    $("rankingPeriod").textContent=`${year} · ${monthLabel()}`;
  }

  elements.year.addEventListener("change",()=>{state.selectedYear=Number(elements.year.value);if(!state.monthSelectionTouched)setDefaultMonthsForYear(state.selectedYear);fillFilters();renderDashboard();});
  elements.supervisor.addEventListener("change",()=>{fillFilters();renderDashboard();});
  elements.consultant.addEventListener("change",renderDashboard);
  elements.search.addEventListener("input",renderDashboard);
  $("selectAllMonths").addEventListener("click",()=>{state.monthSelectionTouched=true;setSelectedMonths(ALL_MONTHS);renderDashboard();});
  $("clearMonths").addEventListener("click",()=>{state.monthSelectionTouched=true;setSelectedMonths([]);renderDashboard();});
  $("printButton").addEventListener("click",()=>window.print());
  $("exportButton").addEventListener("click",downloadCsv);
  document.querySelectorAll(".upload-button").forEach(label=>label.addEventListener("click",event=>{
    if(event.target instanceof HTMLInputElement)return;
  }));
  renderMonthOptions();
  renderDashboard();
})();
