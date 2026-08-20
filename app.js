const labels = [
  "Start", "Gebäudeart", "Dachform & Eindeckung", "Standort", "Dachfläche",
  "Stromverbrauch", "Bestandsanlage", "Stromspeicher", "Weiteres Zubehör",
  "Wunschtermin", "Berechnung",
];

const s = {
  step: 0, max: 0, project: "", building: "", roof: "", cover: "",
  distanceMode: "plz", plz: "", manualDistanceKm: 0,
  area: 0, consumption: 0, existing: "", existingKwp: 0, existingModules: 0,
  storage: "", inverterBrand: "", storageBrand: "", storageSize: "auto",
  accessories: [], accessoryOptions: {
    wallboxBrand: "", wallboxArticle: "", cabinet: "", backup: "", scaffoldOrientation: "",
  },
  dateChoice: "", wishDate: "", sizingMode: "recommended",
  products: [], calculated: false, calculationDirty: false,
};

let master = [];
let technicalNotes = [];
let postcodeDistances = [];

const MODULE = {
  model: "Jinko Tiger Neo JKM460N-48HL4M-DB", pmaxWp: 460,
  lengthM: 1.762, widthM: 1.134, weightKg: 24.0, efficiencyPct: 23.02,
  vmpV: 30.71, impA: 14.98, vocV: 36.38, iscA: 15.86,
};
MODULE.areaM2 = MODULE.lengthM * MODULE.widthM;

const $ = (id) => document.getElementById(id);
const panels = [...document.querySelectorAll(".panel")];

function initSteps() {
  $("steps").innerHTML = labels.map((label, i) =>
    `<div class="step-item ${i ? "locked" : "active"}" data-i="${i}"><span class="num">${i}</span><span>${label}</span></div>`
  ).join("");
  document.querySelectorAll(".step-item").forEach((el) => {
    el.onclick = () => { const i = +el.dataset.i; if (i <= s.max) show(i); };
  });
}

function choose(id, key, cb) {
  $(id)?.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-v]");
    if (!button || button.disabled) return;
    [...$(id).querySelectorAll("button[data-v]")].forEach((x) => x.classList.toggle("active", x === button));
    s[key] = button.dataset.v;
    cb?.(button.dataset.v);
    update();
  });
}

function coverOptions() {
  const opts = s.roof === "Schrägdach"
    ? ["Dachziegel / Dachstein", "Trapezblech", "Stockschrauben / sonstige Befestigung"]
    : ["Ost/West-Ausrichtung", "Süd-Ausrichtung"];
  $("coverTitle").textContent = s.roof === "Schrägdach" ? "Eindeckung / Befestigung" : "Ausrichtung";
  $("cover").innerHTML = opts.map((x) => `<button type="button" data-v="${x}">${x}</button>`).join("");
  $("coverBlock").classList.remove("hidden");
  s.cover = "";
}

function normalizeText(value) {
  return String(value || "").toLocaleLowerCase("de-DE").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}
