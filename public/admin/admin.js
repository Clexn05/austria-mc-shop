const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const loginView = $("#login-view");
const adminView = $("#admin-view");
const toastEl = $("#toast");
let products = [];
let currentUser = null;

function euro(cents) {
  return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format((Number(cents) || 0) / 100);
}
function fmtDate(value) {
  if (!value) return "–";
  const d = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" }).format(d);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}
function toast(message, bad = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("bad", bad);
  toastEl.hidden = false;
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!["GET", "HEAD"].includes(method)) headers.set("x-austria-admin", "1");
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function showLogin() {
  loginView.hidden = false;
  adminView.hidden = true;
  currentUser = null;
}
function showAdmin(user) {
  currentUser = user;
  loginView.hidden = true;
  adminView.hidden = false;
  $("#admin-username").textContent = user.username;
}

async function bootstrap() {
  try {
    const session = await api("/api/admin/session");
    showAdmin(session);
    await Promise.all([loadOverview(), loadProducts()]);
  } catch {
    showLogin();
  }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#login-error");
  error.textContent = "";
  const submit = e.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#login-username").value.trim(), password: $("#login-password").value })
    });
    showAdmin(data);
    $("#login-password").value = "";
    await Promise.all([loadOverview(), loadProducts()]);
  } catch (err) {
    error.textContent = err.message || String(err);
  } finally {
    submit.disabled = false;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
  showLogin();
});

