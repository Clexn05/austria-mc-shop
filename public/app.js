const grid = document.querySelector("#rank-grid");
const tpl = document.querySelector("#rank-template");
const checkout = document.querySelector("#checkout-dialog");
const checkoutForm = document.querySelector("#checkout-form");
const statusDialog = document.querySelector("#status-dialog");
const cardFieldsWrap = document.querySelector("#card-fields-wrap");
const cardStatus = document.querySelector("#card-status");
const checkoutSubmit = checkoutForm.querySelector(".submit");

let products = [];
let paypalSdkUrl = "";
let cardSession = null;
let cardInitPromise = null;

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
    const iconMap = {
      "spuela-plus": "✦",
      "vip": "★",
      "vip-plus": "♛",
      "builder": "⚒"
    };
    node.querySelector(".rank-icon").textContent = iconMap[p.id] || "◆";
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

function selectedPaymentMethod() {
  return checkoutForm.querySelector('input[name="paymentMethod"]:checked')?.value || "paypal";
}

function updatePaymentUi() {
  const method = selectedPaymentMethod();
  const isCard = method === "card";
  cardFieldsWrap.hidden = !isCard;
  checkoutSubmit.textContent = isCard ? "Jetzt mit Karte bezahlen" : "Weiter zu PayPal";

  if (isCard) {
    initCardFields().catch(err => {
      cardStatus.textContent = err.message || String(err);
      disableCardMethod("Karte (nicht verfügbar)");
    });
  }
}

function openCheckout(product) {
  document.querySelector("#productId").value = product.id;
  document.querySelector("#checkout-title").textContent = `${product.name} kaufen`;
  document.querySelector("#checkout-price").textContent = `${euro(product.priceCents)} einmalig · Endpreis`;
  document.querySelector("#form-status").textContent = "";
  updatePaymentUi();
  checkout.showModal();
}

document.querySelector("#close-checkout").addEventListener("click", () => checkout.close());
document.querySelector("#close-status").addEventListener("click", () => statusDialog.close());

for (const radio of document.querySelectorAll('input[name="paymentMethod"]')) {
  radio.addEventListener("change", updatePaymentUi);
}

function loadExternalScript(src) {
  if (window.paypal?.createInstance) return Promise.resolve();
  const existing = [...document.scripts].find(s => s.src === src);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal SDK konnte nicht geladen werden.")), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("PayPal SDK konnte nicht geladen werden.")), { once: true });
    document.head.appendChild(script);
  });
}

function disableCardMethod(labelText) {
  const radio = checkoutForm.querySelector('input[name="paymentMethod"][value="card"]');
  if (!radio) return;
  radio.disabled = true;
  const label = radio.closest("label");
  if (label) {
    label.classList.add("disabled");
    const span = label.querySelector("span");
    if (span) span.textContent = labelText;
  }
  if (radio.checked) {
    const paypal = checkoutForm.querySelector('input[name="paymentMethod"][value="paypal"]:not(:disabled)');
    if (paypal) paypal.checked = true;
  }
  cardFieldsWrap.hidden = true;
  checkoutSubmit.textContent = "Weiter zu PayPal";
}

async function initCardFields() {
  if (cardSession) return cardSession;
  if (cardInitPromise) return cardInitPromise;

  cardInitPromise = (async () => {
    if (!paypalSdkUrl) throw new Error("Kartenzahlung ist noch nicht eingerichtet.");
    cardStatus.textContent = "Sichere Kartenfelder werden über PayPal geladen …";

    const [tokenResponse] = await Promise.all([
      fetch("/api/paypal/client-token"),
      loadExternalScript(paypalSdkUrl),
    ]);
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.accessToken) {
      throw new Error(tokenData.error || "PayPal-Kartenzahlung konnte nicht initialisiert werden.");
    }

    const sdk = await window.paypal.createInstance({
      clientToken: tokenData.accessToken,
      components: ["card-fields"],
      pageType: "checkout",
    });
    const methods = await sdk.findEligibleMethods({ currencyCode: "EUR" });
    if (!methods.isEligible("advanced_cards")) {
      throw new Error("Kartenzahlung ist für dieses PayPal-Konto noch nicht freigeschaltet.");
    }

    const session = sdk.createCardFieldsOneTimePaymentSession();
    const fieldStyle = {
      input: {
        fontSize: "16px",
        lineHeight: "24px",
        color: "#171a1f",
        padding: "10px 12px",
      },
    };
    const numberField = session.createCardFieldsComponent({ type: "number", placeholder: "Kartennummer", style: fieldStyle });
    const expiryField = session.createCardFieldsComponent({ type: "expiry", placeholder: "MM/JJ", style: fieldStyle });
    const cvvField = session.createCardFieldsComponent({ type: "cvv", placeholder: "CVC", style: fieldStyle });

    document.querySelector("#paypal-card-fields-number").replaceChildren(numberField);
    document.querySelector("#paypal-card-fields-expiry").replaceChildren(expiryField);
    document.querySelector("#paypal-card-fields-cvv").replaceChildren(cvvField);

    cardSession = session;
    cardStatus.textContent = "Kartendaten werden direkt von PayPal verarbeitet und nicht auf Austria-MC gespeichert.";
    return session;
  })();

  try {
    return await cardInitPromise;
  } catch (err) {
    cardInitPromise = null;
    throw err;
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Zahlung konnte nicht vorbereitet werden.");
  return data;
}

