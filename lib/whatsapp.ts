import { prisma } from './db';

type SendInput = {
  to: string;
  body: string;
};

type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

async function sendViaTwilio({ to, body }: SendInput): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {

    console.log(`[whatsapp:dev] to=${to} body=${body}`);
    return { ok: true, providerMessageId: `dev-${Date.now()}` };
  }

  const params = new URLSearchParams();
  params.set('From', from);
  params.set('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
  params.set('Body', body);

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Twilio ${res.status}: ${text}` };
  }
  const json = (await res.json()) as { sid?: string };
  return { ok: true, providerMessageId: json.sid };
}

export async function dispatchQueued(limit = 50) {
  const queued = await prisma.notification.findMany({
    where: { status: 'QUEUED', scheduledFor: { lte: new Date() } },
    include: { customer: true },
    take: limit,
    orderBy: { scheduledFor: 'asc' },
  });

  let sent = 0;
  let failed = 0;
  for (const n of queued) {
    const body = renderTemplate(n.template, n.payloadJson as Record<string, unknown>);
    const result = await sendViaTwilio({ to: n.customer.phone, body });
    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: result.ok ? 'SENT' : 'FAILED',
        providerMessageId: result.providerMessageId,
        error: result.error,
        sentAt: result.ok ? new Date() : null,
      },
    });
    result.ok ? sent++ : failed++;
  }
  return { sent, failed, total: queued.length };
}

const TEMPLATES: Record<string, string> = {
  due_in_3_days:
    'Habari {{name}}, kumbukumbu: malipo yako ya mkopo Lendo ya {{amount}} yanahitajika tarehe {{dueDate}}. Asante.',
  due_today:
    'Habari {{name}}, malipo yako ya mkopo Lendo ya {{amount}} yanahitajika leo. Tafadhali lipa kabla ya mwisho wa siku.',
  overdue_1d:
    'Habari {{name}}, mkopo wako wa Lendo ulipaswa kulipwa jana. Kiasi: {{amount}}. Tafadhali wasiliana nasi haraka.',
  overdue_7d:
    'Habari {{name}}, mkopo wako Lendo umechelewa kwa wiki moja. Kiasi: {{amount}}. Wasiliana nasi sasa.',
  ad_hoc: '{{message}}',
};

export function renderTemplate(name: string, payload: Record<string, unknown>): string {
  const tmpl = TEMPLATES[name] ?? TEMPLATES.ad_hoc;
  return tmpl.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => String(payload[key] ?? ''));
}

export const templateNames = Object.keys(TEMPLATES);