function normalizePlz(value) { return String(value || "").replace(/\D/g, "").padStart(5, "0").slice(-5); }
function parseGermanNumber(value) {
  const normalized = String(value || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : 0;
}
function formatNumber(value, maxDecimals = 0) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals }).format(+value || 0);
}
function formatCurrency(value) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(+value || 0); }
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function productsByCategory(category) {
  const target = normalizeText(category); return master.filter((p) => normalizeText(p.kategorie) === target);
}
function findProduct(predicate) { return master.find(predicate); }
function findByDescription(parts, extraPredicate = null) {
  const needles = (Array.isArray(parts) ? parts : [parts]).map(normalizeText);
  return findProduct((p) => {
    const text = normalizeText(p.artikelbezeichnung);
    return needles.every((part) => text.includes(part)) && (!extraPredicate || extraPredicate(p));
  });
}
function uniqueBrands(categories) {
  const list = (Array.isArray(categories) ? categories : [categories]).flatMap(productsByCategory);
  return [...new Set(list.map((p) => p.marke).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
}
function add(list, product, qty = 1) { if (product && qty > 0) list.push({ ...product, qty }); }

function extractPowerKw(product) {
  const text = String(product?.artikelbezeichnung || "").replace(/,/g, ".");
  const matches = [...text.matchAll(/\((\d+(?:\.\d+)?)\s*kW\)/gi)];
  if (matches.length) return +matches[matches.length - 1][1];
  const fallback = text.match(/(\d+(?:\.\d+)?)\s*kW/i); return fallback ? +fallback[1] : 0;
}
function extractCapacityKwh(product) {
  const text = String(product?.artikelbezeichnung || "").replace(/,/g, ".");
  const match = text.match(/(\d+(?:\.\d+)?)\s*kWh/i); return match ? +match[1] : 0;
}

function recommend() {
  const area = +s.area || 0;
  const consumption = +s.consumption || 0;
  const maxModules = Math.floor(area / MODULE.areaM2);
  let targetKwp = Math.max(3, Math.min(33.3, consumption ? (consumption / 1000) * 1.65 : 6));
  if (s.existing === "Erweiterung gewünscht") targetKwp = Math.max(3, targetKwp - (+s.existingKwp || 0));
  const moduleKwp = MODULE.pmaxWp / 1000;
  const targetModules = Math.ceil(targetKwp / moduleKwp);
  const recommendedModules = Math.max(0, Math.min(maxModules, targetModules));
  const recommendedKwp = +(recommendedModules * moduleKwp).toFixed(2);
  return {
    maxModules, recommendedModules, recommendedKwp, targetKwp,
    maxRoofKwp: +(maxModules * moduleKwp).toFixed(2),
  };
}

function selectedSizing() {
  const r = recommend();
  const modules = s.sizingMode === "maximum" ? r.maxModules : r.recommendedModules;
  const kwp = +(modules * MODULE.pmaxWp / 1000).toFixed(2);
  return {
    ...r, modules, kwp,
    moduleAreaUsed: +(modules * MODULE.areaM2).toFixed(2),
    moduleWeight: +(modules * MODULE.weightKg).toFixed(1),
  };
}

function genericStorageTarget() {
  const kwp = recommend().recommendedKwp;
  return kwp <= 6 ? 5.1 : kwp <= 9 ? 7.7 : kwp <= 12 ? 10.2 : kwp <= 16 ? 12.8 : 16.0;
}
function storageProductsForBrand() {
  return productsByCategory("Batteriespeicher")
    .filter((p) => normalizeText(p.marke) === normalizeText(s.storageBrand))
    .filter((p) => {
      const t = normalizeText(p.artikelbezeichnung);
      return extractCapacityKwh(p) > 0 && !t.includes("erweiterung") && !t.includes("smart meter") && !t.includes("backup-box");
    })
    .map((p) => ({ product: p, cap: extractCapacityKwh(p) }))
    .sort((a, b) => a.cap - b.cap);
}
function recommendedStorageProduct() {
  const pool = storageProductsForBrand();
  const target = genericStorageTarget();
  return pool.find((x) => x.cap >= target - 0.05) || pool.at(-1) || null;
}
function storageReco() {
  const target = genericStorageTarget();
  const actual = recommendedStorageProduct();
  if ($("storageReco")) {
    $("storageReco").innerHTML = actual
      ? `<strong>Empfehlung: ${formatNumber(actual.cap, 1)} kWh ${escapeHtml(s.storageBrand)}</strong><br><span class="muted">Ausgehend von ca. ${formatNumber(target, 1)} kWh Zielgröße wird die nächstpassende verfügbare Speichergröße des gewählten Herstellers verwendet.</span>`
      : `<strong>Erste Empfehlung: ca. ${formatNumber(target, 1)} kWh</strong><br><span class="muted">Bitte wählen Sie zunächst einen Speicherhersteller.</span>`;
  }
  return actual?.cap || target;
}
function updateStorageSizeOptions() {
  const select = $("storageSize"); if (!select) return;
  const previous = s.storageSize || "auto";
  const pool = storageProductsForBrand();
  select.innerHTML = `<option value="auto">Empfehlung übernehmen</option>` + pool.map((x) => `<option value="${x.cap}">${formatNumber(x.cap, 1)} kWh – ${escapeHtml(x.product.artikelbezeichnung)}</option>`).join("");
  if ([...select.options].some((o) => o.value === previous)) select.value = previous; else { select.value = "auto"; s.storageSize = "auto"; }
  storageReco();
}

function renderManufacturerChoices() {
  const inverterBrands = uniqueBrands(["Wechselrichter strang", "Wechselrichter hybrid"]);
  $("inverterBrand").innerHTML = inverterBrands.map((brand) => `<button type="button" data-v="${escapeHtml(brand)}">${escapeHtml(brand)}</button>`).join("");
  if (s.inverterBrand) [...$("inverterBrand").querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b.dataset.v === s.inverterBrand));

  const storageBrands = uniqueBrands("Batteriespeicher").filter((brand) =>
    productsByCategory("Batteriespeicher").some((p) => normalizeText(p.marke) === normalizeText(brand) && extractCapacityKwh(p) > 0 && !normalizeText(p.artikelbezeichnung).includes("erweiterung"))
  );
  $("storageBrand").innerHTML = storageBrands.map((brand) => `<button type="button" data-v="${escapeHtml(brand)}">${escapeHtml(brand)}</button>`).join("");
  if (s.storageBrand) [...$("storageBrand").querySelectorAll("button")].forEach((b) => b.classList.toggle("active", b.dataset.v === s.storageBrand));
}

function getDistanceEntryForPlz(plz) {
  const normalized = normalizePlz(plz); return postcodeDistances.find((entry) => entry.plz === normalized) || null;
}
function getEffectiveDistanceKm() {
  if (s.distanceMode === "manual") return +s.manualDistanceKm || 0;
  return getDistanceEntryForPlz(s.plz)?.km || (+s.manualDistanceKm || 0);
}
function updateDistanceUI() {
  $("postcodeDistanceBox").classList.toggle("hidden", s.distanceMode === "manual");
  const raw = $("plz").value.trim();
  const entry = /^\d{5}$/.test(raw) ? getDistanceEntryForPlz(raw) : null;
  if (s.distanceMode === "manual") {
    $("manualDistanceBox").classList.remove("hidden");
    $("manualDistanceHint").textContent = "Bitte geben Sie die tatsächliche bzw. Ihnen bekannte Entfernung in Kilometern ein.";
  } else if (/^\d{5}$/.test(raw) && !entry) {
    $("manualDistanceBox").classList.remove("hidden");
    $("manualDistanceHint").textContent = "Diese PLZ konnte nicht gefunden werden. Bitte geben Sie die Entfernung deshalb manuell ein.";
  } else {
    $("manualDistanceBox").classList.add("hidden");
  }
  if (entry) {
    $("postcodeResult").classList.remove("hidden");
    $("postcodeResult").innerHTML = `<strong>${escapeHtml(entry.plz)} ${escapeHtml(entry.ort)}</strong><br><span>Luftlinie zu PETER JENSEN 20537 Hamburg: ca. ${formatNumber(entry.km)} km</span>`;
  } else {
    $("postcodeResult").classList.add("hidden");
  }
}

function wallboxProducts(brand = "") {
  return productsByCategory("Wallbox").filter((p) => !brand || normalizeText(p.marke) === normalizeText(brand));
}
function renderWallboxModels() {
  const brandEl = $("wallboxBrand"), modelEl = $("wallboxArticle");
  if (!brandEl || !modelEl) return;
  const brand = brandEl.value;
  const products = wallboxProducts(brand);
  modelEl.innerHTML = products.map((p) => `<option value="${escapeHtml(p.artikelnummer)}">${escapeHtml(p.artikelbezeichnung)}</option>`).join("");
  if (s.accessoryOptions.wallboxArticle && products.some((p) => p.artikelnummer === s.accessoryOptions.wallboxArticle)) modelEl.value = s.accessoryOptions.wallboxArticle;
  s.accessoryOptions.wallboxBrand = brand;
  s.accessoryOptions.wallboxArticle = modelEl.value || "";
}

function accessoryDetails() {
  if (!s.accessories.length) { $("accessoryDetails").classList.add("hidden"); $("accessoryDetails").innerHTML = ""; return; }
  $("accessoryDetails").classList.remove("hidden");
  let html = "<h3>Details zum Zubehör</h3>";

  if (s.accessories.includes("Wallbox")) {
    const brands = uniqueBrands("Wallbox");
    html += `<div class="detail-section"><h4>Wallbox</h4><div class="form2"><label>Hersteller<select id="wallboxBrand">${brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("")}</select></label><label>Ausführung<select id="wallboxArticle"></select></label></div></div>`;
  }
  if (s.accessories.includes("Zählerschrank")) {
    html += `<div class="detail-section"><h4>Zählerschrank</h4><label>Ausführung<select id="cabinet"><option value="110x55 ohne">EFH 110×55 cm – 1 Zählerplatz – ohne Bestückung</option><option value="110x55 mit">EFH 110×55 cm – 1 Zählerplatz – mit Bestückung</option><option value="110x80 ohne">EFH 110×80 cm – 2 Zählerplätze – ohne Bestückung</option><option value="110x80 mit">EFH 110×80 cm – 2 Zählerplätze – mit Bestückung</option></select></label></div>`;
  }
  if (s.accessories.includes("Optimierer")) {
    html += `<div class="hint optimizer-hint"><strong>Optimierer:</strong> Die benötigte Menge wird automatisch entsprechend der für die Berechnung gewählten Modulanzahl hinzugefügt.</div>`;
  }
  if (s.accessories.includes("Notstrom")) {
    html += `<div class="detail-section"><h4>Notstrom</h4><label>Ausführung<select id="backup"><option value="Enwitec">Netzumschaltbox Enwitec 20 kW</option><option value="PV-Point">PV-Point</option><option value="Backup Switch">Backup Switch</option><option value="Backup Controller">Backup Controller</option></select></label></div>`;
  }
  if (s.accessories.includes("Gerüst")) {
    html += `<div class="detail-section"><h4>Gerüst</h4><label>Ausrichtung<select id="scaffoldOrientation"><option value="Süd">Süd-Ausrichtung – einfache Einrüstung</option><option value="Ost/West">Ost-/West-Ausrichtung – doppelte Einrüstung</option></select></label></div>`;
  }
  $("accessoryDetails").innerHTML = html;

  if ($("wallboxBrand")) {
    const savedBrand = s.accessoryOptions.wallboxBrand;
    if (savedBrand && [...$("wallboxBrand").options].some((o) => o.value === savedBrand)) $("wallboxBrand").value = savedBrand;
    renderWallboxModels();
    $("wallboxBrand").addEventListener("change", () => { s.accessoryOptions.wallboxArticle = ""; renderWallboxModels(); markCalculationDirty(); update(); });
    $("wallboxArticle").addEventListener("change", () => { s.accessoryOptions.wallboxArticle = $("wallboxArticle").value; markCalculationDirty(); update(); });
  }
  [["cabinet", "cabinet"], ["backup", "backup"], ["scaffoldOrientation", "scaffoldOrientation"]].forEach(([id, key]) => {
    const el = $(id); if (!el) return;
    const saved = s.accessoryOptions[key];
    if (saved && [...el.options].some((o) => o.value === saved)) el.value = saved; else s.accessoryOptions[key] = el.value;
    el.addEventListener("change", () => { s.accessoryOptions[key] = el.value; markCalculationDirty(); update(); });
  });
}

function validate() {
  if (s.step === 1) return !!s.building;
  if (s.step === 2) return !!s.roof && !!s.cover;
  if (s.step === 3) {
    if (s.distanceMode === "manual") return s.manualDistanceKm > 0;
    if (!/^\d{5}$/.test(s.plz)) return false;
    return !!getDistanceEntryForPlz(s.plz) || s.manualDistanceKm > 0;
  }
  if (s.step === 4) return s.area > 0;
  if (s.step === 5) return s.consumption > 0;
  if (s.step === 6) return !!s.existing && (s.existing !== "Erweiterung gewünscht" || s.existingKwp > 0);
  if (s.step === 7) return !!s.storage && !!s.inverterBrand && (s.storage !== "Ja" || !!s.storageBrand);
  if (s.step === 9) return !!s.dateChoice || !!s.wishDate;
  return true;
}

function updateNext() {
  const ok = validate();
  $("next").disabled = !ok; $("next").style.opacity = ok ? 1 : 0.45;
  $("next").classList.toggle("next-ready-attention", ok && s.step < 10);
  $("stepHint").style.display = ok ? "none" : "block";
  $("stepHint").textContent = "Bitte vervollständigen Sie die Angaben in diesem Schritt.";
}

function renderSizingChoices() {
  const r = recommend();
  $("recommendedSizingText").textContent = `${r.recommendedModules} Module · ${formatNumber(r.recommendedKwp, 2)} kWp`;
  $("maximumSizingText").textContent = `${r.maxModules} Module · ${formatNumber(r.maxRoofKwp, 2)} kWp`;
  [...$("sizingMode").querySelectorAll("button[data-v]")].forEach((b) => b.classList.toggle("active", b.dataset.v === s.sizingMode));
}

function show(i) {
  s.step = Math.max(0, Math.min(i, s.max));
  panels.forEach((p) => p.classList.toggle("active", +p.dataset.step === s.step));
  document.querySelectorAll(".step-item").forEach((el) => {
    const n = +el.dataset.i; el.classList.toggle("active", n === s.step); el.classList.toggle("locked", n > s.max);
  });
  $("prev").style.visibility = s.step === 0 ? "hidden" : "visible";
  $("next").style.display = s.step === 10 ? "none" : "";
  $("resultPanel").classList.add("hidden"); $("configPanel").classList.remove("result-visible");
  if (s.step === 7 && s.storage === "Ja") { updateStorageSizeOptions(); storageReco(); }
  if (s.step === 10) { renderFinalCheck(); renderSizingChoices(); }
  updateNext(); window.scrollTo({ top: 0, behavior: "smooth" });
}

function update() {
  s.project = $("project").value.trim(); s.plz = $("plz").value.trim();
  s.manualDistanceKm = +$("manualDistanceKm").value || 0;
  s.area = +$("area").value || 0; s.consumption = +$("consumption").value || 0;
  s.existingKwp = +$("existingKwp").value || 0; s.existingModules = +$("existingModules").value || 0;
  s.storageSize = $("storageSize").value; s.wishDate = $("wishDate").value;
  updateDistanceUI();
  const r = recommend();
  const distance = getEffectiveDistanceKm();
  const locationText = s.distanceMode === "manual"
    ? (distance ? `${formatNumber(distance)} km ab PETER JENSEN` : "Entfernung offen")
    : (s.plz ? `${s.plz}${distance ? ` · ca. ${formatNumber(distance)} km Luftlinie` : ""}` : "PLZ offen");
  const boxes = [
    ["Projekt", s.project || "Keine Angabe"], ["Gebäude", s.building || "Noch nicht gewählt"],
    ["Dach", s.roof ? s.roof + (s.cover ? " · " + s.cover : "") : "Noch nicht gewählt"],
    ["Standort", locationText], ["Dachfläche", s.area ? `${formatNumber(s.area)} m²` : "Noch offen"],
    ["Stromverbrauch", s.consumption ? `${formatNumber(s.consumption)} kWh/Jahr` : "Noch offen"],
    ["Bestandsanlage", s.existing || "Noch nicht gewählt"],
    ["Wechselrichter", s.inverterBrand || "Hersteller noch offen"],
    ["Speicher", s.storage ? (s.storage === "Ja" ? `Gewünscht${s.storageBrand ? ` · ${s.storageBrand}` : ""}` : "Nicht gewünscht") : "Noch nicht gewählt"],
    ["Zubehör", s.accessories.length ? s.accessories.join(" · ") : "Noch nichts gewählt"],
    ["Wunschtermin", s.wishDate ? new Date(s.wishDate + "T00:00").toLocaleDateString("de-DE") : s.dateChoice || "Noch offen"],
  ];
  let html = boxes.map(([title, value]) => `<div class="summary-box"><b>${title}</b><span>${escapeHtml(value)}</span></div>`).join("");
  if (s.consumption && s.area) {
    const storageText = s.storage === "Ja" ? ` · Speicher ca. ${formatNumber(storageReco(), 1)} kWh` : "";
    html += `<div class="summary-box reco"><b>Vorläufige Empfehlung</b><span>${formatNumber(r.recommendedKwp, 2)} kWp · ${r.recommendedModules} Module${storageText}</span></div>`;
  }
  $("summary").innerHTML = html;
  if (s.step === 10) { renderFinalCheck(); renderSizingChoices(); }
  updateNext();
}

function pickInverter(requiredKwp) {
  const preferredCategory = s.storage === "Ja" ? "Wechselrichter hybrid" : "Wechselrichter strang";
  let pool = productsByCategory(preferredCategory).filter((p) => normalizeText(p.marke) === normalizeText(s.inverterBrand));
  if (!pool.length) {
    pool = ["Wechselrichter strang", "Wechselrichter hybrid"].flatMap(productsByCategory)
      .filter((p) => normalizeText(p.marke) === normalizeText(s.inverterBrand));
  }
  const sorted = pool.map((p) => ({ product: p, kw: extractPowerKw(p) })).filter((x) => x.kw > 0).sort((a, b) => a.kw - b.kw);
  return sorted.find((x) => x.kw >= Math.max(3, requiredKwp))?.product || sorted.at(-1)?.product || null;
}
function pickStorage(capacity) {
  const pool = storageProductsForBrand();
  return pool.find((x) => x.cap >= capacity - 0.05)?.product || pool.at(-1)?.product || null;
}
function pickModuleMounting() {
  if (s.roof === "Schrägdach") {
    if (s.cover.includes("Trapez")) return findByDescription(["schrägdach-modul-montage", "trapezblech"]);
    if (s.cover.includes("Stock")) return findByDescription(["schrägdach-modul-montage", "stockschrauben"]);
    return findProduct((p) => { const t = normalizeText(p.artikelbezeichnung); return t.includes("schrägdach-modul-montage") && !t.includes("trapez") && !t.includes("stockschrauben"); });
  }
  return s.cover.includes("Ost/West") ? findByDescription(["flachdach-modul-montage", "ost/west"]) : findByDescription(["flachdach-modul-montage", "süd"]);
}
function pickWallbox() { return master.find((p) => p.artikelnummer === s.accessoryOptions.wallboxArticle) || wallboxProducts(s.accessoryOptions.wallboxBrand)[0] || null; }
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
  return s.accessoryOptions.scaffoldOrientation === "Ost/West" ? findByDescription(["gerüst", "doppelt"]) : findByDescription(["gerüst", "einfach"]);
}
function pickDistanceSurcharge() {
  const km = getEffectiveDistanceKm();
  if (!km || km <= 125) return null;
  if (km <= 200) return master.find((p) => p.artikelnummer === "H66TG502001") || findByDescription(["entfernungspauschale", "125"]);
  if (km <= 300) return master.find((p) => p.artikelnummer === "H66TG502501") || findByDescription(["entfernungspauschale", "200"]);
  return master.find((p) => p.artikelnummer === "H66TG503001") || findByDescription(["entfernungspauschale", "300"]);
}
function buildProductList() {
  const r = selectedSizing(); const list = [];
  add(list, pickModuleMounting(), r.modules); add(list, pickInverter(r.kwp));
  if (s.storage === "Ja") {
    const capacity = s.storageSize === "auto" ? storageReco() : +s.storageSize; add(list, pickStorage(capacity));
  }
  if (s.accessories.includes("Wallbox")) add(list, pickWallbox());
  if (s.accessories.includes("Zählerschrank")) add(list, pickCabinet());
  if (s.accessories.includes("Optimierer")) add(list, findByDescription("tigo optimierer"), r.modules);
  if (s.accessories.includes("Notstrom")) add(list, pickBackup());
  if (s.accessories.includes("Wärmepumpenvorbereitung")) add(list, findByDescription("vorbereitung wärmepumpenanschluss"));
  if (s.accessories.includes("Gerüst")) add(list, pickScaffold());
  add(list, pickDistanceSurcharge());
  return list;
}