async function handleCardCheckout(payload) {
  const session = await initCardFields();
  const created = await postJson("/api/paypal/card/order", payload);
  if (!created.paypalOrderId || !created.orderId) throw new Error("PayPal-Kartenbestellung konnte nicht erstellt werden.");

  const result = await session.submit(created.paypalOrderId, {
    billingAddress: {
      streetAddress: String(payload.streetAndNumber || ""),
      city: String(payload.city || ""),
      postalCode: String(payload.postalCode || ""),
      countryCode: String(payload.country || "AT").toUpperCase(),
    },
  });

  if (result.state === "canceled") {
    throw new Error("Kartenprüfung wurde abgebrochen. Du kannst es erneut versuchen.");
  }
  if (result.state === "failed") {
    throw new Error(result.data?.message || "Kartenzahlung wurde abgelehnt. Bitte Kartendaten prüfen oder PayPal verwenden.");
  }
  if (result.state !== "succeeded") {
    throw new Error("Kartenzahlung ist noch nicht abgeschlossen. Bitte erneut versuchen.");
  }

  const paypalOrderId = result.data?.orderId || created.paypalOrderId;
  const captured = await postJson(`/api/paypal/card/orders/${encodeURIComponent(paypalOrderId)}/capture`);
  if (!captured.orderId) throw new Error("Zahlung wurde verarbeitet, aber der Bestellstatus konnte nicht geladen werden.");
  location.href = `/?order=${encodeURIComponent(captured.orderId)}`;
}

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#form-status");
  const submit = checkoutSubmit;
  submit.disabled = true;
  status.textContent = "Rang wird geprüft und Zahlung vorbereitet …";

  const fd = new FormData(checkoutForm);
  const payload = Object.fromEntries(fd.entries());

  try {
    if (payload.paymentMethod === "card") {
      status.textContent = "Rang wird geprüft, danach wird die Karte sicher über PayPal verarbeitet …";
      await handleCardCheckout(payload);
      return;
    }

    const data = await postJson("/api/checkout", payload);
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

async function loadPaymentMethods() {
  const res = await fetch("/api/payment-methods");
  if (!res.ok) return;
  const data = await res.json();
  const methods = data.methods || {};
  paypalSdkUrl = methods.card?.sdkUrl || "";

  const labels = {
    paypal: "PayPal",
    card: "Kredit-/Debitkarte",
  };
  const radios = [...document.querySelectorAll('input[name="paymentMethod"]')];
  let firstEnabled = null;
  for (const radio of radios) {
    const info = methods[radio.value];
    const enabled = Boolean(info?.enabled);
    radio.disabled = !enabled;
    const label = radio.closest("label");
    if (label) {
      label.classList.toggle("disabled", !enabled);
      const span = label.querySelector("span");
      if (span) {
        const base = labels[radio.value] || radio.value;
        span.textContent = enabled ? base : `${base} (noch nicht eingerichtet)`;
      }
    }
    if (enabled && !firstEnabled) firstEnabled = radio;
  }
  const selected = radios.find(r => r.checked && !r.disabled);
  if (!selected && firstEnabled) firstEnabled.checked = true;
  updatePaymentUi();
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

loadPaymentMethods().catch(() => {});

loadProducts().catch(err => {
  grid.innerHTML = `<div class="loading-card">${escapeHtml(err.message || String(err))}</div>`;
});
