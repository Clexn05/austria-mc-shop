const grid = document.querySelector("#rank-grid");
const tpl = document.querySelector("#rank-template");
const checkout = document.querySelector("#checkout-dialog");
const checkoutForm = document.querySelector("#checkout-form");
const statusDialog = document.querySelector("#status-dialog");

let products = [];

function euro(cents) {
  return new Intl.NumberFormat("de-AT", { style:"currency", currency:"EUR" }).format(cents / 100);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function prefixHtml(legacy) {
  const map = {
    "0":"#000","1":"#0000aa","2":"#00aa00","3":"#00aaaa","4":"#aa0000","5":"#aa00aa","6":"#ffaa00","7":"#aaaaaa",
    "8":"#555","9":"#5555ff","a":"#55ff55","b":"#55ffff","c":"#ff5555","d":"#ff55ff","e":"#ffff55","f":"#fff"
  };
  let color = "#ddd", out = "";
  const parts = String(legacy).split(/(&[0-9a-fklmnor])/i);
  for (const part of parts) {
    const m = part.match(/^&([0-9a-f])$/i);
    if (m) { color = map[m[1].toLowerCase()] || color; continue; }
    if (/^&[klmnor]$/i.test(part)) continue;
    out += `<span style="color:${color}">${escapeHtml(part)}</span>`;
  }
  return out;
}

async function loadProducts() {
  const res = await fetch("/api/products");
  if (!res.ok) throw new Error("Produkte konnten nicht geladen werden.");
  const data = await res.json();
  products = data.products;
  grid.innerHTML = "";

  for (const p of products) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector(".rank-card");
    card.style.setProperty("--accent", p.accent);
    node.querySelector(".rank-name").textContent = p.name;
    node.querySelector(".rank-price").textContent = euro(p.priceCents);
    node.querySelector(".rank-desc").textContent = p.description;
    node.querySelector(".prefix-preview").innerHTML = prefixHtml(p.prefix);

    const benefits = node.querySelector(".benefits");
    p.permissions.slice(0, 6).forEach(x => {
      const li = document.createElement("li");
      li.textContent = x.command ? `${x.command} — ${x.label}` : x.label;
      benefits.appendChild(li);
    });

    const list = node.querySelector(".permission-list");
    p.permissions.forEach(x => {
      const item = document.createElement("div");
      item.className = "perm";
      item.innerHTML = `<b>${escapeHtml(x.command || x.label)}</b><code>${escapeHtml(x.permission)}</code>`;
      list.appendChild(item);
    });

    node.querySelector(".buy-btn").addEventListener("click", () => openCheckout(p));
    grid.appendChild(node);
  }
}

function openCheckout(product) {
  document.querySelector("#productId").value = product.id;
  document.querySelector("#checkout-title").textContent = `${product.name} kaufen`;
  document.querySelector("#checkout-price").textContent = `${euro(product.priceCents)} einmalig`;
  document.querySelector("#form-status").textContent = "";
  checkout.showModal();
}

document.querySelector("#close-checkout").addEventListener("click", () => checkout.close());
document.querySelector("#close-status").addEventListener("click", () => statusDialog.close());

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#form-status");
  const submit = checkoutForm.querySelector(".submit");
  submit.disabled = true;
  status.textContent = "Zahlung wird vorbereitet …";

  const fd = new FormData(checkoutForm);
  const payload = Object.fromEntries(fd.entries());

  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout fehlgeschlagen.");
    if (!data.checkoutUrl) throw new Error("Keine Checkout-URL erhalten.");
    location.href = data.checkoutUrl;
  } catch (err) {
    status.textContent = err.message || String(err);
    submit.disabled = false;
  }
});

for (const el of document.querySelectorAll("[data-copy]")) {
  el.addEventListener("click", async () => {
    await navigator.clipboard.writeText(el.dataset.copy);
    const old = el.textContent;
    el.textContent = "Kopiert ✓";
    setTimeout(() => el.textContent = old, 1400);
  });
}

let currentOrder = null;
async function showOrderStatus(orderId) {
  currentOrder = orderId;
  statusDialog.showModal();
  const title = document.querySelector("#status-title");
  const copy = document.querySelector("#status-copy");
  title.textContent = "Bestellung wird geprüft …";
  copy.textContent = "";

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Bestellung nicht gefunden.");

    const states = {
      PAID: ["Zahlung bestätigt ✓", "Deine Zahlung ist eingegangen. Der Rang wartet auf die Freischaltung im Netzwerk."],
      AUTHORIZED: ["Zahlung autorisiert", "Die Zahlung wurde autorisiert und wird verarbeitet."],
      OPEN: ["Zahlung offen", "Die Zahlung ist noch nicht abgeschlossen."],
      PENDING: ["Zahlung wird verarbeitet", "Der Zahlungsanbieter verarbeitet die Zahlung noch."],
      FAILED: ["Zahlung fehlgeschlagen", "Die Zahlung wurde nicht erfolgreich abgeschlossen."],
      CANCELED: ["Zahlung abgebrochen", "Die Zahlung wurde abgebrochen."],
      EXPIRED: ["Zahlung abgelaufen", "Die Zahlungsfrist ist abgelaufen."],
      CREATED: ["Bestellung erstellt", "Die Zahlung wurde noch nicht gestartet."]
    };
    const [t, c] = states[data.payment_status] || ["Bestellstatus", data.payment_status];
    title.textContent = t;
    copy.textContent = `${data.display_name} für ${data.minecraft_name}. ${c} Freischaltung: ${data.fulfillment_status}.`;
  } catch (err) {
    title.textContent = "Status konnte nicht geladen werden";
    copy.textContent = err.message || String(err);
  }
}

document.querySelector("#refresh-status").addEventListener("click", () => currentOrder && showOrderStatus(currentOrder));

const qs = new URLSearchParams(location.search);
if (qs.get("order")) {
  showOrderStatus(qs.get("order"));
}

loadProducts().catch(err => {
  grid.innerHTML = `<div class="loading-card">${escapeHtml(err.message || String(err))}</div>`;
});
