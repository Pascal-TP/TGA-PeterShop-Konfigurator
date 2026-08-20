const labels = [
  "Start",
  "Gebäudeart",
  "Dachform & Eindeckung",
  "Standort",
  "Dachfläche",
  "Stromverbrauch",
  "Bestandsanlage",
  "Stromspeicher",
  "Weiteres Zubehör",
  "Wunschtermin",
  "Berechnung",
];

const s = {
  step: 0,
  max: 0,
  project: "",
  building: "",
  roof: "",
  cover: "",
  plz: "",
  area: 0,
  consumption: 0,
  existing: "",
  existingKwp: 0,
  existingModules: 0,
  storage: "",
  storageSize: "auto",
  accessories: [],
  accessoryOptions: {
    wallbox: "",
    cabinet: "",
    backup: "",
  },
  dateChoice: "",
  wishDate: "",
  products: [],
};

let master = [];
let technicalNotes = [];

// Technische Daten Jinko Tiger Neo JKM460N-48HL4M-DB, 460-Wp-Variante.
const MODULE = {
  model: "Jinko Tiger Neo JKM460N-48HL4M-DB",
  pmaxWp: 460,
  lengthM: 1.762,
  widthM: 1.134,
  weightKg: 24.0,
  efficiencyPct: 23.02,
  vmpV: 30.71,
  impA: 14.98,
  vocV: 36.38,
  iscA: 15.86,
};
MODULE.areaM2 = MODULE.lengthM * MODULE.widthM;

const $ = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll(".panel")];

function initSteps() {
  $("steps").innerHTML = labels
    .map(
      (label, i) =>
        `<div class="step-item ${i ? "locked" : "active"}" data-i="${i}"><span class="num">${i}</span><span>${label}</span></div>`,
    )
    .join("");

  document.querySelectorAll(".step-item").forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.i;
      if (i <= s.max) show(i);
    };
  });
}

function choose(id, key, cb) {
  $(id).addEventListener("click", (e) => {
    const button = e.target.closest("button[data-v]");
    if (!button || button.disabled) return;
    [...$(id).querySelectorAll("button[data-v]")].forEach((x) =>
      x.classList.toggle("active", x === button),
    );
    s[key] = button.dataset.v;
    cb?.(button.dataset.v);
    update();
  });
}

function coverOptions() {
  const opts =
    s.roof === "Schrägdach"
      ? [
          "Dachziegel / Dachstein",
          "Trapezblech",
          "Stockschrauben / sonstige Befestigung",
        ]
      : ["Ost/West-Ausrichtung", "Süd-Ausrichtung"];

  $("coverTitle").textContent =
    s.roof === "Schrägdach" ? "Eindeckung / Befestigung" : "Ausrichtung";
  $("cover").innerHTML = opts
    .map((x) => `<button type="button" data-v="${x}">${x}</button>`)
    .join("");
  $("coverBlock").classList.remove("hidden");
  s.cover = "";
  choose("cover", "cover");
}

function storageReco() {
  const kwp = recommend().kwp;
  const value = kwp <= 6 ? 5.1 : kwp <= 9 ? 7.7 : kwp <= 12 ? 10.2 : 12.8;
  $("storageReco").innerHTML =
    `<strong>Erste Empfehlung: ca. ${formatNumber(value, 1)} kWh</strong>` +
    `<br><span class="muted">Die Speichergröße wird derzeit anhand der empfohlenen PV-Leistung abgestuft. Die endgültige Dimensionierungslogik kann später noch verfeinert werden.</span>`;
  return value;
}