function renderFinalCheck() {
  const r = recommend(); const distance = getEffectiveDistanceKm();
  const storageText = s.storage === "Ja" ? `${s.storageBrand} · ${formatNumber(s.storageSize === "auto" ? storageReco() : +s.storageSize, 1)} kWh` : "nicht gewünscht";
  const location = s.distanceMode === "manual" ? `${formatNumber(distance)} km zu PETER JENSEN` : `${s.plz}${distance ? ` · ca. ${formatNumber(distance)} km Luftlinie` : ""}`;
  $("finalCheck").innerHTML = `<div class="final-check-grid">
    <div><strong>Projekt</strong><span>${escapeHtml(s.project || "Keine Angabe")}</span></div>
    <div><strong>Gebäude</strong><span>${escapeHtml(s.building)}</span></div>
    <div><strong>Dach</strong><span>${escapeHtml(`${s.roof} · ${s.cover}`)}</span></div>
    <div><strong>Standort</strong><span>${escapeHtml(location)}</span></div>
    <div><strong>Nutzbare Dachfläche</strong><span>${formatNumber(s.area)} m²</span></div>
    <div><strong>Jahresverbrauch</strong><span>${formatNumber(s.consumption)} kWh</span></div>
    <div><strong>Empfehlung</strong><span>${r.recommendedModules} Module · ${formatNumber(r.recommendedKwp, 2)} kWp</span></div>
    <div><strong>Theoretisches Maximum</strong><span>${r.maxModules} Module · ${formatNumber(r.maxRoofKwp, 2)} kWp</span></div>
    <div><strong>Wechselrichter-Hersteller</strong><span>${escapeHtml(s.inverterBrand || "offen")}</span></div>
    <div><strong>Speicher</strong><span>${escapeHtml(storageText)}</span></div>
    <div><strong>Zubehör</strong><span>${escapeHtml(s.accessories.join(" · ") || "Kein zusätzliches Zubehör")}</span></div>
    <div><strong>Wunschtermin</strong><span>${escapeHtml(s.wishDate ? new Date(s.wishDate + "T00:00").toLocaleDateString("de-DE") : s.dateChoice || "Keine Angabe")}</span></div>
  </div>`;
}

