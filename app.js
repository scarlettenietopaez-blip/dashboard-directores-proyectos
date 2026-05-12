const CONFIG = {
  dataUrl: "data/projects.csv",
  autoRefreshMinutes: 5,
  cacheBust: true,
  ...(window.DASHBOARD_CONFIG || {})
};

const COLORS = ["#0f4c81", "#0ea5e9", "#16a34a", "#f59e0b", "#dc2626", "#475569", "#7c3aed", "#0891b2"];
const today = new Date();
let allRecords = [];
let filtered = [];

const $ = (id) => document.getElementById(id);
const safe = (v) => (v ?? "").toString();
const esc = (v) => safe(v)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const slug = (v) => safe(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const daysBetween = (a, b) => Math.ceil((b - a) / (1000 * 60 * 60 * 24));
const fmtDate = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("es-EC", {day:"2-digit", month:"short", year:"numeric"}) : "Sin fecha";
const pluralDias = (n) => `${n} día${n === 1 ? "" : "s"}`;

function normalizeDate(value){
  const v = safe(value).trim();
  if(!v) return "";
  const lowered = slug(v).replace(/\s+/g, " ");
  if(["sin informacion", "sin infomacion", "n/a", "na", "no aplica", "sin fecha", "null", "undefined"].includes(lowered)) return "";

  // Fecha serial de Excel, por ejemplo 46107.
  if(/^\d{4,6}(\.\d+)?$/.test(v)){
    const serial = Number(v);
    if(serial > 20000 && serial < 80000){
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      return toISO(new Date(ms));
    }
  }

  // dd/mm/yyyy, dd-mm-yyyy o dd.mm.yyyy.
  let m = v.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if(m){
    let [, dd, mm, yy] = m;
    if(yy.length === 2) yy = "20" + yy;
    return `${yy.padStart(4,"0")}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }

  // yyyy-mm-dd o yyyy/mm/dd.
  m = v.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if(m){
    const [, yy, mm, dd] = m;
    return `${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }

  const parsed = new Date(v);
  if(!isNaN(parsed.getTime())) return toISO(parsed);
  return "";
}

function toISO(d){
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,"0");
  const dd = String(d.getUTCDate()).padStart(2,"0");
  return `${yy}-${mm}-${dd}`;
}

function compute(record){
  const estado = safe(record.estado || "EN CURSO").trim().toUpperCase();
  const directorBase = safe(record.director || record.responsable || record.tecnicoEncargado || record.tecnico || "").trim();
  const directores = Array.isArray(record.directores)
    ? record.directores.map(x => safe(x).trim()).filter(Boolean)
    : (directorBase ? directorBase.split(/\s+-\s+|;|,/).map(x => x.trim()).filter(Boolean) : []);

  const fechaInicial = normalizeDate(record.fechaInicial || record.fechaInicialOriginal);
  const fechaLimite = normalizeDate(record.fechaLimite || record.fechaLimiteOriginal);
  const fechaFinal = normalizeDate(record.fechaFinal || record.fechaFinalOriginal);

  const inicio = fechaInicial ? new Date(fechaInicial + "T00:00:00") : null;
  const limite = fechaLimite ? new Date(fechaLimite + "T00:00:00") : null;
  const final = fechaFinal ? new Date(fechaFinal + "T00:00:00") : null;
  const finalizado = ["FINALIZADO", "ARCHIVADO"].includes(estado);
  const fechaCorteProyecto = final || today;
  const diasGestion = inicio ? Math.max(0, daysBetween(inicio, today)) + 1 : null;
  const diasProyecto = inicio ? Math.max(0, daysBetween(inicio, fechaCorteProyecto)) + 1 : null;
  const corteProyecto = final ? "fecha final" : "fecha actual";
  const diasRestantes = limite ? daysBetween(today, limite) : null;
  let alerta = "AL DÍA";
  if(finalizado) alerta = "FINALIZADO";
  else if(!limite) alerta = "SIN FECHA LÍMITE";
  else if(diasRestantes < 0) alerta = "VENCIDO";
  else if(diasRestantes <= 7) alerta = "POR VENCER";
  return {...record, director: directorBase, directores, fechaInicial, fechaLimite, fechaFinal, estado, diasGestion, diasProyecto, corteProyecto, diasRestantes, alerta, finalizado};
}

function withCacheBust(url){
  if(!CONFIG.cacheBust) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

async function fetchText(url){
  const res = await fetch(withCacheBust(url), {cache: "no-store"});
  if(!res.ok) throw new Error(`No se pudo cargar ${url}: ${res.status}`);
  return await res.text();
}

function detectDelimiter(headerLine){
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for(const d of candidates){
    const count = splitCsvLine(headerLine, d).length;
    if(count > bestCount){ best = d; bestCount = count; }
  }
  return best;
}

function splitCsvLine(line, delimiter){
  const out = [];
  let cur = "";
  let inQuotes = false;
  for(let i=0; i<line.length; i++){
    const ch = line[i];
    const next = line[i+1];
    if(ch === '"'){
      if(inQuotes && next === '"'){ cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if(ch === delimiter && !inQuotes){
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(v => v.trim());
}

function csvToRows(text){
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = [];
  let cur = "";
  let inQuotes = false;
  for(let i=0; i<cleaned.length; i++){
    const ch = cleaned[i];
    const next = cleaned[i+1];
    if(ch === '"'){
      if(inQuotes && next === '"'){ cur += ch + next; i++; }
      else { inQuotes = !inQuotes; cur += ch; }
    } else if(ch === "\n" && !inQuotes){
      if(cur.trim()) lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if(cur.trim()) lines.push(cur);
  if(!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(h => h.trim());
  return lines.slice(1).map((line, idx) => {
    const values = splitCsvLine(line, delimiter);
    const obj = { id: idx + 1 };
    headers.forEach((h, i) => { obj[h] = values[i] ?? ""; });
    return obj;
  });
}

function col(row, ...names){
  const keys = Object.keys(row);
  for(const name of names){
    const found = keys.find(k => slug(k).replace(/\s+/g, " ") === slug(name).replace(/\s+/g, " "));
    if(found !== undefined) return row[found];
  }
  return "";
}

function mapCsvRow(row){
  const referencia = col(row, "REFERENCIA GENERAL");
  const fechaInicial = col(row, "FECHA INICIAL");
  const fechaLimite = col(row, "FECHA LIMITE", "FECHA LÍMITE");
  const noTramite = col(row, "No TRAMITE", "NRO TRAMITE", "NRO. TRAMITE", "NÚMERO DE TRÁMITE");
  const descripcion = col(row, "DESCRIPCION GENERAL", "DESCRIPCIÓN GENERAL");
  const objetivo = col(row, "OBJETIVO GENERAL");
  const director = col(row, "TECNICO ENCARGADO", "TÉCNICO ENCARGADO", "DIRECTOR");
  const direccion = col(row, "DIRECCION", "DIRECCIÓN");
  const observacion = col(row, "OBSERVACION", "OBSERVACIÓN");

  return {
    id: col(row, "ID") || row.id,
    direccion,
    referencia,
    proyecto: referencia,
    objetivo,
    noTramite,
    descripcion,
    director,
    fechaInicial,
    fechaInicialOriginal: fechaInicial,
    fechaLimite,
    fechaLimiteOriginal: fechaLimite,
    fechaFinal: col(row, "FECHA FINAL"),
    fechaFinalOriginal: col(row, "FECHA FINAL"),
    estado: col(row, "ESTADO"),
    observacion,
    entidadActual: col(row, "ENTIDAD ACTUAL")
  };
}

function hasProjectData(record){
  // Evita contar filas vacías que Excel exporta por formato, tabla extendida o fórmulas.
  // No usamos ESTADO, FECHAS, DIRECCIÓN ni ENTIDAD como señal, porque esas columnas pueden quedar
  // autollenadas en filas vacías y provocar conteos como 999 registros.
  const mainFields = [
    record.referencia,
    record.noTramite,
    record.descripcion,
    record.objetivo
  ].map(v => safe(v).trim());

  const hasMainIdentifier = mainFields.some(v => v !== "");

  // También descartamos filas con textos típicos de fórmula/placeholder.
  const combined = slug(mainFields.join(" ")).trim();
  const placeholders = new Set(["", "0", "n/a", "na", "sin informacion", "sin infomacion", "no aplica", "undefined", "null"]);

  return hasMainIdentifier && !placeholders.has(combined);
}

async function fetchData(url){
  const text = await fetchText(url);
  if(url.toLowerCase().includes(".csv")){
    const records = csvToRows(text)
      .map(mapCsvRow)
      .filter(hasProjectData)
      .map((r, idx) => ({...r, id: safe(r.id).trim() || idx + 1}));
    return {updatedAt: new Date().toISOString().slice(0,10), records};
  }
  const payload = JSON.parse(text);
  if(Array.isArray(payload)) return {updatedAt: new Date().toISOString().slice(0,10), records: payload};
  return payload;
}

async function loadData(){
  const payload = await fetchData(CONFIG.dataUrl);

  allRecords = (payload.records || payload.projects || []).map(compute);
  filtered = [...allRecords];
  $("lastUpdate").textContent = fmtDate(payload.updatedAt || new Date().toISOString().slice(0,10));
  $("recordCount").textContent = `${allRecords.length} registros cargados`;
  initTabs();
  initProjectSearch();
  renderAll();
  renderProjectResults();
}

function initTabs(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
    });
  });
}

function uniqueValues(field, explode=false){
  const set = new Set();
  allRecords.forEach(r => {
    if(explode) (r[field] || []).forEach(x => x && set.add(x));
    else if(r[field]) set.add(r[field]);
  });
  return [...set].sort((a,b)=>a.localeCompare(b, 'es'));
}

function fillSelect(el, values, label){
  el.innerHTML = `<option value="">${esc(label)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}

function projectLabel(r){
  const main = r.referencia || r.proyecto || "Proyecto sin referencia";
  const extra = r.noTramite ? ` · ${r.noTramite}` : (r.director ? ` · ${r.director}` : "");
  return `${main}${extra}`;
}

function initProjectSearch(){
  const selectValues = allRecords
    .map(r => r.referencia || r.proyecto)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a,b)=>a.localeCompare(b, 'es'));

  fillSelect($("projectSelect"), selectValues, "Selecciona un proyecto");
  $("projectSelect").addEventListener("input", renderProjectResults);
  $("projectSearch").addEventListener("input", renderProjectResults);
  $("clearProjectSearch").addEventListener("click", () => {
    $("projectSelect").value = "";
    $("projectSearch").value = "";
    renderProjectResults();
  });
}

function countBy(records, getter){
  const map = new Map();
  records.forEach(r => {
    const vals = Array.isArray(getter(r)) ? getter(r) : [getter(r)];
    vals.filter(Boolean).forEach(v => map.set(v, (map.get(v)||0)+1));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], 'es'));
}

function renderAll(){
  renderKpis();
  renderUrgentTable();
  renderBars();
  renderDonut();
}

function renderKpis(){
  const total = filtered.length;
  const activos = filtered.filter(r => !r.finalizado).length;
  const finalizados = filtered.filter(r => r.finalizado).length;
  const vencidos = filtered.filter(r => r.alerta === "VENCIDO").length;
  const porVencer = filtered.filter(r => r.alerta === "POR VENCER").length;
  const kpis = [
    ["Total proyectos", total, "Registros cargados", ""],
    ["Activos", activos, "En gestión", ""],
    ["Finalizados", finalizados, "Cerrados o archivados", "green"],
    ["Vencidos", vencidos, "Superan fecha límite", "red"],
    ["Por vencer", porVencer, "≤ 7 días", "amber"]
  ];
  $("kpiGrid").innerHTML = kpis.map(k => `<article class="card kpi ${k[3]}"><div class="label">${esc(k[0])}</div><div class="value">${esc(k[1])}</div><div class="note">${esc(k[2])}</div></article>`).join("");
}

function avgOf(vals){ return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0; }

function renderBars(){
  renderBarList("directorBars", countBy(filtered, r => r.directores.length ? r.directores : [r.director || "Sin director"]).slice(0,10));
  $("directorChartTotal").textContent = `${filtered.length} proyectos`;
  renderBarList("alertBars", countBy(filtered, r => r.alerta), true);
  renderBarList("directionBars", countBy(filtered, r => r.direccion || "Sin dirección").slice(0,8), true);
}

function renderBarList(id, data){
  const max = Math.max(1, ...data.map(d => d[1]));
  $(id).innerHTML = data.length ? data.map(([name, val]) => `<div class="bar-row"><div class="bar-name" title="${esc(name)}">${esc(name)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, val/max*100)}%"></div></div><div class="bar-val">${esc(val)}</div></div>`).join("") : `<p class="muted">No hay datos para mostrar.</p>`;
}

function renderDonut(){
  const data = countBy(filtered, r => r.estado || "SIN ESTADO");
  const total = data.reduce((s,d)=>s+d[1],0) || 1;
  let acc = 0;
  const stops = data.map(([name,val],i) => {
    const start = acc/total*360; acc += val; const end = acc/total*360;
    return `${COLORS[i%COLORS.length]} ${start}deg ${end}deg`;
  });
  $("statusDonut").style.background = data.length ? `conic-gradient(${stops.join(",")})` : "#e2e8f0";
  $("statusLegend").innerHTML = data.map(([name,val],i) => `<div class="legend-item"><span class="legend-left"><span class="dot" style="background:${COLORS[i%COLORS.length]}"></span>${esc(name)}</span><strong>${esc(val)}</strong></div>`).join("");
  $("statusChartTotal").textContent = `${filtered.length} proyectos`;
}

function alertBadge(alerta){
  const cls = {"VENCIDO":"vencido", "POR VENCER":"por-vencer", "SIN FECHA LÍMITE":"sin-fecha", "AL DÍA":"al-dia", "FINALIZADO":"finalizado"}[alerta] || "sin-fecha";
  return `<span class="badge ${cls}">${esc(alerta)}</span>`;
}

function statusBadge(estado){
  const cls = slug(estado).replace(/\s+/g,'-');
  return `<span class="badge ${cls}">${esc(estado || "SIN ESTADO")}</span>`;
}

function urgentSort(a,b){
  const weight = {"VENCIDO":0,"POR VENCER":1,"SIN FECHA LÍMITE":2,"AL DÍA":3,"FINALIZADO":4};
  return (weight[a.alerta]??9)-(weight[b.alerta]??9) || (a.diasRestantes??9999)-(b.diasRestantes??9999);
}

function lastObservation(text){
  const raw = safe(text).trim();
  if(!raw) return "Sin observaciones registradas.";
  const parts = raw
    .split(/\n|\r|\s{2,}|(?=\d{1,2}[A-ZÁÉÍÓÚÑ]{3}\d{4})/g)
    .map(x => x.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function renderUrgentTable(){
  const rows = filtered
    .filter(r => ["VENCIDO","POR VENCER"].includes(r.alerta) && !r.finalizado)
    .sort(urgentSort);
  $("urgentCount").textContent = `${rows.length} proyecto${rows.length === 1 ? "" : "s"}`;
  $("urgentTable").innerHTML = urgentTableHtml(rows);
}

function urgentTableHtml(rows){
  return `<thead><tr><th>ID</th><th>Proyecto</th><th>Director</th><th>Dirección</th><th>Estado</th><th>Fecha límite</th><th>Tiempo del proyecto</th><th>Días restantes / atraso</th><th>Alerta</th><th>Última información de observación</th></tr></thead><tbody>`+
    rows.map(r => `<tr><td>${esc(r.id)}</td><td><strong>${esc(r.referencia || r.proyecto)}</strong><br><span class="muted">${esc(r.noTramite || r.descripcion || '')}</span></td><td>${esc(r.director || '—')}</td><td>${esc(r.direccion || '—')}</td><td>${statusBadge(r.estado)}</td><td>${esc(fmtDate(r.fechaLimite))}</td><td>${esc(formatProjectTime(r))}</td><td>${esc(formatRemaining(r.diasRestantes))}</td><td>${alertBadge(r.alerta)}</td><td class="observation-cell">${esc(lastObservation(r.observacion))}</td></tr>`).join("") +
    (rows.length ? "" : `<tr><td colspan="10" class="muted">No hay proyectos vencidos o por vencer registrados.</td></tr>`) + `</tbody>`;
}

function formatRemaining(days){
  if(days === null || days === undefined) return "Sin fecha límite";
  if(days < 0) return `${pluralDias(Math.abs(days))} de atraso`;
  if(days === 0) return "Vence hoy";
  return `${pluralDias(days)} restantes`;
}

function formatProjectTime(r){
  if(!Number.isFinite(r.diasProyecto)) return "Sin fecha inicial";
  return `${pluralDias(r.diasProyecto)} · hasta ${r.corteProyecto}`;
}

function projectHaystack(r){
  return slug([
    r.id, r.proyecto, r.referencia, r.objetivo, r.descripcion, r.director,
    (r.directores || []).join(" "), r.noTramite, r.entidadActual, r.direccion,
    r.estado, r.alerta, r.observacion
  ].join(" "));
}

function renderProjectResults(){
  const selected = $("projectSelect").value;
  const q = slug($("projectSearch").value).trim();
  let rows = [];

  if(selected){
    rows = allRecords.filter(r => (r.referencia || r.proyecto) === selected);
    if(q){ rows = rows.filter(r => projectHaystack(r).includes(q)); }
  } else if(q){
    rows = allRecords.filter(r => projectHaystack(r).includes(q));
  }

  rows = rows.sort((a,b)=>(a.referencia || a.proyecto || "").localeCompare(b.referencia || b.proyecto || "", 'es'));

  if(selected || q){
    $("searchCount").textContent = `${rows.length} resultado${rows.length === 1 ? "" : "s"}`;
  } else {
    $("searchCount").textContent = "Seleccione o busque";
  }

  if(!selected && !q){
    $("projectResults").innerHTML = `<div class="detail-empty">Selecciona un proyecto en la lista desplegable o escribe una palabra clave para generar el informe de consulta.</div>`;
    return;
  }
  if(!rows.length){
    $("projectResults").innerHTML = `<div class="detail-empty">No se encontraron proyectos con ese criterio de búsqueda.</div>`;
    return;
  }
  $("projectResults").innerHTML = rows.map(projectReportHtml).join("");
}

function reportItem(label, value, extraClass=""){
  return `<div class="report-item ${extraClass}"><span>${esc(label)}</span><strong>${value || "—"}</strong></div>`;
}

function projectReportHtml(r){
  const fechaLimiteMostrada = r.fechaLimite ? fmtDate(r.fechaLimite) : (r.fechaLimiteOriginal ? safe(r.fechaLimiteOriginal) : "Sin fecha");
  const indicadorClase = r.alerta === "VENCIDO" ? "danger" : r.alerta === "POR VENCER" ? "warning" : r.alerta === "FINALIZADO" ? "success" : "info";

  return `<article class="project-report">
    <header class="report-header">
      <div>
        <p class="report-kicker">Informe de seguimiento de proyecto</p>
        <h3>${esc(r.referencia || r.proyecto || "Proyecto sin nombre")}</h3>
        <p class="report-subtitle">${esc(r.id)}${r.noTramite ? " · Trámite: " + esc(r.noTramite) : ""}</p>
      </div>
      <div class="report-status">
        ${statusBadge(r.estado)}
        ${alertBadge(r.alerta)}
      </div>
    </header>

    <section class="report-section">
      <h4>1. Datos generales</h4>
      <div class="report-grid">
        ${reportItem("Referencia general", esc(r.referencia || r.proyecto || "—"))}
        ${reportItem("Proyecto", esc(r.proyecto || r.referencia || "—"))}
        ${reportItem("Director responsable", esc(r.director || "Sin director"))}
        ${reportItem("Dirección", esc(r.direccion || "Sin dirección"))}
        ${reportItem("Entidad actual", esc(r.entidadActual || "—"))}
        ${reportItem("No. de trámite", esc(r.noTramite || "—"))}
      </div>
    </section>

    <section class="report-section">
      <h4>2. Estado e indicadores de tiempo</h4>
      <div class="report-grid time-grid">
        ${reportItem("Estado", statusBadge(r.estado))}
        ${reportItem("Alerta", alertBadge(r.alerta))}
        ${reportItem("Fecha inicial", esc(fmtDate(r.fechaInicial)))}
        ${reportItem("Fecha límite", esc(fechaLimiteMostrada))}
        ${reportItem("Fecha final / corte", esc(r.fechaFinal ? fmtDate(r.fechaFinal) : "Fecha actual"))}
        ${reportItem("Tiempo del proyecto", esc(formatProjectTime(r)))}
        ${reportItem("Indicador de tiempo", esc(formatRemaining(r.diasRestantes)), indicadorClase)}
      </div>
    </section>

    <section class="report-section">
      <h4>3. Descripción del proyecto</h4>
      <div class="report-text">
        <strong>Objetivo general</strong>
        <p>${esc(r.objetivo || "Sin objetivo registrado.")}</p>
        <strong>Descripción general</strong>
        <p>${esc(r.descripcion || "Sin descripción registrada.")}</p>
      </div>
    </section>

    <section class="report-section observations-section">
      <h4>4. Observaciones completas</h4>
      <div class="report-observations pre-line">${esc(r.observacion || "Sin observaciones registradas.")}</div>
    </section>
  </article>`;
}

loadData().then(() => {
  const minutes = Number(CONFIG.autoRefreshMinutes || 0);
  if(minutes > 0){
    setInterval(() => {
      loadData().catch(err => console.error("Error al actualizar datos:", err));
    }, minutes * 60 * 1000);
  }
}).catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div style="background:#fee2e2;color:#991b1b;padding:12px 18px;font-weight:800">No se pudo cargar la base de datos. Revisa que data/projects.csv exista en la carpeta data y que esté guardado como CSV UTF-8.</div>`);
});
