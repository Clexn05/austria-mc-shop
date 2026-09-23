interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STORE_BASE_URL: string;
  FULFILLMENT_TOKEN: string;

  ADMIN_BOOTSTRAP_USERNAME?: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
  ADMIN_SECRET?: string;

  PAYPAL_ENV?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;

  KLARNA_ENV?: string;
  KLARNA_USERNAME?: string;
  KLARNA_PASSWORD?: string;
  KLARNA_API_BASE?: string;

  PAYSAFECARD_ENV?: string;
  PAYSAFECARD_API_KEY?: string;
  PAYSAFECARD_API_BASE?: string;
}

type PaymentMethod = "paypal" | "paysafecard" | "klarna";

type CheckoutBody = {
  productId: string;
  minecraftName: string;
  paymentMethod: PaymentMethod;
  email: string;
  givenName: string;
  familyName: string;
  streetAndNumber: string;
  postalCode: string;
  city: string;
  country: string;
};

type ShopOrder = {
  id: string;
  minecraft_name: string;
  product_id: string;
  luckperms_group: string;
  price_cents: number;
  currency: string;
  payment_method: PaymentMethod;
  payment_status: string;
  fulfillment_status: string;
  provider_name: string | null;
  provider_payment_id: string | null;
  provider_session_id: string | null;
  provider_order_id: string | null;
  customer_email: string;
  given_name: string;
  family_name: string;
  street_and_number: string;
  postal_code: string;
  city: string;
  country: string;
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function redirect(url: string, status = 302) {
  return new Response(null, { status, headers: { location: url } });
}

function cleanBase(url: string) {
  return url.replace(/\/+$/, "");
}

function isMinecraftName(value: string) {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

function isCountry(value: string) {
  return /^[A-Z]{2}$/.test(value);
}

function authFulfillment(request: Request, env: Env) {
  return request.headers.get("authorization") === `Bearer ${env.FULFILLMENT_TOKEN}`;
}

function methodEnabled(env: Env, method: PaymentMethod) {
  if (method === "paypal") return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  if (method === "klarna") return Boolean(env.KLARNA_USERNAME && env.KLARNA_PASSWORD);
  if (method === "paysafecard") return Boolean(env.PAYSAFECARD_API_KEY);
  return false;
}

function paymentMethodInfo(env: Env) {
  return {
    paypal: {
      enabled: methodEnabled(env, "paypal"),
      mode: (env.PAYPAL_ENV || "sandbox").toLowerCase(),
    },
    klarna: {
      enabled: methodEnabled(env, "klarna"),
      mode: (env.KLARNA_ENV || "playground").toLowerCase(),
    },
    paysafecard: {
      enabled: methodEnabled(env, "paysafecard"),
      mode: (env.PAYSAFECARD_ENV || "test").toLowerCase(),
    },
  };
}

async function apiJson(url: string, init: RequestInit, provider: string) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    console.error(`${provider} API error`, response.status, body);
    throw new Error(`${provider} API returned ${response.status}`);
  }
  return body;
}

async function getProducts(env: Env) {
  const productsResult = await env.DB.prepare(
    `SELECT id, display_name, luckperms_group, price_cents, prefix_legacy,
            accent_hex, description, display_order
     FROM products
     WHERE active = 1
     ORDER BY display_order ASC`
  ).all<any>();

  const permissionsResult = await env.DB.prepare(
    `SELECT product_id, permission_node, command_hint, benefit_label, display_order
     FROM product_permissions
     ORDER BY product_id, display_order ASC`
  ).all<any>();

  const grouped = new Map<string, any[]>();
  for (const p of permissionsResult.results || []) {
    if (!grouped.has(p.product_id)) grouped.set(p.product_id, []);
    grouped.get(p.product_id)!.push({
      permission: p.permission_node,
      command: p.command_hint,
      label: p.benefit_label,
    });
  }

  return (productsResult.results || []).map((p: any) => ({
    id: p.id,
    name: p.display_name,
    group: p.luckperms_group,
    priceCents: p.price_cents,
    prefix: p.prefix_legacy,
    accent: p.accent_hex,
    description: p.description,
    permissions: grouped.get(p.id) || [],
  }));
}

async function getShopOrder(env: Env, orderId: string) {
  return env.DB.prepare(
    `SELECT id, minecraft_name, product_id, luckperms_group, price_cents, currency,
            payment_method, payment_status, fulfillment_status,
            provider_name, provider_payment_id, provider_session_id, provider_order_id,
            customer_email, given_name, family_name, street_and_number,
            postal_code, city, country
     FROM shop_orders WHERE id = ? LIMIT 1`
  ).bind(orderId).first<ShopOrder>();
}

async function markPaid(env: Env, orderId: string, providerOrderId?: string | null) {
  await env.DB.prepare(
    `UPDATE shop_orders
     SET payment_status = 'PAID',
         fulfillment_status = CASE
           WHEN fulfillment_status = 'WAITING_PAYMENT' THEN 'PENDING'
           ELSE fulfillment_status
         END,
         provider_order_id = COALESCE(?, provider_order_id),
         paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(providerOrderId || null, orderId).run();
}

async function markPaymentState(env: Env, orderId: string, status: string, message?: string) {
  await env.DB.prepare(
    `UPDATE shop_orders
     SET payment_status = ?,
         fulfillment_message = COALESCE(?, fulfillment_message),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND payment_status <> 'PAID'`
  ).bind(status, message || null, orderId).run();
}

/* ----------------------------- PayPal ----------------------------- */

function paypalApiBase(env: Env) {
  return (env.PAYPAL_ENV || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(env: Env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal ist noch nicht eingerichtet.");
  }
  const basic = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || !body.access_token) {
    console.error("PayPal token error", response.status, body);
    throw new Error("PayPal-Zugangsdaten wurden abgelehnt.");
  }
  return String(body.access_token);
}

async function paypalRequest(env: Env, path: string, init: RequestInit = {}) {
  const token = await paypalAccessToken(env);
  return apiJson(`${paypalApiBase(env)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  }, "PayPal");
}

