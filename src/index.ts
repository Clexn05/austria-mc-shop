interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MOLLIE_API_KEY: string;
  FULFILLMENT_TOKEN: string;
  STORE_BASE_URL: string;
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

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function isMinecraftName(value: string) {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

function isCountry(value: string) {
  return /^[A-Z]{2}$/.test(value);
}

async function mollie(env: Env, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.MOLLIE_API_KEY}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Mollie API error", response.status, body);
    throw new Error(`Mollie API returned ${response.status}`);
  }
  return body as any;
}

function authFulfillment(request: Request, env: Env) {
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${env.FULFILLMENT_TOKEN}`;
}

function paymentStatusToDb(status: string) {
  switch (status) {
    case "paid": return "PAID";
    case "authorized": return "AUTHORIZED";
    case "pending": return "PENDING";
    case "open": return "OPEN";
    case "failed": return "FAILED";
    case "canceled": return "CANCELED";
    case "expired": return "EXPIRED";
    default: return "OPEN";
  }
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

async function createCheckout(request: Request, env: Env) {
  const input = (await request.json()) as Partial<CheckoutBody>;

  const required = [
    "productId", "minecraftName", "paymentMethod", "email",
    "givenName", "familyName", "streetAndNumber",
    "postalCode", "city", "country"
  ] as const;

  for (const key of required) {
    if (!String(input[key] ?? "").trim()) {
      return json({ error: `Feld fehlt: ${key}` }, 400);
    }
  }

  const minecraftName = String(input.minecraftName).trim();
  if (!isMinecraftName(minecraftName)) {
    return json({ error: "Minecraft-Name muss 3–16 Zeichen lang sein und darf nur A-Z, 0-9 und _ enthalten." }, 400);
  }

  const paymentMethod = input.paymentMethod as PaymentMethod;
  if (!["paypal", "paysafecard", "klarna"].includes(paymentMethod)) {
    return json({ error: "Ungültige Zahlungsart." }, 400);
  }

  const country = String(input.country).trim().toUpperCase();
  if (!isCountry(country)) {
    return json({ error: "Bitte einen gültigen ISO-Ländercode angeben, z. B. AT." }, 400);
  }

  const product = await env.DB.prepare(
    `SELECT id, display_name, luckperms_group, price_cents
     FROM products
     WHERE id = ? AND active = 1
     LIMIT 1`
  ).bind(input.productId).first<any>();

  if (!product) return json({ error: "Produkt nicht gefunden." }, 404);

  const orderId = crypto.randomUUID();
  const amount = (product.price_cents / 100).toFixed(2);

  await env.DB.prepare(
    `INSERT INTO shop_orders
     (id, minecraft_name, product_id, luckperms_group, price_cents, currency,
      payment_method, payment_status, fulfillment_status,
      customer_email, given_name, family_name, street_and_number,
      postal_code, city, country)
     VALUES (?, ?, ?, ?, ?, 'EUR', ?, 'CREATED', 'WAITING_PAYMENT',
             ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    orderId,
    minecraftName,
    product.id,
    product.luckperms_group,
    product.price_cents,
    paymentMethod,
    String(input.email).trim(),
    String(input.givenName).trim(),
    String(input.familyName).trim(),
    String(input.streetAndNumber).trim(),
    String(input.postalCode).trim(),
    String(input.city).trim(),
    country
  ).run();

  const base = env.STORE_BASE_URL.replace(/\/+$/, "");
  const paymentPayload = {
    amount: { currency: "EUR", value: amount },
    description: `Austria-MC ${product.display_name} – ${minecraftName}`,
    method: paymentMethod,
    redirectUrl: `${base}/?order=${encodeURIComponent(orderId)}`,
    cancelUrl: `${base}/?order=${encodeURIComponent(orderId)}&cancelled=1`,
    webhookUrl: `${base}/api/mollie/webhook`,
    locale: "de_AT",
    restrictPaymentMethodsToCountry: country,
    billingAddress: {
      givenName: String(input.givenName).trim(),
      familyName: String(input.familyName).trim(),
      email: String(input.email).trim(),
      streetAndNumber: String(input.streetAndNumber).trim(),
      postalCode: String(input.postalCode).trim(),
      city: String(input.city).trim(),
      country,
    },
    lines: [{
      type: "digital",
      description: `${product.display_name} Minecraft-Rang`,
      quantity: 1,
      unitPrice: { currency: "EUR", value: amount },
      totalAmount: { currency: "EUR", value: amount },
    }],
    metadata: {
      orderId,
      minecraftName,
      productId: product.id,
    },
  };

  try {
    const payment = await mollie(env, "/payments", {
      method: "POST",
      body: JSON.stringify(paymentPayload),
    });

    await env.DB.prepare(
      `UPDATE shop_orders
       SET mollie_payment_id = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(payment.id, paymentStatusToDb(payment.status), orderId).run();

    return json({
      orderId,
      checkoutUrl: payment?._links?.checkout?.href,
    }, 201);
  } catch (error) {
    await env.DB.prepare(
      `UPDATE shop_orders
       SET payment_status = 'FAILED',
           fulfillment_message = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(String(error).slice(0, 255), orderId).run();
    throw error;
  }
}

async function mollieWebhook(request: Request, env: Env) {
  const contentType = request.headers.get("content-type") || "";
  let paymentId = "";

  if (contentType.includes("application/json")) {
    const body = await request.json<any>().catch(() => ({}));
    paymentId = String(body.id || "");
  } else {
    const text = await request.text();
    const params = new URLSearchParams(text);
    paymentId = params.get("id") || "";
  }

  if (!paymentId) return new Response("missing id", { status: 400 });

  // Never trust the webhook body alone: fetch the canonical payment from Mollie.
  const payment = await mollie(env, `/payments/${encodeURIComponent(paymentId)}`);
  const orderId = String(payment?.metadata?.orderId || "");
  if (!orderId) return new Response("ok");

  const order = await env.DB.prepare(
    `SELECT id, price_cents, currency, mollie_payment_id,
            payment_status, fulfillment_status
     FROM shop_orders
     WHERE id = ?
     LIMIT 1`
  ).bind(orderId).first<any>();

  if (!order) return new Response("ok");

  if (order.mollie_payment_id && order.mollie_payment_id !== payment.id) {
    return new Response("payment mismatch", { status: 409 });
  }

  const expected = (order.price_cents / 100).toFixed(2);
  if (payment?.amount?.currency !== order.currency || payment?.amount?.value !== expected) {
    return new Response("amount mismatch", { status: 409 });
  }

  const status = paymentStatusToDb(String(payment.status));

  if (status === "PAID") {
    await env.DB.prepare(
      `UPDATE shop_orders
       SET mollie_payment_id = ?,
           payment_status = 'PAID',
           fulfillment_status = CASE
             WHEN fulfillment_status = 'WAITING_PAYMENT' THEN 'PENDING'
             ELSE fulfillment_status
           END,
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(payment.id, orderId).run();
  } else {
    await env.DB.prepare(
      `UPDATE shop_orders
       SET mollie_payment_id = ?,
           payment_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND payment_status <> 'PAID'`
    ).bind(payment.id, status, orderId).run();
  }

  return new Response("ok");
}

async function getOrder(orderId: string, env: Env) {
  const order = await env.DB.prepare(
    `SELECT o.id, o.minecraft_name, o.payment_status, o.fulfillment_status,
            o.price_cents, o.currency, o.created_at, o.paid_at,
            p.display_name
     FROM shop_orders o
     JOIN products p ON p.id = o.product_id
     WHERE o.id = ?
     LIMIT 1`
  ).bind(orderId).first<any>();

  if (!order) return json({ error: "Bestellung nicht gefunden." }, 404);
  return json(order);
}

async function pendingFulfillment(request: Request, env: Env) {
  if (!authFulfillment(request, env)) return json({ error: "unauthorized" }, 401);

  const result = await env.DB.prepare(
    `SELECT id, minecraft_name, product_id, luckperms_group, price_cents, paid_at
     FROM shop_orders
     WHERE payment_status = 'PAID'
       AND fulfillment_status = 'PENDING'
     ORDER BY paid_at ASC
     LIMIT 50`
  ).all<any>();

  return json({ orders: result.results || [] });
}

async function completeFulfillment(request: Request, orderId: string, env: Env) {
  if (!authFulfillment(request, env)) return json({ error: "unauthorized" }, 401);

  const body = await request.json<any>().catch(() => ({}));
  const success = body.success === true;
  const message = String(body.message || "").slice(0, 255);

  await env.DB.prepare(
    `UPDATE shop_orders
     SET fulfillment_status = ?,
         fulfillment_message = ?,
         fulfilled_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE fulfilled_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND payment_status = 'PAID'`
  ).bind(
    success ? "FULFILLED" : "FAILED",
    message || null,
    success ? 1 : 0,
    orderId
  ).run();

  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/products" && request.method === "GET") {
        return json({ products: await getProducts(env) });
      }

      if (url.pathname === "/api/checkout" && request.method === "POST") {
        return await createCheckout(request, env);
      }

      if (url.pathname === "/api/mollie/webhook" && request.method === "POST") {
        return await mollieWebhook(request, env);
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/i);
      if (orderMatch && request.method === "GET") {
        return await getOrder(orderMatch[1], env);
      }

      if (url.pathname === "/api/fulfillment/pending" && request.method === "GET") {
        return await pendingFulfillment(request, env);
      }

      const completeMatch = url.pathname.match(/^\/api\/fulfillment\/([0-9a-f-]{36})\/complete$/i);
      if (completeMatch && request.method === "POST") {
        return await completeFulfillment(request, completeMatch[1], env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "Interner Fehler. Bitte später erneut versuchen." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
