// 🌿 JUNIPER - Vercel Function per invio email via Resend
// Metti questo file in: /api/send-email.js

export default async function handler(req, res) {
  // Permetti solo richieste POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Abilita CORS per juniperapp.eu
  res.setHeader('Access-Control-Allow-Origin', 'https://juniperapp.eu');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { to, subject, html, type } = req.body;

    // Validazione base
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Chiama Resend API
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer re_SyKDTDZA_BF3UdqT9Tz3GKyDNQQ6JWATQ'
      },
      body: JSON.stringify({
        from: 'Juniper <help@juniperapp.eu>',
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Failed to send email', details: data });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