async function createPayPalCheckout(env: Env, order: ShopOrder, product: any) {
  const base = cleanBase(env.STORE_BASE_URL);
  const amount = (order.price_cents / 100).toFixed(2);
  const body = {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: order.id,
      custom_id: order.id,
      description: `Austria-MC ${product.display_name} Rang`,
      amount: { currency_code: "EUR", value: amount },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Austria-MC",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: `${base}/api/paypal/return?order=${encodeURIComponent(order.id)}`,
          cancel_url: `${base}/?order=${encodeURIComponent(order.id)}&cancelled=1`,
        },
      },
    },
  };

  const payment = await paypalRequest(env, "/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": order.id },
    body: JSON.stringify(body),
  });

  const checkoutUrl = payment.links?.find((x: any) => x.rel === "payer-action" || x.rel === "approve")?.href;
  if (!payment.id || !checkoutUrl) throw new Error("PayPal hat keine Freigabe-URL zurückgegeben.");

  await env.DB.prepare(
    `UPDATE shop_orders
     SET provider_name = 'paypal', provider_payment_id = ?, payment_status = 'OPEN', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(payment.id, order.id).run();

  return { checkoutUrl };
}

function assertPayPalAmount(order: ShopOrder, paypalOrder: any) {
  const unit = paypalOrder?.purchase_units?.[0];
  const amount = unit?.amount;
  if (!unit || unit.custom_id !== order.id) throw new Error("PayPal-Bestellreferenz stimmt nicht überein.");
  if (amount?.currency_code !== order.currency || amount?.value !== (order.price_cents / 100).toFixed(2)) {
    throw new Error("PayPal-Betrag stimmt nicht überein.");
  }
}

async function capturePayPalOrder(env: Env, order: ShopOrder, paypalOrderId: string) {
  if (order.provider_payment_id && order.provider_payment_id !== paypalOrderId) {
    throw new Error("PayPal-Order-ID stimmt nicht überein.");
  }

  const current = await paypalRequest(env, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  assertPayPalAmount(order, current);

  if (current.status === "COMPLETED") {
    await markPaid(env, order.id, paypalOrderId);
    return;
  }

  const captured = await paypalRequest(env, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-${order.id}` },
    body: "{}",
  });
  assertPayPalAmount(order, captured);
  if (captured.status !== "COMPLETED") {
    await markPaymentState(env, order.id, "PENDING", `PayPal status: ${captured.status || "unknown"}`);
    throw new Error("PayPal-Zahlung wurde noch nicht abgeschlossen.");
  }
  await markPaid(env, order.id, paypalOrderId);
}

async function paypalReturn(request: Request, env: Env) {
  const url = new URL(request.url);
  const internalOrderId = url.searchParams.get("order") || "";
  const paypalOrderId = url.searchParams.get("token") || "";
  const base = cleanBase(env.STORE_BASE_URL);
  if (!internalOrderId || !paypalOrderId) return redirect(`${base}/?payment_error=paypal`);

  const order = await getShopOrder(env, internalOrderId);
  if (!order) return redirect(`${base}/?payment_error=paypal`);

  try {
    await capturePayPalOrder(env, order, paypalOrderId);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}`);
  } catch (error) {
    console.error(error);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}&payment_error=paypal`);
  }
}