function accessoryDetails() {
  if (!s.accessories.length) {
    $("accessoryDetails").classList.add("hidden");
    $("accessoryDetails").innerHTML = "";
    return;
  }

  $("accessoryDetails").classList.remove("hidden");
  let html = "<h3>Details zum Zubehör</h3>";

  if (s.accessories.includes("Wallbox")) {
    html += `<label>Wallbox-Ausführung
      <select id="wallbox">
        <option value="Fronius 11 Standard">Fronius Wattpilot Home 11 kW</option>
        <option value="Fronius 22 Standard">Fronius Wattpilot Home 22 kW</option>
        <option value="Fronius 11 Flex">Fronius Wattpilot Flex Home 11 kW</option>
        <option value="Fronius 22 Flex">Fronius Wattpilot Flex Home 22 kW</option>
      </select>
    </label>`;
  }

  if (s.accessories.includes("Zählerschrank")) {
    html += `<label>Zählerschrank
      <select id="cabinet">
        <option value="110x55 ohne">EFH 110×55 cm – 1 Zählerplatz – ohne Bestückung</option>
        <option value="110x55 mit">EFH 110×55 cm – 1 Zählerplatz – mit Bestückung</option>
        <option value="110x80 ohne">EFH 110×80 cm – 2 Zählerplätze – ohne Bestückung</option>
        <option value="110x80 mit">EFH 110×80 cm – 2 Zählerplätze – mit Bestückung</option>
      </select>
    </label>`;
  }

  if (s.accessories.includes("Notstrom")) {
    html += `<label>Notstrom / Fronius-Zubehör
      <select id="backup">
        <option value="Enwitec">Netzumschaltbox Enwitec 20 kW</option>
        <option value="PV-Point">PV-Point</option>
        <option value="Backup Switch">Backup Switch</option>
        <option value="Backup Controller">Backup Controller</option>
      </select>
    </label>`;
  }

  $("accessoryDetails").innerHTML = html;

  ["wallbox", "cabinet", "backup"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const saved = s.accessoryOptions[id];
    if (saved && [...el.options].some((o) => o.value === saved)) el.value = saved;
    else s.accessoryOptions[id] = el.value;
    el.addEventListener("change", () => {
      s.accessoryOptions[id] = el.value;
      update();
    });
  });
}

function recommend() {
  const area = +s.area || 0;
  const consumption = +s.consumption || 0;
  const maxModules = Math.floor(area / MODULE.areaM2);

  // Vorläufige Zielgröße. Diese Verbrauchslogik ist bewusst noch als Entwurf markiert.
  let targetKwp = Math.max(
    3,
    Math.min(33.3, consumption ? (consumption / 1000) * 1.65 : 6),
  );

  if (s.existing === "Erweiterung gewünscht") {
    targetKwp = Math.max(3, targetKwp - (+s.existingKwp || 0));
  }

  const moduleKwp = MODULE.pmaxWp / 1000;
  const targetModules = Math.ceil(targetKwp / moduleKwp);
  const modules = Math.max(0, Math.min(maxModules, targetModules));
  const kwp = +(modules * moduleKwp).toFixed(2);

  return {
    maxModules,
    modules,
    kwp,
    targetKwp,
    maxRoofKwp: +(maxModules * moduleKwp).toFixed(2),
    moduleAreaUsed: +(modules * MODULE.areaM2).toFixed(2),
    moduleWeight: +(modules * MODULE.weightKg).toFixed(1),
  };
}

function validate() {
  if (s.step === 1) return !!s.building;
  if (s.step === 2) return !!s.roof && !!s.cover;
  if (s.step === 3) return /^\d{5}$/.test(s.plz);
  if (s.step === 4) return s.area > 0;
  if (s.step === 5) return s.consumption > 0;
  if (s.step === 6) {
    return (
      !!s.existing &&
      (s.existing !== "Erweiterung gewünscht" || s.existingKwp > 0)
    );
  }
  if (s.step === 7) return !!s.storage;
  if (s.step === 9) return !!s.dateChoice || !!s.wishDate;
  return true;
}