function renderTechnicalNotes() {
  if (!technicalNotes.length) { $("technicalNotes").innerHTML = '<p class="muted">In der master_tga.csv sind derzeit keine technischen Hinweise hinterlegt.</p>'; return; }
  let html = "";
  technicalNotes.forEach((note) => {
    const text = note.artikelbezeichnung.trim(); if (!text) return;
    html += text.endsWith(":") ? `<h4>${escapeHtml(text)}</h4>` : `<p>${escapeHtml(text)}</p>`;
  });
  $("technicalNotes").innerHTML = html;
}

function markCalculationDirty() {
  if (!s.calculated) return;
  s.calculationDirty = true;
  $("startCalculationBtn").textContent = "Berechnung aktualisieren";
  $("startCalculationBtn").classList.add("calc-update-attention");
}
function calculate() {
  const r = selectedSizing(); const list = buildProductList(); s.products = list;
  s.calculated = true; s.calculationDirty = false;
  $("startCalculationBtn").textContent = "Berechnung aktualisieren";
  $("startCalculationBtn").classList.remove("calc-update-attention");
  const modeText = s.sizingMode === "maximum" ? "Theoretische Maximalbelegung" : "Verbrauchsabhängige Empfehlung";
  $("recommendation").innerHTML = `<strong>${modeText}</strong><div class="metric-grid">
    <div class="metric"><span>PV-Leistung</span><br><b>${formatNumber(r.kwp, 2)} kWp</b></div>
    <div class="metric"><span>Module</span><br><b>${r.modules}</b></div>
    <div class="metric"><span>Empfehlung</span><br><b>${r.recommendedModules} Module</b></div>
    <div class="metric"><span>Theoretisch max.</span><br><b>${r.maxModules} Module</b></div>
  </div>
  <p><strong>Modulbasis:</strong> ${MODULE.model}, ${MODULE.pmaxWp} Wp, ${formatNumber(MODULE.lengthM, 3)} × ${formatNumber(MODULE.widthM, 3)} m = ${formatNumber(MODULE.areaM2, 3)} m² je Modul.</p>
  <p>Die für diese Berechnung gewählten ${r.modules} Module belegen rechnerisch ca. ${formatNumber(r.moduleAreaUsed, 2)} m², ergeben ${formatNumber(r.kwp, 2)} kWp und haben zusammen ein Modulgewicht von ca. ${formatNumber(r.moduleWeight, 1)} kg.</p>
  <p class="muted">Die theoretische Maximalbelegung berücksichtigt noch keine konkrete Dachgeometrie, Rand- und Sicherheitsabstände, Dachaufbauten, Verschattung oder Montageabstände.</p>`;
  let total = 0;
  $("resultBody").innerHTML = list.map((p, index) => {
    const unitPrice = parseGermanNumber(p.preis), rowTotal = unitPrice * p.qty; total += rowTotal;
    return `<tr><td><input type="checkbox" checked data-product-index="${index}" aria-label="Position übernehmen"></td><td>${escapeHtml(p.artikelnummer || "-")}</td><td>${escapeHtml(p.artikelbezeichnung)}</td><td>${formatNumber(p.qty, 2)}</td><td>${escapeHtml(p.einheit || "")}</td><td>${formatCurrency(unitPrice)}</td><td>${formatCurrency(rowTotal)}</td></tr>`;
  }).join("") || '<tr><td colspan="7">Noch keine passenden Positionen ermittelt.</td></tr>';
  $("resultTotalNet").textContent = formatCurrency(total);
  $("resultPanel").classList.remove("hidden"); $("configPanel").classList.add("result-visible");
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function parseMasterLine(line) {
  const parts = line.split(";"); if (parts.length < 7) return null; if (parts.length === 7) return parts;
  const articleNumber = parts[0], tail = parts.slice(-5), description = parts.slice(1, parts.length - 5).join(";").trim();
  return [articleNumber, description, ...tail];
}
async function loadMaster() {
  const response = await fetch("master_tga.csv"); if (!response.ok) throw new Error("master_tga.csv konnte nicht geladen werden.");
  const buffer = await response.arrayBuffer(); const text = new TextDecoder("windows-1252").decode(buffer).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headers = parseMasterLine(lines.shift()).map((h) => h.trim().toLowerCase());
  const rows = lines.map(parseMasterLine).filter(Boolean).map((values) => {
    const row = {}; headers.forEach((header, i) => row[header] = (values[i] || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim()); return row;
  }).filter((row, index) => !(index === 0 && normalizeText(row.artikelnummer) === "artikelnummer"));
  technicalNotes = rows.filter((row) => normalizeText(row.kategorie) === "technische hinweise");
  master = rows.filter((row) => row.artikelnummer && normalizeText(row.kategorie) !== "technische hinweise");
  renderTechnicalNotes(); renderManufacturerChoices(); accessoryDetails();
}
async function loadPostcodeDistances() {
  const response = await fetch("german-postgeocodes.csv"); if (!response.ok) throw new Error("german-postgeocodes.csv konnte nicht geladen werden.");
  const text = new TextDecoder("utf-8").decode(await response.arrayBuffer()).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const headers = lines.shift().split(";").map((h) => h.trim().toLowerCase());
  postcodeDistances = lines.map((line) => {
    const values = line.split(";"); const row = {}; headers.forEach((h, i) => row[h] = values[i] || "");
    return { ort: row.ort || "", plz: normalizePlz(row.plz), bundesland: row.bundesland || "", km: parseGermanNumber(row.km) };
  }).filter((row) => row.plz && row.km > 0);
}

initSteps();
choose("building", "building", markCalculationDirty);
choose("roof", "roof", (v) => { coverOptions(); markCalculationDirty(); });
choose("cover", "cover", () => { markCalculationDirty(); });
choose("existing", "existing", (v) => { $("existingDetails").classList.toggle("hidden", v !== "Erweiterung gewünscht"); markCalculationDirty(); });
choose("storage", "storage", (v) => { $("storageDetails").classList.toggle("hidden", v !== "Ja"); if (v === "Ja") { updateStorageSizeOptions(); storageReco(); } markCalculationDirty(); });
choose("dateChoice", "dateChoice");
choose("consumptionQuick", "_quickConsumption", (v) => { $("consumption").value = v; s.consumption = +v; markCalculationDirty(); });

$("distanceModeChoices").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  [...$("distanceModeChoices").querySelectorAll("button")].forEach((x) => x.classList.toggle("active", x === b));
  s.distanceMode = b.dataset.v; updateDistanceUI(); update();
});
$("inverterBrand").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  [...$("inverterBrand").querySelectorAll("button")].forEach((x) => x.classList.toggle("active", x === b));
  s.inverterBrand = b.dataset.v; markCalculationDirty(); update();
});
$("storageBrand").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  [...$("storageBrand").querySelectorAll("button")].forEach((x) => x.classList.toggle("active", x === b));
  s.storageBrand = b.dataset.v; s.storageSize = "auto"; updateStorageSizeOptions(); markCalculationDirty(); update();
});
$("sizingMode").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]"); if (!b || s.sizingMode === b.dataset.v) return;
  s.sizingMode = b.dataset.v; renderSizingChoices(); markCalculationDirty(); renderFinalCheck();
});

