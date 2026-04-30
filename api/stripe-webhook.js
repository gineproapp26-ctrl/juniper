// api/stripe-webhook.js — Vercel Edge Function
// Gestisce i pagamenti Stripe e attiva automaticamente gli abbonamenti

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Mappa Price ID → nome piano
const PRICE_TO_PLAN = {
  'price_1TS0kQRwBKXh8inyofvLP0Hk': 'user_monthly',   // €3/mese utenti
  'price_1TS0kCRwBKXh8inyS6tqefzP': 'user_yearly',    // €30/anno utenti
  'price_1TS0jmRwBKXh8inyjifgeSAA': 'biz_monthly',    // €10/mese business
  'price_1TS0jPRwBKXh8inyu4oN8jml': 'biz_yearly',     // €110/anno business
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const priceId = session.line_items?.data?.[0]?.price?.id;

    // Recupera line items se non presenti
    let plan = PRICE_TO_PLAN[priceId];
    if (!plan && session.id) {
      try {
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items']
        });
        const lineItemPriceId = fullSession.line_items?.data?.[0]?.price?.id;
        plan = PRICE_TO_PLAN[lineItemPriceId];
      } catch(e) {}
    }

    if (!customerEmail || !plan) {
      console.log('Missing email or plan', { customerEmail, plan, priceId });
      return res.status(200).json({ received: true });
    }

    // Trova utente Supabase per email
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === customerEmail);

    if (!user) {
      console.log('User not found for email:', customerEmail);
      return res.status(200).json({ received: true });
    }

    // Calcola scadenza
    const expiresAt = plan.includes('yearly')
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

    // Salva abbonamento
    await supabase.from('subscriptions').upsert({
      user_id: user.id,
      plan,
      status: 'active',
      stripe_order_id: session.id,
      expires_at: expiresAt,
    }, { onConflict: 'user_id' });

    console.log(`✅ Abbonamento attivato: ${customerEmail} → ${plan}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = sub.customer;
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email;

    if (email) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === email);
      if (user) {
        await supabase.from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('user_id', user.id);
        console.log(`❌ Abbonamento cancellato: ${email}`);
      }
    }
  }

  res.status(200).json({ received: true });
}