function show(i) {
  s.step = Math.max(0, Math.min(i, s.max));
  panels.forEach((p) =>
    p.classList.toggle("active", +p.dataset.step === s.step),
  );
  document.querySelectorAll(".step-item").forEach((el) => {
    const n = +el.dataset.i;
    el.classList.toggle("active", n === s.step);
    el.classList.toggle("locked", n > s.max);
  });

  $("prev").style.visibility = s.step === 0 ? "hidden" : "visible";
  $("next").style.display = s.step === 10 ? "none" : "";
  $("resultPanel").classList.add("hidden");
  $("configPanel").classList.remove("result-visible");

  if (s.step === 7 && s.storage === "Ja") storageReco();
  if (s.step === 10) renderFinalCheck();
  updateNext();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateNext() {
  const ok = validate();
  $("next").disabled = !ok;
  $("next").style.opacity = ok ? 1 : 0.45;
  $("next").classList.toggle("next-ready-attention", ok && s.step < 10);
  $("stepHint").style.display = ok ? "none" : "block";
  $("stepHint").textContent =
    "Bitte vervollständigen Sie die Angaben in diesem Schritt.";
}

function update() {
  s.project = $("project").value.trim();
  s.plz = $("plz").value.trim();
  s.area = +$("area").value || 0;
  s.consumption = +$("consumption").value || 0;
  s.existingKwp = +$("existingKwp").value || 0;
  s.existingModules = +$("existingModules").value || 0;
  s.storageSize = $("storageSize").value;
  s.wishDate = $("wishDate").value;

  const r = recommend();
  const boxes = [
    ["Projekt", s.project || "Keine Angabe"],
    ["Gebäude", s.building || "Noch nicht gewählt"],
    [
      "Dach",
      s.roof ? s.roof + (s.cover ? " · " + s.cover : "") : "Noch nicht gewählt",
    ],
    ["Standort", s.plz || "PLZ offen"],
    ["Dachfläche", s.area ? `${formatNumber(s.area)} m²` : "Noch offen"],
    [
      "Stromverbrauch",
      s.consumption
        ? `${formatNumber(s.consumption)} kWh/Jahr`
        : "Noch offen",
    ],
    ["Bestandsanlage", s.existing || "Noch nicht gewählt"],
    [
      "Speicher",
      s.storage
        ? s.storage === "Ja"
          ? "Gewünscht"
          : "Nicht gewünscht"
        : "Noch nicht gewählt",
    ],
    [
      "Zubehör",
      s.accessories.length ? s.accessories.join(" · ") : "Noch nichts gewählt",
    ],
    [
      "Wunschtermin",
      s.wishDate
        ? new Date(s.wishDate + "T00:00").toLocaleDateString("de-DE")
        : s.dateChoice || "Noch offen",
    ],
  ];

  let html = boxes
    .map(
      ([title, value]) =>
        `<div class="summary-box"><b>${title}</b><span>${value}</span></div>`,
    )
    .join("");

  if (s.consumption && s.area) {
    const storageText =
      s.storage === "Ja"
        ? ` · Speicher ca. ${formatNumber(storageReco(), 1)} kWh`
        : "";
    html += `<div class="summary-box reco"><b>Vorläufige Empfehlung</b><span>${formatNumber(r.kwp, 2)} kWp · ${r.modules} Module${storageText}</span></div>`;
  }

  $("summary").innerHTML = html;
  updateNext();
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function findProduct(predicate) {
  return master.find(predicate);
}

function findByDescription(parts, extraPredicate = null) {
  const needles = (Array.isArray(parts) ? parts : [parts]).map(normalizeText);
  return findProduct((p) => {
    const text = normalizeText(p.artikelbezeichnung);
    const matches = needles.every((part) => text.includes(part));
    return matches && (!extraPredicate || extraPredicate(p));
  });
}

function productsByCategory(category) {
  const target = normalizeText(category);
  return master.filter((p) => normalizeText(p.kategorie) === target);
}

function add(list, product, qty = 1) {
  if (product && qty > 0) list.push({ ...product, qty });
}

function extractPowerKw(product) {
  const text = String(product?.artikelbezeichnung || "").replace(",", ".");
  const matches = [...text.matchAll(/\((\d+(?:\.\d+)?)\s*kW\)/gi)];
  if (matches.length) return +matches[matches.length - 1][1];
  const fallback = text.match(/(\d+(?:\.\d+)?)\s*kW/i);
  return fallback ? +fallback[1] : 0;
}

function extractCapacityKwh(product) {
  const text = String(product?.artikelbezeichnung || "").replace(",", ".");
  const match = text.match(/(\d+(?:\.\d+)?)\s*kWh/i);
  return match ? +match[1] : 0;
}

function pickInverter(requiredKwp, hybrid) {
  const category = hybrid ? "Wechselrichter hybrid" : "Wechselrichter strang";
  let pool = productsByCategory(category).filter(
    (p) => normalizeText(p.marke) === "fronius",
  );
  if (!pool.length) pool = productsByCategory(category);
  pool = pool
    .map((p) => ({ product: p, kw: extractPowerKw(p) }))
    .filter((x) => x.kw > 0)
    .sort((a, b) => a.kw - b.kw);
  return (
    pool.find((x) => x.kw >= Math.max(3, requiredKwp))?.product ||
    pool.at(-1)?.product ||
    null
  );
}

function pickBydStorage(capacity) {
  const pool = productsByCategory("Batteriespeicher")
    .filter((p) => normalizeText(p.marke) === "byd")
    .filter((p) => !normalizeText(p.artikelbezeichnung).includes("erweiterung"))
    .map((p) => ({ product: p, cap: extractCapacityKwh(p) }))
    .filter((x) => x.cap > 0)
    .sort((a, b) => a.cap - b.cap);
  return (
    pool.find((x) => x.cap >= capacity - 0.05)?.product ||
    pool.at(-1)?.product ||
    null
  );
}

function pickModuleMounting() {
  if (s.roof === "Schrägdach") {
    if (s.cover.includes("Trapez"))
      return findByDescription(["schrägdach-modul-montage", "trapezblech"]);
    if (s.cover.includes("Stock"))
      return findByDescription(["schrägdach-modul-montage", "stockschrauben"]);
    return findProduct((p) => {
      const t = normalizeText(p.artikelbezeichnung);
      return (
        t.includes("schrägdach-modul-montage") &&
        !t.includes("trapez") &&
        !t.includes("stockschrauben")
      );
    });
  }
  if (s.cover.includes("Ost/West"))
    return findByDescription(["flachdach-modul-montage", "ost/west"]);
  return findByDescription(["flachdach-modul-montage", "süd"]);
}

function pickWallbox() {
  const option = s.accessoryOptions.wallbox || "Fronius 11 Standard";
  if (option === "Fronius 22 Standard")
    return findByDescription(["22,0 kw wattpilot home", "standard"]);
  if (option === "Fronius 11 Flex")
    return findByDescription(["11,0 kw wattpilot flex home"]);
  if (option === "Fronius 22 Flex")
    return findByDescription(["22,0 kw wattpilot flex home"]);
  return findByDescription(["11,0 kw wattpilot home", "standard"]);
}

function pickCabinet() {
  const option = s.accessoryOptions.cabinet || "110x55 ohne";
  const size = option.includes("110x80") ? "110x80" : "110x55";
  const furnishing = option.endsWith("mit") ? "mit bestückung" : "ohne bestückung";
  return findByDescription([`(${size}cm)`, furnishing]);
}

function pickBackup() {
  const option = s.accessoryOptions.backup || "Enwitec";
  if (option === "PV-Point") return findByDescription("pv-point");
  if (option === "Backup Switch") return findByDescription("backup switch");
  if (option === "Backup Controller") return findByDescription("backup controller");
  return findByDescription(["netzum", "enwitec"]);
}

function pickScaffold() {
  if (s.roof === "Flachdach" && s.cover.includes("Ost/West")) {
    return findByDescription(["gerüst", "doppelt"]);
  }
  return findByDescription(["gerüst", "einfach"]);
}

function buildProductList() {
  const r = recommend();
  const list = [];

  add(list, pickModuleMounting(), r.modules);
  add(list, pickInverter(r.kwp, s.storage === "Ja"));

  if (s.storage === "Ja") {
    const capacity = s.storageSize === "auto" ? storageReco() : +s.storageSize;
    add(list, pickBydStorage(capacity));
  }

  if (s.accessories.includes("Wallbox")) add(list, pickWallbox());
  if (s.accessories.includes("Zählerschrank")) add(list, pickCabinet());
  if (s.accessories.includes("Optimierer")) {
    add(list, findByDescription("tigo optimierer"), r.modules);
  }
  if (s.accessories.includes("Notstrom")) add(list, pickBackup());
  if (s.accessories.includes("Wärmepumpenvorbereitung")) {
    add(list, findByDescription("vorbereitung wärmepumpenanschluss"));
  }
  if (s.accessories.includes("Gerüst")) add(list, pickScaffold());

  return list;
}

function renderFinalCheck() {
  const r = recommend();
  const storage =
    s.storage === "Ja"
      ? `${formatNumber(s.storageSize === "auto" ? storageReco() : +s.storageSize, 1)} kWh`
      : "nicht gewünscht";

  $("finalCheck").innerHTML = `
    <div class="final-check-grid">
      <div><strong>Projekt</strong><span>${escapeHtml(s.project || "Keine Angabe")}</span></div>
      <div><strong>Gebäude</strong><span>${escapeHtml(s.building)}</span></div>
      <div><strong>Dach</strong><span>${escapeHtml(`${s.roof} · ${s.cover}`)}</span></div>
      <div><strong>Standort</strong><span>${escapeHtml(s.plz)}</span></div>
      <div><strong>Nutzbare Dachfläche</strong><span>${formatNumber(s.area)} m²</span></div>
      <div><strong>Jahresverbrauch</strong><span>${formatNumber(s.consumption)} kWh</span></div>
      <div><strong>Voraussichtliche PV-Leistung</strong><span>${formatNumber(r.kwp, 2)} kWp · ${r.modules} Module</span></div>
      <div><strong>Speicher</strong><span>${storage}</span></div>
      <div><strong>Zubehör</strong><span>${escapeHtml(s.accessories.join(" · ") || "Kein zusätzliches Zubehör")}</span></div>
      <div><strong>Wunschtermin</strong><span>${escapeHtml(s.wishDate ? new Date(s.wishDate + "T00:00").toLocaleDateString("de-DE") : s.dateChoice || "Keine Angabe")}</span></div>
    </div>`;
}

function renderTechnicalNotes() {
  if (!technicalNotes.length) {
    $("technicalNotes").innerHTML =
      '<p class="muted">In der master_tga.csv sind derzeit keine technischen Hinweise hinterlegt.</p>';
    return;
  }

  let html = "";
  technicalNotes.forEach((note) => {
    const text = note.artikelbezeichnung.trim();
    if (!text) return;
    if (text.endsWith(":")) {
      html += `<h4>${escapeHtml(text)}</h4>`;
    } else {
      html += `<p>${escapeHtml(text)}</p>`;
    }
  });
  $("technicalNotes").innerHTML = html;
}

function calculate() {
  const r = recommend();
  const list = buildProductList();
  s.products = list;

  $("recommendation").innerHTML = `
    <strong>Empfohlene Anlagenkonfiguration</strong>
    <div class="metric-grid">
      <div class="metric"><span>PV-Leistung</span><br><b>${formatNumber(r.kwp, 2)} kWp</b></div>
      <div class="metric"><span>Module</span><br><b>${r.modules}</b></div>
      <div class="metric"><span>Theoretisch max. Module</span><br><b>${r.maxModules}</b></div>
      <div class="metric"><span>Speicher</span><br><b>${s.storage === "Ja" ? formatNumber(s.storageSize === "auto" ? storageReco() : +s.storageSize, 1) + " kWh" : "Nein"}</b></div>
    </div>
    <p><strong>Modulbasis:</strong> ${MODULE.model}, ${MODULE.pmaxWp} Wp, ${formatNumber(MODULE.lengthM, 3)} × ${formatNumber(MODULE.widthM, 3)} m = ${formatNumber(MODULE.areaM2, 3)} m² je Modul.</p>
    <p>Die vorgeschlagenen ${r.modules} Module belegen rechnerisch ca. ${formatNumber(r.moduleAreaUsed, 2)} m², ergeben ${formatNumber(r.kwp, 2)} kWp und haben zusammen ein Modulgewicht von ca. ${formatNumber(r.moduleWeight, 1)} kg. Rein flächenbezogen wären maximal ${r.maxModules} Module bzw. ${formatNumber(r.maxRoofKwp, 2)} kWp möglich.</p>
    <p class="muted">Die theoretische Maximalbelegung berücksichtigt noch keine konkrete Dachgeometrie, Rand- und Sicherheitsabstände, Dachaufbauten, Verschattung oder Montageabstände.</p>`;

  let total = 0;
  $("resultBody").innerHTML =
    list
      .map((p, index) => {
        const unitPrice = parseGermanNumber(p.preis);
        const rowTotal = unitPrice * p.qty;
        total += rowTotal;
        return `<tr>
          <td><input type="checkbox" checked data-product-index="${index}" aria-label="Position übernehmen"></td>
          <td>${escapeHtml(p.artikelnummer || "-")}</td>
          <td>${escapeHtml(p.artikelbezeichnung)}</td>
          <td>${formatNumber(p.qty, 2)}</td>
          <td>${escapeHtml(p.einheit || "")}</td>
          <td>${formatCurrency(unitPrice)}</td>
          <td>${formatCurrency(rowTotal)}</td>
        </tr>`;
      })
      .join("") ||
    '<tr><td colspan="7">Noch keine passenden Positionen ermittelt.</td></tr>';

  $("resultTotalNet").textContent = formatCurrency(total);
  $("resultPanel").classList.remove("hidden");
  $("configPanel").classList.add("result-visible");
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function parseGermanNumber(value) {
  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value, maxDecimals = 0) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(+value || 0);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(+value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Die Datei hat sieben Spalten. Wird in der Artikelbezeichnung versehentlich
// ein zusätzliches Semikolon verwendet, setzen wir die Beschreibung von rechts
// her wieder zusammen, damit Preis/Einheit/Kategorie/Marke/Bild korrekt bleiben.
function parseMasterLine(line) {
  const parts = line.split(";");
  if (parts.length < 7) return null;
  if (parts.length === 7) return parts;

  const articleNumber = parts[0];
  const tail = parts.slice(-5);
  const description = parts.slice(1, parts.length - 5).join(";").trim();
  return [articleNumber, description, ...tail];
}

async function load() {
  const response = await fetch("master_tga.csv");
  if (!response.ok) throw new Error("master_tga.csv konnte nicht geladen werden.");

  const buffer = await response.arrayBuffer();
  // Die vom Nutzer gelieferte Datei ist Windows-1252 codiert. Das entspricht
  // auch dem bewährten Import im NDF-Konfigurator.
  const text = new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headers = parseMasterLine(lines.shift()).map((h) => h.trim().toLowerCase());

  const rows = lines
    .map(parseMasterLine)
    .filter(Boolean)
    .map((values) => {
      const row = {};
      headers.forEach((header, i) => (row[header] = (values[i] || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim()));
      return row;
    });

  technicalNotes = rows.filter(
    (row) => normalizeText(row.kategorie) === "technische hinweise",
  );
  master = rows.filter(
    (row) => row.artikelnummer && normalizeText(row.kategorie) !== "technische hinweise",
  );

  renderTechnicalNotes();
  console.info(`master_tga.csv geladen: ${master.length} Artikel, ${technicalNotes.length} Hinweiszeilen.`);
}

initSteps();
choose("building", "building");
choose("roof", "roof", coverOptions);
choose("existing", "existing", (v) => {
  $("existingDetails").classList.toggle("hidden", v !== "Erweiterung gewünscht");
});
choose("storage", "storage", (v) => {
  $("storageDetails").classList.toggle("hidden", v !== "Ja");
  if (v === "Ja") storageReco();
});
choose("dateChoice", "dateChoice");
choose("consumptionQuick", "_quickConsumption", (v) => {
  $("consumption").value = v;
  s.consumption = +v;
  update();
});

$("accessories").onclick = (e) => {
  const button = e.target.closest("button[data-v]");
  if (!button) return;
  const value = button.dataset.v;
  button.classList.toggle("active");
  s.accessories = button.classList.contains("active")
    ? [...new Set([...s.accessories, value])]
    : s.accessories.filter((x) => x !== value);
  accessoryDetails();
  update();
};

[
  "project",
  "plz",
  "area",
  "consumption",
  "existingKwp",
  "existingModules",
  "storageSize",
  "wishDate",
].forEach((id) => $(id).addEventListener("input", update));

$("next").onclick = () => {
  if (!validate()) return;
  s.max = Math.max(s.max, s.step + 1);
  show(s.step + 1);
};
$("prev").onclick = () => show(s.step - 1);
$("clear").onclick = () => {
  if (confirm("Möchten Sie wirklich alle Eingaben löschen?")) location.reload();
};
$("startCalculationBtn").onclick = calculate;
$("backToConfigBtn").onclick = () => {
  $("resultPanel").classList.add("hidden");
  $("configPanel").classList.remove("result-visible");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

load().catch((error) => {
  console.error(error);
  $("technicalNotes").innerHTML = `<p class="warning-text">Die master_tga.csv konnte nicht geladen werden. Bitte prüfen Sie, ob die Datei im gleichen Ordner wie index.html liegt.</p>`;
});
update();
show(0);