async function verifyPayPalWebhook(request: Request, env: Env, event: any) {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const token = await paypalAccessToken(env);
  const body = {
    transmission_id: request.headers.get("paypal-transmission-id"),
    transmission_time: request.headers.get("paypal-transmission-time"),
    cert_url: request.headers.get("paypal-cert-url"),
    auth_algo: request.headers.get("paypal-auth-algo"),
    transmission_sig: request.headers.get("paypal-transmission-sig"),
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  };
  const result = await apiJson(`${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }, "PayPal");
  return result.verification_status === "SUCCESS";
}

async function paypalWebhook(request: Request, env: Env) {
  const event = (await request.json().catch(() => null)) as any;
  if (!event) return new Response("bad request", { status: 400 });
  if (!env.PAYPAL_WEBHOOK_ID) return new Response("webhook not configured", { status: 503 });
  if (!(await verifyPayPalWebhook(request, env, event))) return new Response("invalid signature", { status: 401 });

  const paypalOrderId = event?.resource?.supplementary_data?.related_ids?.order_id
    || (event.event_type?.startsWith("CHECKOUT.ORDER.") ? event?.resource?.id : null);

  if (paypalOrderId) {
    const order = await env.DB.prepare(
      `SELECT id FROM shop_orders WHERE provider_name = 'paypal' AND provider_payment_id = ? LIMIT 1`
    ).bind(paypalOrderId).first<{id: string}>();
    if (order) {
      const full = await getShopOrder(env, order.id);
      if (full) {
        if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
          try { await capturePayPalOrder(env, full, paypalOrderId); } catch (e) { console.error(e); }
        } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          try {
            const current = await paypalRequest(env, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
            assertPayPalAmount(full, current);
            if (current.status === "COMPLETED") await markPaid(env, full.id, paypalOrderId);
          } catch (e) { console.error(e); }
        } else if (["PAYMENT.CAPTURE.DENIED", "CHECKOUT.ORDER.VOIDED"].includes(event.event_type)) {
          await markPaymentState(env, full.id, "FAILED", `PayPal event: ${event.event_type}`);
        }
      }
    }
  }
  return new Response("ok");
}

/* ----------------------------- Klarna ----------------------------- */

function klarnaBase(env: Env) {
  if (env.KLARNA_API_BASE) return cleanBase(env.KLARNA_API_BASE);
  return (env.KLARNA_ENV || "playground").toLowerCase() === "live"
    ? "https://api.klarna.com"
    : "https://api.playground.klarna.com";
}

function klarnaAuth(env: Env) {
  if (!env.KLARNA_USERNAME || !env.KLARNA_PASSWORD) throw new Error("Klarna ist noch nicht eingerichtet.");
  return `Basic ${btoa(`${env.KLARNA_USERNAME}:${env.KLARNA_PASSWORD}`)}`;
}

async function klarnaRequest(env: Env, path: string, init: RequestInit = {}) {
  return apiJson(`${klarnaBase(env)}${path}`, {
    ...init,
    headers: {
      authorization: klarnaAuth(env),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  }, "Klarna");
}

async function createKlarnaCheckout(env: Env, order: ShopOrder, product: any) {
  const base = cleanBase(env.STORE_BASE_URL);
  const kp = await klarnaRequest(env, "/payments/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      purchase_country: order.country,
      purchase_currency: "EUR",
      locale: order.country === "AT" ? "de-AT" : "de-DE",
      order_amount: order.price_cents,
      order_tax_amount: 0,
      order_lines: [{
        type: "digital",
        reference: product.id,
        name: `Austria-MC ${product.display_name} Rang`,
        quantity: 1,
        unit_price: order.price_cents,
        tax_rate: 0,
        total_amount: order.price_cents,
        total_tax_amount: 0,
      }],
    }),
  });
  if (!kp.session_id) throw new Error("Klarna hat keine Payment Session erstellt.");

  const hpp = await klarnaRequest(env, "/hpp/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      payment_session_url: `${klarnaBase(env)}/payments/v1/sessions/${kp.session_id}`,
      merchant_urls: {
        success: `${base}/api/klarna/return?order=${encodeURIComponent(order.id)}&session_id={{session_id}}&order_id={{order_id}}`,
        cancel: `${base}/?order=${encodeURIComponent(order.id)}&cancelled=1`,
        back: `${base}/?order=${encodeURIComponent(order.id)}&cancelled=1`,
        failure: `${base}/?order=${encodeURIComponent(order.id)}&payment_error=klarna`,
        error: `${base}/?order=${encodeURIComponent(order.id)}&payment_error=klarna`,
        status_update: `${base}/api/klarna/status?order=${encodeURIComponent(order.id)}`,
      },
      options: { place_order_mode: "PLACE_ORDER" },
    }),
  });
  if (!hpp.session_id || !hpp.redirect_url) throw new Error("Klarna hat keine HPP-URL erstellt.");

  await env.DB.prepare(
    `UPDATE shop_orders
     SET provider_name = 'klarna', provider_payment_id = ?, provider_session_id = ?, payment_status = 'OPEN', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(kp.session_id, hpp.session_id, order.id).run();

  return { checkoutUrl: hpp.redirect_url };
}

async function finalizeKlarnaOrder(env: Env, order: ShopOrder, hppSessionId: string, klarnaOrderId: string) {
  if (order.provider_session_id && order.provider_session_id !== hppSessionId) {
    throw new Error("Klarna HPP Session stimmt nicht überein.");
  }

  const hpp = await klarnaRequest(env, `/hpp/v1/sessions/${encodeURIComponent(hppSessionId)}`);
  if (hpp.status !== "COMPLETED" || hpp.order_id !== klarnaOrderId) {
    throw new Error("Klarna-Session ist noch nicht vollständig abgeschlossen.");
  }

  const remoteOrder = await klarnaRequest(env, `/ordermanagement/v1/orders/${encodeURIComponent(klarnaOrderId)}`);
  if (Number(remoteOrder.order_amount) !== order.price_cents || String(remoteOrder.purchase_currency || "EUR") !== order.currency) {
    throw new Error("Klarna-Betrag stimmt nicht überein.");
  }

  if (Number(remoteOrder.captured_amount || 0) < order.price_cents) {
    await klarnaRequest(env, `/ordermanagement/v1/orders/${encodeURIComponent(klarnaOrderId)}/captures`, {
      method: "POST",
      headers: { "Klarna-Idempotency-Key": order.id },
      body: JSON.stringify({
        captured_amount: order.price_cents,
        reference: order.id,
        description: `Austria-MC digitaler Rang ${order.product_id}`,
      }),
    });
  }

  await env.DB.prepare(
    `UPDATE shop_orders SET provider_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(klarnaOrderId, order.id).run();
  await markPaid(env, order.id, klarnaOrderId);
}

async function klarnaReturn(request: Request, env: Env) {
  const url = new URL(request.url);
  const internalOrderId = url.searchParams.get("order") || "";
  const sessionId = url.searchParams.get("session_id") || "";
  const providerOrderId = url.searchParams.get("order_id") || "";
  const base = cleanBase(env.STORE_BASE_URL);
  const order = internalOrderId ? await getShopOrder(env, internalOrderId) : null;
  if (!order || !sessionId || !providerOrderId) return redirect(`${base}/?payment_error=klarna`);
  try {
    await finalizeKlarnaOrder(env, order, sessionId, providerOrderId);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}`);
  } catch (error) {
    console.error(error);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}&payment_error=klarna`);
  }
}

async function klarnaStatus(request: Request, env: Env) {
  const url = new URL(request.url);
  const internalOrderId = url.searchParams.get("order") || "";
  const body = (await request.json().catch(() => ({}))) as any;
  const session = body?.session || {};
  const order = internalOrderId ? await getShopOrder(env, internalOrderId) : null;
  if (!order) return new Response("ok");
  if (session.status === "COMPLETED" && session.session_id && session.order_id) {
    try { await finalizeKlarnaOrder(env, order, session.session_id, session.order_id); }
    catch (e) { console.error(e); }
  }
  return new Response("ok");
}

/* -------------------------- paysafecard --------------------------- */

function paysafecardBase(env: Env) {
  if (env.PAYSAFECARD_API_BASE) return cleanBase(env.PAYSAFECARD_API_BASE);
  return (env.PAYSAFECARD_ENV || "test").toLowerCase() === "live"
    ? "https://api.paysafecard.com/v1"
    : "https://apitest.paysafecard.com/v1";
}

function paysafecardAuth(env: Env) {
  if (!env.PAYSAFECARD_API_KEY) throw new Error("paysafecard ist noch nicht eingerichtet.");
  return `Basic ${btoa(env.PAYSAFECARD_API_KEY)}`;
}

async function paysafecardRequest(env: Env, path: string, init: RequestInit = {}) {
  return apiJson(`${paysafecardBase(env)}${path}`, {
    ...init,
    headers: {
      authorization: paysafecardAuth(env),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  }, "paysafecard");
}

async function createPaysafecardCheckout(env: Env, order: ShopOrder, product: any) {
  const base = cleanBase(env.STORE_BASE_URL);
  const payment = await paysafecardRequest(env, "/payments", {
    method: "POST",
    headers: { "Correlation-ID": order.id.replace(/-/g, "").slice(0, 41) },
    body: JSON.stringify({
      type: "PAYSAFECARD",
      amount: Number((order.price_cents / 100).toFixed(2)),
      currency: "EUR",
      redirect: {
        success_url: `${base}/api/paysafecard/return?order=${encodeURIComponent(order.id)}`,
        failure_url: `${base}/?order=${encodeURIComponent(order.id)}&payment_error=paysafecard`,
      },
      notification_url: `${base}/api/paysafecard/notification?order=${encodeURIComponent(order.id)}&payment_id={payment_id}`,
      customer: {
        id: order.id,
        country_restriction: order.country,
      },
    }),
  });
  if (!payment.id || !payment.redirect?.auth_url) throw new Error("paysafecard hat keine Zahlungs-URL erstellt.");

  await env.DB.prepare(
    `UPDATE shop_orders
     SET provider_name = 'paysafecard', provider_payment_id = ?, payment_status = 'OPEN', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(payment.id, order.id).run();
  return { checkoutUrl: payment.redirect.auth_url };
}