$("accessories").onclick = (e) => {
  const button = e.target.closest("button[data-v]"); if (!button) return;
  const value = button.dataset.v; button.classList.toggle("active");
  s.accessories = button.classList.contains("active") ? [...new Set([...s.accessories, value])] : s.accessories.filter((x) => x !== value);
  accessoryDetails(); markCalculationDirty(); update();
};

["project", "plz", "manualDistanceKm", "area", "consumption", "existingKwp", "existingModules", "wishDate"].forEach((id) => {
  $(id).addEventListener("input", () => { if (["area", "consumption", "existingKwp", "existingModules"].includes(id)) markCalculationDirty(); update(); });
});
$("storageSize").addEventListener("change", () => { s.storageSize = $("storageSize").value; markCalculationDirty(); update(); });

$("next").onclick = () => { if (!validate()) return; s.max = Math.max(s.max, s.step + 1); show(s.step + 1); };
$("prev").onclick = () => show(s.step - 1);
$("clear").onclick = () => { if (confirm("Möchten Sie wirklich alle Eingaben löschen?")) location.reload(); };
$("startCalculationBtn").onclick = calculate;
$("backToConfigBtn").onclick = () => { $("resultPanel").classList.add("hidden"); $("configPanel").classList.remove("result-visible"); show(10); };

Promise.all([loadMaster(), loadPostcodeDistances()]).then(() => {
  updateDistanceUI(); update(); show(0);
  console.info(`Daten geladen: ${master.length} Artikel, ${technicalNotes.length} Hinweise, ${postcodeDistances.length} PLZ-Einträge.`);
}).catch((error) => {
  console.error(error);
  $("technicalNotes").innerHTML = `<p class="warning-text">Die Artikel- oder PLZ-Daten konnten nicht geladen werden. Bitte prüfen Sie, ob master_tga.csv und german-postgeocodes.csv im gleichen Ordner wie index.html liegen.</p>`;
  update(); show(0);
});