const pageNames = {
  overview: "Übersicht",
  orders: "Bestellungen",
  products: "Ränge & Rechte",
  test: "Testkauf",
  database: "Datenbank",
  account: "Zugang"
};
async function goPage(page) {
  $$("#admin-nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $$(".admin-page").forEach(v => v.classList.toggle("active", v.dataset.pageView === page));
  $("#page-title").textContent = pageNames[page] || "Admin";
  if (page === "overview") await loadOverview();
  if (page === "orders") await loadOrders();
  if (page === "products") await loadProducts();
  if (page === "database") await loadDatabaseTables();
}
$("#admin-nav").addEventListener("click", e => {
  const btn = e.target.closest("button[data-page]");
  if (btn) goPage(btn.dataset.page).catch(err => toast(err.message, true));
});
$$('[data-goto]').forEach(b => b.addEventListener("click", () => goPage(b.dataset.goto)));

function statusBadge(value) {
  return `<span class="status ${esc(value)}">${esc(value)}</span>`;
}

async function loadOverview() {
  const data = await api("/api/admin/overview");
  const s = data.stats;
  $("#stat-grid").innerHTML = `
    <article class="stat"><small>Bestellungen</small><b>${s.orders}</b></article>
    <article class="stat green"><small>Bezahlt</small><b>${s.paid}</b></article>
    <article class="stat yellow"><small>Rang wartet</small><b>${s.pendingFulfillment}</b></article>
    <article class="stat blue"><small>Umsatz bezahlt</small><b>${euro(s.revenueCents)}</b></article>
    <article class="stat red"><small>Testkäufe</small><b>${s.testOrders}</b></article>`;
  $("#recent-orders").innerHTML = (data.recent || []).map(o => `
    <tr><td>${esc(fmtDate(o.created_at))}</td><td><b>${esc(o.minecraft_name)}</b></td><td>${esc(o.display_name)}</td>
    <td>${euro(o.price_cents)}</td><td>${statusBadge(o.payment_status)}</td><td>${statusBadge(o.fulfillment_status)}</td></tr>`).join("");
}

async function loadOrders() {
  const q = $("#order-search").value.trim();
  const payment = $("#order-payment-filter").value;
  const fulfillment = $("#order-fulfillment-filter").value;
  const params = new URLSearchParams({ limit: "200" });
  if (q) params.set("q", q);
  if (payment) params.set("payment", payment);
  if (fulfillment) params.set("fulfillment", fulfillment);
  const data = await api(`/api/admin/orders?${params}`);
  const body = $("#orders-body");
  body.innerHTML = (data.orders || []).map(o => {
    const isTest = o.provider_name === "admin-test";
    const canRetry = o.payment_status === "PAID" && o.fulfillment_status !== "PENDING";
    return `<tr>
      <td>${esc(fmtDate(o.created_at))}<div class="muted mono">${esc(o.id.slice(0, 8))}…</div></td>
      <td><b>${esc(o.minecraft_name)}</b><div class="muted">${esc(o.customer_email || "")}</div></td>
      <td>${esc(o.display_name)}<div class="muted mono">${esc(o.luckperms_group)}</div></td>
      <td>${euro(o.price_cents)}</td><td>${esc(o.provider_name || o.payment_method || "–")}${isTest ? '<div class="muted">TEST</div>' : ''}</td>
      <td>${statusBadge(o.payment_status)}</td><td>${statusBadge(o.fulfillment_status)}${o.fulfillment_message ? `<div class="muted">${esc(o.fulfillment_message)}</div>` : ''}</td>
      <td><div class="filters">
        ${canRetry ? `<button class="btn secondary small" data-order-retry="${esc(o.id)}">Erneut freischalten</button>` : ''}
        ${isTest ? `<button class="btn danger small" data-order-delete="${esc(o.id)}">Test löschen</button>` : ''}
      </div></td>
    </tr>`;
  }).join("");
  $("#orders-empty").hidden = Boolean(data.orders?.length);
}
$("#refresh-orders").addEventListener("click", () => loadOrders().catch(err => toast(err.message, true)));
$("#order-search").addEventListener("keydown", e => { if (e.key === "Enter") loadOrders(); });
$("#orders-body").addEventListener("click", async e => {
  const retry = e.target.closest("[data-order-retry]");
  const del = e.target.closest("[data-order-delete]");
  try {
    if (retry) {
      if (!confirm("Diesen bezahlten Auftrag erneut auf PENDING setzen?")) return;
      await api(`/api/admin/orders/${retry.dataset.orderRetry}/retry`, { method: "POST", body: "{}" });
      toast("Auftrag wartet wieder auf AustriaShopBridge.");
      await loadOrders();
    }
    if (del) {
      if (!confirm("Diesen Testkauf wirklich löschen?")) return;
      await api(`/api/admin/orders/${del.dataset.orderDelete}`, { method: "DELETE" });
      toast("Testkauf gelöscht.");
      await loadOrders();
    }
  } catch (err) { toast(err.message, true); }
});

async function loadProducts() {
  const data = await api("/api/admin/products");
  products = data.products || [];
  renderProducts();
  $("#test-product").innerHTML = products.filter(p => p.active).map(p => `<option value="${esc(p.id)}">${esc(p.display_name)} – ${euro(p.price_cents)}</option>`).join("");
}
$("#refresh-products").addEventListener("click", () => loadProducts().catch(err => toast(err.message, true)));

function renderProducts() {
  $("#products-admin").innerHTML = products.map(p => `
    <article class="product-admin-card" style="--accent:${esc(p.accent_hex)}" data-product-card="${esc(p.id)}">
      <div><h3>${esc(p.display_name)}</h3><div class="product-id">${esc(p.id)}</div></div>
      <div class="product-fields">
        <label>Name<input data-field="display_name" value="${esc(p.display_name)}" /></label>
        <label>LuckPerms-Gruppe<input data-field="luckperms_group" value="${esc(p.luckperms_group)}" /></label>
        <label>Preis in Cent<input data-field="price_cents" type="number" min="0" value="${Number(p.price_cents)}" /></label>
        <label>Akzentfarbe<input data-field="accent_hex" type="color" value="${esc(p.accent_hex)}" /></label>
        <label class="full">Prefix<input data-field="prefix_legacy" value="${esc(p.prefix_legacy)}" /></label>
        <label class="full">Beschreibung<textarea data-field="description">${esc(p.description)}</textarea></label>
        <label>Reihenfolge<input data-field="display_order" type="number" value="${Number(p.display_order)}" /></label>
        <label>Aktiv<select data-field="active"><option value="1" ${p.active ? "selected" : ""}>Ja</option><option value="0" ${!p.active ? "selected" : ""}>Nein</option></select></label>
      </div>
      <div class="product-actions"><button class="btn primary small" data-product-save="${esc(p.id)}">Rang speichern</button><span class="muted">${p.permissions.length} Rechte</span></div>
      <div class="permission-admin">
        <div class="permission-admin-head"><h4>LuckPerms-Rechte</h4><button class="btn secondary small" data-perm-add="${esc(p.id)}">+ Recht</button></div>
        <div>${p.permissions.map(x => `
          <div class="permission-row"><div><b>${esc(x.command_hint || x.benefit_label)}</b><code>${esc(x.permission_node)}</code><div class="muted">${esc(x.benefit_label)}</div></div>
          <div class="perm-actions"><button class="btn secondary small" data-perm-edit="${Number(x.id)}" data-product-id="${esc(p.id)}">Bearbeiten</button><button class="btn danger small" data-perm-delete="${Number(x.id)}">×</button></div></div>`).join("")}</div>
      </div>
    </article>`).join("");
}

$("#products-admin").addEventListener("click", async e => {
  const save = e.target.closest("[data-product-save]");
  const add = e.target.closest("[data-perm-add]");
  const edit = e.target.closest("[data-perm-edit]");
  const del = e.target.closest("[data-perm-delete]");
  try {
    if (save) {
      const card = save.closest("[data-product-card]");
      const payload = {};
      $$('[data-field]', card).forEach(input => payload[input.dataset.field] = input.value);
      payload.price_cents = Number(payload.price_cents);
      payload.display_order = Number(payload.display_order);
      payload.active = Number(payload.active);
      await api(`/api/admin/products/${encodeURIComponent(save.dataset.productSave)}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast("Rang gespeichert.");
      await loadProducts();
    }
    if (add) openPermission({ productId: add.dataset.permAdd });
    if (edit) {
      const p = products.find(x => x.id === edit.dataset.productId);
      const perm = p?.permissions.find(x => Number(x.id) === Number(edit.dataset.permEdit));
      if (perm) openPermission({ ...perm, productId: p.id });
    }
    if (del) {
      if (!confirm("Dieses Recht aus der Shop-Anzeige löschen?")) return;
      await api(`/api/admin/permissions/${del.dataset.permDelete}`, { method: "DELETE" });
      toast("Recht gelöscht.");
      await loadProducts();
    }
  } catch (err) { toast(err.message, true); }
});

const permissionDialog = $("#permission-dialog");
const permissionForm = $("#permission-form");
function openPermission(data) {
  permissionForm.reset();
  permissionForm.elements.id.value = data.id || "";
  permissionForm.elements.productId.value = data.productId || "";
  permissionForm.elements.permissionNode.value = data.permission_node || "";
  permissionForm.elements.commandHint.value = data.command_hint || "";
  permissionForm.elements.benefitLabel.value = data.benefit_label || "";
  permissionForm.elements.displayOrder.value = data.display_order ?? 10;
  permissionDialog.showModal();
}
$("#permission-close").addEventListener("click", () => permissionDialog.close());
permissionForm.addEventListener("submit", async e => {
  e.preventDefault();
  const fd = new FormData(permissionForm);
  const payload = Object.fromEntries(fd.entries());
  payload.displayOrder = Number(payload.displayOrder);
  const id = payload.id; delete payload.id;
  try {
    if (id) await api(`/api/admin/permissions/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    else await api(`/api/admin/products/${encodeURIComponent(payload.productId)}/permissions`, { method: "POST", body: JSON.stringify(payload) });
    permissionDialog.close(); toast("Recht gespeichert."); await loadProducts();
  } catch (err) { toast(err.message, true); }
});

$("#test-purchase-form").addEventListener("submit", async e => {
  e.preventDefault();
  const out = $("#test-result");
  out.className = "form-message";
  out.textContent = "Testauftrag wird angelegt …";
  const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
  try {
    const data = await api("/api/admin/test-purchase", { method: "POST", body: JSON.stringify(payload) });
    out.classList.add("good");
    out.innerHTML = `Testkauf erstellt: <span class="mono">${esc(data.order.id)}</span><br>${esc(data.order.minecraft_name)} → ${esc(data.order.luckperms_group)}. AustriaShopBridge kann ihn jetzt abholen.`;
    toast("Testkauf erfolgreich erstellt.");
  } catch (err) {
    out.classList.add("bad"); out.textContent = err.message || String(err);
  }
});

async function loadDatabaseTables() {
  const data = await api("/api/admin/database/tables");
  $("#db-table").innerHTML = data.tables.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  await loadDatabaseTable();
}
async function loadDatabaseTable() {
  const table = $("#db-table").value;
  if (!table) return;
  const data = await api(`/api/admin/database/${encodeURIComponent(table)}?limit=250`);
  const cols = data.columns || [];
  $("#db-meta").textContent = `${data.count} Datensätze • angezeigt: ${data.rows.length} • Tabelle: ${table}`;
  $("#db-head").innerHTML = `<tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>`;
  $("#db-body").innerHTML = data.rows.map(row => `<tr>${cols.map(c => `<td title="${esc(row[c])}">${esc(row[c] ?? "")}</td>`).join("")}</tr>`).join("");
}
$("#load-table").addEventListener("click", () => loadDatabaseTable().catch(err => toast(err.message, true)));

$("#account-form").addEventListener("submit", async e => {
  e.preventDefault();
  const result = $("#account-result");
  result.className = "form-message";
  const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
  if (!payload.newUsername) delete payload.newUsername;
  if (!payload.newPassword) delete payload.newPassword;
  try {
    const data = await api("/api/admin/account", { method: "POST", body: JSON.stringify(payload) });
    result.classList.add("good"); result.textContent = "Admin-Zugang wurde aktualisiert.";
    $("#admin-username").textContent = data.username;
    e.currentTarget.reset();
    toast("Zugangsdaten gespeichert.");
  } catch (err) {
    result.classList.add("bad"); result.textContent = err.message || String(err);
  }
});

bootstrap();