function assertPaysafecardAmount(order: ShopOrder, remote: any) {
  const cents = Math.round(Number(remote.amount) * 100);
  if (cents !== order.price_cents || remote.currency !== order.currency) {
    throw new Error("paysafecard-Betrag stimmt nicht überein.");
  }
}

async function finalizePaysafecard(env: Env, order: ShopOrder, paymentId: string) {
  if (order.provider_payment_id && order.provider_payment_id !== paymentId) {
    throw new Error("paysafecard Payment-ID stimmt nicht überein.");
  }
  let payment = await paysafecardRequest(env, `/payments/${encodeURIComponent(paymentId)}`);
  assertPaysafecardAmount(order, payment);

  if (payment.status === "AUTHORIZED") {
    payment = await paysafecardRequest(env, `/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: "POST",
      body: "{}",
    });
    assertPaysafecardAmount(order, payment);
  }

  if (payment.status === "SUCCESS") {
    await markPaid(env, order.id, paymentId);
    return;
  }
  if (["CANCELED", "FAILED", "EXPIRED"].includes(payment.status)) {
    await markPaymentState(env, order.id, payment.status === "CANCELED" ? "CANCELED" : "FAILED", `paysafecard status: ${payment.status}`);
    return;
  }
  await markPaymentState(env, order.id, payment.status === "AUTHORIZED" ? "AUTHORIZED" : "PENDING", `paysafecard status: ${payment.status}`);
}

async function paysafecardReturn(request: Request, env: Env) {
  const url = new URL(request.url);
  const internalOrderId = url.searchParams.get("order") || "";
  const base = cleanBase(env.STORE_BASE_URL);
  const order = internalOrderId ? await getShopOrder(env, internalOrderId) : null;
  if (!order?.provider_payment_id) return redirect(`${base}/?payment_error=paysafecard`);
  try {
    await finalizePaysafecard(env, order, order.provider_payment_id);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}`);
  } catch (error) {
    console.error(error);
    return redirect(`${base}/?order=${encodeURIComponent(order.id)}&payment_error=paysafecard`);
  }
}

async function paysafecardNotification(request: Request, env: Env) {
  const url = new URL(request.url);
  const internalOrderId = url.searchParams.get("order") || "";
  let paymentId = url.searchParams.get("payment_id") || "";
  const order = internalOrderId ? await getShopOrder(env, internalOrderId) : null;
  if (!order) return new Response("ok");

  if (!paymentId) {
    const body = (await request.json().catch(() => ({}))) as any;
    paymentId = body.id || body.payment_id || order.provider_payment_id || "";
  }
  if (paymentId) {
    try { await finalizePaysafecard(env, order, paymentId); }
    catch (e) { console.error(e); }
  }
  return new Response("ok");
}

/* ------------------------- Checkout / Orders ---------------------- */

async function createCheckout(request: Request, env: Env) {
  const input = (await request.json()) as Partial<CheckoutBody>;
  const required = [
    "productId", "minecraftName", "paymentMethod", "email",
    "givenName", "familyName", "streetAndNumber", "postalCode", "city", "country"
  ] as const;
  for (const key of required) {
    if (!String(input[key] ?? "").trim()) return json({ error: `Feld fehlt: ${key}` }, 400);
  }

  const minecraftName = String(input.minecraftName).trim();
  if (!isMinecraftName(minecraftName)) {
    return json({ error: "Minecraft-Name muss 3–16 Zeichen lang sein und darf nur A-Z, 0-9 und _ enthalten." }, 400);
  }

  const paymentMethod = input.paymentMethod as PaymentMethod;
  if (!["paypal", "paysafecard", "klarna"].includes(paymentMethod)) return json({ error: "Ungültige Zahlungsart." }, 400);
  if (!methodEnabled(env, paymentMethod)) return json({ error: `${paymentMethod} ist noch nicht eingerichtet.` }, 503);

  const country = String(input.country).trim().toUpperCase();
  if (!isCountry(country)) return json({ error: "Bitte einen gültigen ISO-Ländercode angeben, z. B. AT." }, 400);

  const product = await env.DB.prepare(
    `SELECT id, display_name, luckperms_group, price_cents FROM products WHERE id = ? AND active = 1 LIMIT 1`
  ).bind(input.productId).first<any>();
  if (!product) return json({ error: "Produkt nicht gefunden." }, 404);

  const orderId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO shop_orders
     (id, minecraft_name, product_id, luckperms_group, price_cents, currency,
      payment_method, payment_status, fulfillment_status,
      provider_name, customer_email, given_name, family_name, street_and_number,
      postal_code, city, country)
     VALUES (?, ?, ?, ?, ?, 'EUR', ?, 'CREATED', 'WAITING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    orderId,
    minecraftName,
    product.id,
    product.luckperms_group,
    product.price_cents,
    paymentMethod,
    paymentMethod,
    String(input.email).trim(),
    String(input.givenName).trim(),
    String(input.familyName).trim(),
    String(input.streetAndNumber).trim(),
    String(input.postalCode).trim(),
    String(input.city).trim(),
    country
  ).run();

  const order = await getShopOrder(env, orderId);
  if (!order) throw new Error("Bestellung konnte nicht gespeichert werden.");

  try {
    let result: { checkoutUrl: string };
    if (paymentMethod === "paypal") result = await createPayPalCheckout(env, order, product);
    else if (paymentMethod === "klarna") result = await createKlarnaCheckout(env, order, product);
    else result = await createPaysafecardCheckout(env, order, product);
    return json({ orderId, checkoutUrl: result.checkoutUrl }, 201);
  } catch (error) {
    await markPaymentState(env, orderId, "FAILED", String(error).slice(0, 255));
    throw error;
  }
}

async function getOrder(orderId: string, env: Env) {
  const order = await env.DB.prepare(
    `SELECT o.id, o.minecraft_name, o.payment_method, o.payment_status, o.fulfillment_status,
            o.price_cents, o.currency, o.created_at, o.paid_at, p.display_name
     FROM shop_orders o JOIN products p ON p.id = o.product_id
     WHERE o.id = ? LIMIT 1`
  ).bind(orderId).first<any>();
  if (!order) return json({ error: "Bestellung nicht gefunden." }, 404);
  return json(order);
}

async function pendingFulfillment(request: Request, env: Env) {
  if (!authFulfillment(request, env)) return json({ error: "unauthorized" }, 401);
  const result = await env.DB.prepare(
    `SELECT id, minecraft_name, product_id, luckperms_group, price_cents, paid_at
     FROM shop_orders
     WHERE payment_status = 'PAID' AND fulfillment_status = 'PENDING'
     ORDER BY paid_at ASC LIMIT 50`
  ).all<any>();
  return json({ orders: result.results || [] });
}

async function completeFulfillment(request: Request, orderId: string, env: Env) {
  if (!authFulfillment(request, env)) return json({ error: "unauthorized" }, 401);
  const body = (await request.json().catch(() => ({}))) as any;
  const success = body.success === true;
  const message = String(body.message || "").slice(0, 255);
  await env.DB.prepare(
    `UPDATE shop_orders
     SET fulfillment_status = ?, fulfillment_message = ?,
         fulfilled_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE fulfilled_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND payment_status = 'PAID'`
  ).bind(success ? "FULFILLED" : "FAILED", message || null, success ? 1 : 0, orderId).run();
  return json({ ok: true });
}

/* ----------------------------- Admin ------------------------------ */

let adminSchemaReady = false;
const encoder = new TextEncoder();
const ADMIN_COOKIE = "austria_shop_admin";

async function ensureAdminSchema(env: Env) {
  if (adminSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_login_guard (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
  adminSchemaReady = true;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToText(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hmacBase64Url(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomSalt() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function adminPasswordHash(env: Env, password: string, salt: string) {
  if (!env.ADMIN_SECRET) throw new Error("ADMIN_SECRET ist nicht konfiguriert.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${password}:${env.ADMIN_SECRET}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(`austria-mc-admin:${salt}`),
      iterations: 30000,
    },
    material,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAge = 60 * 60 * 8) {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function createAdminSession(env: Env, username: string, sessionVersion: number) {
  if (!env.ADMIN_SECRET) throw new Error("ADMIN_SECRET ist nicht konfiguriert.");
  const payload = textToBase64Url(JSON.stringify({
    u: username,
    sv: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
  }));
  const signature = await hmacBase64Url(env.ADMIN_SECRET, payload);
  return `${payload}.${signature}`;
}

async function getAdminUser(env: Env) {
  await ensureAdminSchema(env);
  return env.DB.prepare(
    `SELECT id, username, password_salt, password_hash, session_version, updated_at
     FROM admin_users WHERE id = 1 LIMIT 1`
  ).first<any>();
}

async function verifyAdminSession(request: Request, env: Env) {
  await ensureAdminSchema(env);
  if (!env.ADMIN_SECRET) return null;
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmacBase64Url(env.ADMIN_SECRET, payload);
  if (!constantTimeEqual(signature, expected)) return null;
  let session: any;
  try { session = JSON.parse(base64UrlToText(payload)); } catch { return null; }
  if (!session?.u || !session?.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
  const user = await getAdminUser(env);
  if (!user || user.username !== session.u || Number(user.session_version) !== Number(session.sv)) return null;
  return { username: user.username, sessionVersion: Number(user.session_version) };
}

function adminMutationAllowed(request: Request) {
  if (request.headers.get("x-austria-admin") !== "1") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}

async function adminAudit(env: Env, actor: string, action: string, entityType?: string | null, entityId?: string | null, details?: unknown) {
  await ensureAdminSchema(env);
  await env.DB.prepare(
    `INSERT INTO admin_audit (actor, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(actor, action, entityType || null, entityId || null, details == null ? null : JSON.stringify(details).slice(0, 4000)).run();
}

function adminClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

async function adminLoginKey(request: Request, env: Env) {
  if (!env.ADMIN_SECRET) return "no-secret";
  return sha256Base64Url(`login:${adminClientIp(request)}:${env.ADMIN_SECRET}`);
}

async function adminLoginBlocked(request: Request, env: Env) {
  await ensureAdminSchema(env);
  const key = await adminLoginKey(request, env);
  const row = await env.DB.prepare(`SELECT failures, blocked_until FROM admin_login_guard WHERE key=?`).bind(key).first<any>();
  if (!row) return false;
  return Number(row.blocked_until || 0) > Math.floor(Date.now() / 1000);
}

async function adminLoginFailure(request: Request, env: Env) {
  await ensureAdminSchema(env);
  const key = await adminLoginKey(request, env);
  const current = await env.DB.prepare(`SELECT failures FROM admin_login_guard WHERE key=?`).bind(key).first<any>();
  const failures = Number(current?.failures || 0) + 1;
  const blockFor = failures >= 10 ? 60 * 60 : failures >= 5 ? 15 * 60 : 0;
  const blockedUntil = blockFor ? Math.floor(Date.now() / 1000) + blockFor : 0;
  await env.DB.prepare(`
    INSERT INTO admin_login_guard (key, failures, blocked_until, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, blocked_until=excluded.blocked_until, updated_at=CURRENT_TIMESTAMP
  `).bind(key, failures, blockedUntil).run();
}

async function adminLoginSuccess(request: Request, env: Env) {
  await ensureAdminSchema(env);
  const key = await adminLoginKey(request, env);
  await env.DB.prepare(`DELETE FROM admin_login_guard WHERE key=?`).bind(key).run();
}

async function adminLogin(request: Request, env: Env) {
  await ensureAdminSchema(env);
  if (!adminMutationAllowed(request)) return json({ error: "Ungültige Anfrage." }, 403);
  if (!env.ADMIN_SECRET) return json({ error: "ADMIN_SECRET fehlt in Cloudflare." }, 503);
  if (await adminLoginBlocked(request, env)) {
    return json({ error: "Zu viele fehlgeschlagene Anmeldeversuche. Bitte später erneut versuchen." }, 429);
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) return json({ error: "Benutzername und Passwort fehlen." }, 400);

  let user = await getAdminUser(env);
  if (!user) {
    if (!env.ADMIN_BOOTSTRAP_USERNAME || !env.ADMIN_BOOTSTRAP_PASSWORD) {
      return json({ error: "Admin ist noch nicht eingerichtet. Bootstrap-Secrets fehlen." }, 503);
    }
    const bootstrapOk = constantTimeEqual(username, env.ADMIN_BOOTSTRAP_USERNAME) &&
      constantTimeEqual(await sha256Base64Url(password), await sha256Base64Url(env.ADMIN_BOOTSTRAP_PASSWORD));
    if (!bootstrapOk) {
      await adminLoginFailure(request, env);
      return json({ error: "Benutzername oder Passwort ist falsch." }, 401);
    }

    const salt = randomSalt();
    const hash = await adminPasswordHash(env, password, salt);
    await env.DB.prepare(
      `INSERT INTO admin_users (id, username, password_salt, password_hash, session_version)
       VALUES (1, ?, ?, ?, 1)`
    ).bind(username, salt, hash).run();
    user = await getAdminUser(env);
    await adminAudit(env, username, "bootstrap_admin", "admin_user", "1", { username });
  } else {
    const hash = await adminPasswordHash(env, password, user.password_salt);
    if (!constantTimeEqual(hash, user.password_hash) || !constantTimeEqual(username, user.username)) {
      await adminLoginFailure(request, env);
      return json({ error: "Benutzername oder Passwort ist falsch." }, 401);
    }
  }

  await adminLoginSuccess(request, env);
  const token = await createAdminSession(env, user.username, Number(user.session_version));
  const response = json({ username: user.username });
  response.headers.set("set-cookie", sessionCookie(token));
  return response;
}

async function adminSession(request: Request, env: Env) {
  const session = await verifyAdminSession(request, env);
  if (!session) return json({ error: "Nicht angemeldet." }, 401);
  return json({ username: session.username });
}

async function adminLogout(request: Request) {
  if (!adminMutationAllowed(request)) return json({ error: "Ungültige Anfrage." }, 403);
  const response = json({ ok: true });
  response.headers.set("set-cookie", sessionCookie("", 0));
  return response;
}

async function requireAdmin(request: Request, env: Env) {
  const session = await verifyAdminSession(request, env);
  if (!session) return { error: json({ error: "Nicht angemeldet." }, 401), session: null };
  if (!["GET", "HEAD"].includes(request.method.toUpperCase()) && !adminMutationAllowed(request)) {
    return { error: json({ error: "Ungültige Admin-Anfrage." }, 403), session: null };
  }
  return { error: null, session };
}

async function adminOverview(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS orders,
      SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN payment_status = 'PAID' AND fulfillment_status = 'PENDING' THEN 1 ELSE 0 END) AS pendingFulfillment,
      COALESCE(SUM(CASE WHEN payment_status = 'PAID' AND COALESCE(provider_name, '') <> 'admin-test' THEN price_cents ELSE 0 END), 0) AS revenueCents,
      SUM(CASE WHEN provider_name = 'admin-test' THEN 1 ELSE 0 END) AS testOrders
    FROM shop_orders
  `).first<any>();
  const recent = await env.DB.prepare(`
    SELECT o.id, o.minecraft_name, o.price_cents, o.payment_status, o.fulfillment_status, o.created_at,
           p.display_name
    FROM shop_orders o LEFT JOIN products p ON p.id = o.product_id
    ORDER BY o.created_at DESC LIMIT 12
  `).all<any>();
  return json({ stats: {
    orders: Number(stats?.orders || 0), paid: Number(stats?.paid || 0),
    pendingFulfillment: Number(stats?.pendingFulfillment || 0), revenueCents: Number(stats?.revenueCents || 0),
    testOrders: Number(stats?.testOrders || 0)
  }, recent: recent.results || [] });
}

async function adminProducts(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const productRows = await env.DB.prepare(`SELECT * FROM products ORDER BY display_order ASC, id ASC`).all<any>();
  const permRows = await env.DB.prepare(`SELECT * FROM product_permissions ORDER BY product_id, display_order ASC, id ASC`).all<any>();
  const grouped = new Map<string, any[]>();
  for (const permission of permRows.results || []) {
    if (!grouped.has(permission.product_id)) grouped.set(permission.product_id, []);
    grouped.get(permission.product_id)!.push(permission);
  }
  return json({ products: (productRows.results || []).map((p: any) => ({ ...p, active: Boolean(p.active), permissions: grouped.get(p.id) || [] })) });
}

async function adminUpdateProduct(request: Request, env: Env, productId: string) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as any;
  const displayName = String(body.display_name || "").trim();
  const group = String(body.luckperms_group || "").trim();
  const price = Number(body.price_cents);
  const prefix = String(body.prefix_legacy || "").slice(0, 255);
  const accent = String(body.accent_hex || "").trim();
  const description = String(body.description || "").trim().slice(0, 1000);
  const displayOrder = Number(body.display_order || 0);
  const active = Number(body.active) === 1 ? 1 : 0;
  if (!displayName || !group || !Number.isInteger(price) || price < 0 || price > 100000000) return json({ error: "Ungültige Rangdaten." }, 400);
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return json({ error: "Akzentfarbe muss z. B. #6B7280 sein." }, 400);
  const result = await env.DB.prepare(`
    UPDATE products SET display_name=?, luckperms_group=?, price_cents=?, prefix_legacy=?, accent_hex=?,
      description=?, display_order=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(displayName, group, price, prefix, accent, description, displayOrder, active, productId).run();
  if (!result.meta.changes) return json({ error: "Rang nicht gefunden." }, 404);
  await adminAudit(env, auth.session!.username, "update_product", "product", productId, { displayName, group, price, accent, active });
  return json({ ok: true });
}

function parsePermissionBody(body: any) {
  return {
    productId: String(body.productId || "").trim(),
    permissionNode: String(body.permissionNode || "").trim().slice(0, 255),
    commandHint: String(body.commandHint || "").trim().slice(0, 255) || null,
    benefitLabel: String(body.benefitLabel || "").trim().slice(0, 500),
    displayOrder: Number(body.displayOrder || 0),
  };
}

async function adminCreatePermission(request: Request, env: Env, productId: string) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const body = parsePermissionBody((await request.json().catch(() => ({}))) as any);
  body.productId = productId;
  if (!body.permissionNode || !body.benefitLabel) return json({ error: "Permission und Anzeige-Text fehlen." }, 400);
  try {
    const result = await env.DB.prepare(`
      INSERT INTO product_permissions (product_id, permission_node, command_hint, benefit_label, display_order)
      VALUES (?, ?, ?, ?, ?)
    `).bind(productId, body.permissionNode, body.commandHint, body.benefitLabel, body.displayOrder).run();
    await adminAudit(env, auth.session!.username, "create_permission", "permission", String(result.meta.last_row_id || ""), body);
    return json({ ok: true, id: result.meta.last_row_id }, 201);
  } catch (error) {
    return json({ error: "Permission konnte nicht angelegt werden. Eventuell existiert sie bereits." }, 409);
  }
}

async function adminUpdatePermission(request: Request, env: Env, id: number) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const body = parsePermissionBody((await request.json().catch(() => ({}))) as any);
  if (!body.permissionNode || !body.benefitLabel) return json({ error: "Permission und Anzeige-Text fehlen." }, 400);
  const result = await env.DB.prepare(`
    UPDATE product_permissions SET permission_node=?, command_hint=?, benefit_label=?, display_order=? WHERE id=?
  `).bind(body.permissionNode, body.commandHint, body.benefitLabel, body.displayOrder, id).run();
  if (!result.meta.changes) return json({ error: "Permission nicht gefunden." }, 404);
  await adminAudit(env, auth.session!.username, "update_permission", "permission", String(id), body);
  return json({ ok: true });
}

async function adminDeletePermission(request: Request, env: Env, id: number) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const result = await env.DB.prepare(`DELETE FROM product_permissions WHERE id=?`).bind(id).run();
  if (!result.meta.changes) return json({ error: "Permission nicht gefunden." }, 404);
  await adminAudit(env, auth.session!.username, "delete_permission", "permission", String(id));
  return json({ ok: true });
}

const ADMIN_PAYMENT_STATES = new Set(["CREATED","OPEN","PENDING","AUTHORIZED","PAID","FAILED","CANCELED","EXPIRED"]);
const ADMIN_FULFILLMENT_STATES = new Set(["WAITING_PAYMENT","PENDING","PROCESSING","FULFILLED","FAILED"]);

async function adminOrders(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const payment = (url.searchParams.get("payment") || "").trim();
  const fulfillment = (url.searchParams.get("fulfillment") || "").trim();
  const limit = Math.min(250, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const where: string[] = [];
  const params: any[] = [];
  if (q) { where.push(`(o.minecraft_name LIKE ? OR o.id LIKE ? OR o.customer_email LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (payment && ADMIN_PAYMENT_STATES.has(payment)) { where.push(`o.payment_status = ?`); params.push(payment); }
  if (fulfillment && ADMIN_FULFILLMENT_STATES.has(fulfillment)) { where.push(`o.fulfillment_status = ?`); params.push(fulfillment); }
  const sql = `SELECT o.*, p.display_name FROM shop_orders o LEFT JOIN products p ON p.id=o.product_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.created_at DESC LIMIT ?`;
  params.push(limit);
  const stmt = env.DB.prepare(sql).bind(...params);
  const rows = await stmt.all<any>();
  return json({ orders: rows.results || [] });
}

async function adminRetryOrder(request: Request, env: Env, orderId: string) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const result = await env.DB.prepare(`
    UPDATE shop_orders SET fulfillment_status='PENDING', fulfillment_message='Admin: erneut zur Freischaltung vorgemerkt',
      fulfilled_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status='PAID'
  `).bind(orderId).run();
  if (!result.meta.changes) return json({ error: "Nur bezahlte Bestellungen können erneut freigeschaltet werden." }, 400);
  await adminAudit(env, auth.session!.username, "retry_fulfillment", "order", orderId);
  return json({ ok: true });
}

async function adminDeleteOrder(request: Request, env: Env, orderId: string) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const order = await env.DB.prepare(`SELECT provider_name FROM shop_orders WHERE id=?`).bind(orderId).first<any>();
  if (!order) return json({ error: "Bestellung nicht gefunden." }, 404);
  if (order.provider_name !== "admin-test") return json({ error: "Aus Sicherheitsgründen können hier nur Testkäufe gelöscht werden." }, 403);
  await env.DB.prepare(`DELETE FROM shop_orders WHERE id=?`).bind(orderId).run();
  await adminAudit(env, auth.session!.username, "delete_test_order", "order", orderId);
  return json({ ok: true });
}

async function adminTestPurchase(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as any;
  const minecraftName = String(body.minecraftName || "").trim();
  const productId = String(body.productId || "").trim();
  if (!isMinecraftName(minecraftName)) return json({ error: "Ungültiger Minecraft-Name." }, 400);
  const product = await env.DB.prepare(`SELECT id, display_name, luckperms_group, price_cents FROM products WHERE id=? AND active=1 LIMIT 1`).bind(productId).first<any>();
  if (!product) return json({ error: "Rang nicht gefunden oder deaktiviert." }, 404);
  const orderId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO shop_orders
      (id,minecraft_name,product_id,luckperms_group,price_cents,currency,payment_method,payment_status,fulfillment_status,
       provider_name,provider_order_id,customer_email,given_name,family_name,street_and_number,postal_code,city,country,paid_at,updated_at)
    VALUES (?, ?, ?, ?, ?, 'EUR', 'paypal', 'PAID', 'PENDING', 'admin-test', ?, 'admin-test@austria-mc.net',
      'Admin', 'Testkauf', 'Test 1', '0000', 'Austria-MC', 'AT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(orderId, minecraftName, product.id, product.luckperms_group, product.price_cents, `admin-test:${orderId}`).run();
  await adminAudit(env, auth.session!.username, "create_test_purchase", "order", orderId, { minecraftName, productId, group: product.luckperms_group });
  return json({ order: { id: orderId, minecraft_name: minecraftName, product_id: product.id, luckperms_group: product.luckperms_group, payment_status: "PAID", fulfillment_status: "PENDING" } }, 201);
}

async function adminDatabaseTables(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const rows = await env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all<any>();
  const allowed = new Set(["products","product_permissions","shop_orders","admin_audit","admin_users","admin_login_guard"]);
  return json({ tables: (rows.results || []).map((r: any) => r.name).filter((name: string) => allowed.has(name)) });
}

async function adminDatabaseTable(request: Request, env: Env, table: string) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const allowed = new Set(["products","product_permissions","shop_orders","admin_audit","admin_users","admin_login_guard"]);
  if (!allowed.has(table)) return json({ error: "Tabelle nicht freigegeben." }, 404);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<any>();
  let rows: any;
  if (table === "admin_users") {
    rows = await env.DB.prepare(`SELECT id, username, session_version, updated_at FROM admin_users ORDER BY id LIMIT ?`).bind(limit).all<any>();
  } else {
    const orderBy = table === "shop_orders" || table === "admin_audit" ? " ORDER BY id DESC" : " ORDER BY rowid ASC";
    rows = await env.DB.prepare(`SELECT * FROM ${table}${orderBy} LIMIT ?`).bind(limit).all<any>();
  }
  const resultRows = rows.results || [];
  const columns = resultRows.length ? Object.keys(resultRows[0]) : [];
  return json({ table, count: Number(count?.n || 0), columns, rows: resultRows });
}

async function adminAccount(request: Request, env: Env) {
  const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as any;
  const currentPassword = String(body.currentPassword || "");
  const newUsername = body.newUsername == null ? null : String(body.newUsername).trim();
  const newPassword = body.newPassword == null ? null : String(body.newPassword);
  const user = await getAdminUser(env);
  if (!user) return json({ error: "Admin-Benutzer fehlt." }, 500);
  const currentHash = await adminPasswordHash(env, currentPassword, user.password_salt);
  if (!constantTimeEqual(currentHash, user.password_hash)) return json({ error: "Aktuelles Passwort ist falsch." }, 401);
  if (newUsername !== null && (newUsername.length < 3 || newUsername.length > 64)) return json({ error: "Benutzername muss 3–64 Zeichen lang sein." }, 400);
  if (newPassword !== null && newPassword.length < 10) return json({ error: "Neues Passwort muss mindestens 10 Zeichen lang sein." }, 400);
  if (newUsername === null && newPassword === null) return json({ error: "Keine Änderung angegeben." }, 400);

  const username = newUsername || user.username;
  let salt = user.password_salt;
  let hash = user.password_hash;
  if (newPassword !== null) {
    salt = randomSalt();
    hash = await adminPasswordHash(env, newPassword, salt);
  }
  const newVersion = Number(user.session_version) + 1;
  await env.DB.prepare(`
    UPDATE admin_users SET username=?, password_salt=?, password_hash=?, session_version=?, updated_at=CURRENT_TIMESTAMP WHERE id=1
  `).bind(username, salt, hash, newVersion).run();
  await adminAudit(env, auth.session!.username, "update_admin_account", "admin_user", "1", { username, passwordChanged: newPassword !== null });
  const token = await createAdminSession(env, username, newVersion);
  const response = json({ ok: true, username });
  response.headers.set("set-cookie", sessionCookie(token));
  return response;
}

async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
  if (url.pathname === "/api/admin/session" && request.method === "GET") return adminSession(request, env);
  if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout(request);
  if (url.pathname === "/api/admin/overview" && request.method === "GET") return adminOverview(request, env);
  if (url.pathname === "/api/admin/products" && request.method === "GET") return adminProducts(request, env);
  if (url.pathname === "/api/admin/orders" && request.method === "GET") return adminOrders(request, env);
  if (url.pathname === "/api/admin/test-purchase" && request.method === "POST") return adminTestPurchase(request, env);
  if (url.pathname === "/api/admin/database/tables" && request.method === "GET") return adminDatabaseTables(request, env);
  if (url.pathname === "/api/admin/account" && request.method === "POST") return adminAccount(request, env);

  let match = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (match && request.method === "PATCH") return adminUpdateProduct(request, env, decodeURIComponent(match[1]));
  match = url.pathname.match(/^\/api\/admin\/products\/([^/]+)\/permissions$/);
  if (match && request.method === "POST") return adminCreatePermission(request, env, decodeURIComponent(match[1]));
  match = url.pathname.match(/^\/api\/admin\/permissions\/(\d+)$/);
  if (match && request.method === "PATCH") return adminUpdatePermission(request, env, Number(match[1]));
  if (match && request.method === "DELETE") return adminDeletePermission(request, env, Number(match[1]));
  match = url.pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})\/retry$/i);
  if (match && request.method === "POST") return adminRetryOrder(request, env, match[1]);
  match = url.pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})$/i);
  if (match && request.method === "DELETE") return adminDeleteOrder(request, env, match[1]);
  match = url.pathname.match(/^\/api\/admin\/database\/([a-z_]+)$/i);
  if (match && request.method === "GET") return adminDatabaseTable(request, env, match[1]);
  return null;
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/admin") return redirect("/admin/", 308);
      if (url.pathname.startsWith("/api/admin/")) {
        const adminResponse = await handleAdminApi(request, env, url);
        if (adminResponse) return adminResponse;
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        let dbOk = false;
        let products = 0;
        try {
          const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products`).first<any>();
          dbOk = true;
          products = Number(row?.n || 0);
        } catch {
          dbOk = false;
        }
        return json({
          ok: dbOk,
          database: dbOk,
          products,
          adminConfigured: Boolean(env.ADMIN_BOOTSTRAP_USERNAME && env.ADMIN_BOOTSTRAP_PASSWORD && env.ADMIN_SECRET),
          fulfillmentConfigured: Boolean(env.FULFILLMENT_TOKEN),
          payments: paymentMethodInfo(env),
        }, dbOk ? 200 : 503);
      }

      if (url.pathname === "/api/products" && request.method === "GET") {
        return json({ products: await getProducts(env) });
      }
      if (url.pathname === "/api/payment-methods" && request.method === "GET") {
        return json({ methods: paymentMethodInfo(env) });
      }
      if (url.pathname === "/api/checkout" && request.method === "POST") {
        return await createCheckout(request, env);
      }

      if (url.pathname === "/api/paypal/return" && request.method === "GET") return paypalReturn(request, env);
      if (url.pathname === "/api/paypal/webhook" && request.method === "POST") return paypalWebhook(request, env);

      if (url.pathname === "/api/klarna/return" && request.method === "GET") return klarnaReturn(request, env);
      if (url.pathname === "/api/klarna/status" && request.method === "POST") return klarnaStatus(request, env);

      if (url.pathname === "/api/paysafecard/return" && request.method === "GET") return paysafecardReturn(request, env);
      if (url.pathname === "/api/paysafecard/notification" && request.method === "POST") return paysafecardNotification(request, env);

      const orderMatch = url.pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/i);
      if (orderMatch && request.method === "GET") return getOrder(orderMatch[1], env);

      if (url.pathname === "/api/fulfillment/pending" && request.method === "GET") {
        return pendingFulfillment(request, env);
      }
      const completeMatch = url.pathname.match(/^\/api\/fulfillment\/([0-9a-f-]{36})\/complete$/i);
      if (completeMatch && request.method === "POST") {
        return completeFulfillment(request, completeMatch[1], env);
      }

      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "same-origin");
      headers.set("x-frame-options", "DENY");
      if (url.pathname.startsWith("/admin")) {
        headers.set("cache-control", "no-store");
        headers.set("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      }
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Interner Fehler. Bitte später erneut versuchen." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
