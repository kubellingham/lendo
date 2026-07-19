// Lendo WhatsApp message templates. All bodies use {{placeholder}} tokens
// which are filled server-side from the loan / payment / customer being
// messaged. Staff copy-and-paste the rendered text into WhatsApp (or open
// wa.me with it pre-filled).
//
// Each message has three parts: a short warm greeting, a monospace
// "printed receipt" block (WhatsApp renders text between triple backticks in a
// fixed-width font, so the dividers and aligned label columns look like a
// printed slip), and a closing Lendo tagline. Labels are padded to a fixed
// width so the colons line up inside the monospace block.

export type MessageCategory = "loan" | "payment" | "customer";

export type MessageTemplate = {
  key: string;
  category: MessageCategory;
  label: string;
  description: string;
  body: string;
};

// Triple backtick fence — interpolated so we don't fight JS template literals.
const F = "```";

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // 1. 7-Day Payment Reminder
  {
    key: "reminder_7d",
    category: "loan",
    label: "7-day payment reminder",
    description: "Friendly heads-up one week before the due date.",
    body: `Hi {{customerName}} 👋 A reminder from Lendo.
${F}
=========================
          LENDO
=========================
PAYMENT REMINDER
Due in 7 days

Ref     : {{loanRef}}
Due date: {{dueDate}}
Rate    : {{interestRate}}
-------------------------
Principal: TZS {{principal}}
Interest : TZS {{interest}}
Balance  : TZS {{outstanding}}
Total due: TZS {{totalDue}}
=========================
${F}
Kindly plan ahead so you can pay on time. Thank you for choosing Lendo.
_Borrow with confidence. Repay with ease._`,
  },

  // 2. 3-Day Payment Reminder
  {
    key: "reminder_3d",
    category: "loan",
    label: "3-day payment reminder",
    description: "A gentler nudge as the due date approaches.",
    body: `Hi {{customerName}} 👋 Your Lendo payment is coming up.
${F}
=========================
          LENDO
=========================
PAYMENT REMINDER
Due in 3 days

Ref     : {{loanRef}}
Due date: {{dueDate}}
-------------------------
Balance  : TZS {{outstanding}}
Total due: TZS {{totalDue}}
=========================
${F}
Please arrange payment to avoid late fees. If you've already paid, kindly ignore this.
_Borrow with confidence. Repay with ease._`,
  },

  // 3. Due Today
  {
    key: "due_today",
    category: "loan",
    label: "Due today",
    description: "Same-day reminder — respectful, not alarming.",
    body: `Hi {{customerName}} 👋 A quick reminder from Lendo.
${F}
=========================
          LENDO
=========================
PAYMENT DUE TODAY

Ref     : {{loanRef}}
Date    : {{dueDate}}
-------------------------
Amount  : TZS {{totalDue}}
=========================
${F}
Please settle before the end of the day. Reply to this message if you need any help.
_Borrow with confidence. Repay with ease._`,
  },

  // 4. Overdue Notice
  {
    key: "overdue",
    category: "loan",
    label: "Overdue notice",
    description: "Sent when the due date has passed. Firm but respectful.",
    body: `Hi {{customerName}}, a notice from Lendo.
${F}
=========================
          LENDO
=========================
OVERDUE NOTICE

Ref     : {{loanRef}}
Was due : {{dueDate}}
Overdue : {{daysOverdue}} day(s)
-------------------------
Balance  : TZS {{outstanding}}
Total due: TZS {{totalDue}}
=========================
${F}
Please pay as soon as possible. If you're facing difficulty, reply and we'll find a way forward together.
_Helping you move forward._`,
  },

  // 5. Loan Disbursed
  {
    key: "loan_disbursed",
    category: "loan",
    label: "Loan disbursed",
    description: "Confirmation that funds have gone out.",
    body: `Hi {{customerName}} 🎉 Your loan has been disbursed.
${F}
=========================
          LENDO
=========================
LOAN DISBURSED

Ref     : {{loanRef}}
Date    : {{disbursedDate}}
Rate    : {{interestRate}} / cycle
Due by  : {{dueDate}}
-------------------------
Amount  : TZS {{principal}}
=========================
${F}
Thank you for choosing Lendo. Reply here anytime with questions about your repayment.
_Borrow with confidence. Repay with ease._`,
  },

  // 6. Payment Received Receipt
  {
    key: "payment_received",
    category: "payment",
    label: "Payment received receipt",
    description: "Sent right after recording a payment.",
    body: `Hi {{customerName}} ✅ We've received your payment — thank you.
${F}
=========================
          LENDO
=========================
PAYMENT RECEIPT

Ref     : {{loanRef}}
Date    : {{paidAt}}
Method  : {{method}}
-------------------------
Amount  : TZS {{amountReceived}}
Balance : TZS {{remainingBalance}}
=========================
${F}
Please keep this receipt for your records. You're doing great!
_Borrow with confidence. Repay with ease._`,
  },

  // 7. Loan Fully Repaid
  {
    key: "loan_settled",
    category: "loan",
    label: "Loan fully repaid",
    description: "Celebration message when the balance hits zero.",
    body: `Congratulations {{customerName}} 🎊 Your loan is fully repaid.
${F}
=========================
          LENDO
=========================
LOAN CLEARED

Ref       : {{loanRef}}
Cleared on: {{paidAt}}
-------------------------
Total paid: TZS {{totalRepaid}}
Balance   : TZS 0
=========================
${F}
Thank you for your trust and discipline. You're always welcome to borrow again.
_Helping you move forward._`,
  },

  // 8. Loan Approved
  {
    key: "loan_approved",
    category: "loan",
    label: "Loan approved",
    description: "Sent after approval, before disbursal.",
    body: `Hi {{customerName}} 🎉 Good news from Lendo.
${F}
=========================
          LENDO
=========================
LOAN APPROVED

Ref     : {{loanRef}}
-------------------------
Amount  : TZS {{principal}}
=========================
${F}
Our team will process your disbursal shortly. You'll get a confirmation once the funds are on the way.
_Borrow with confidence. Repay with ease._`,
  },

  // 9. Loan Declined
  {
    key: "loan_declined",
    category: "customer",
    label: "Loan declined",
    description: "Respectful decline that leaves the door open.",
    body: `Hi {{customerName}}, an update on your Lendo application.
${F}
=========================
          LENDO
=========================
APPLICATION UPDATE

Status  : Not approved
         at this time
=========================
${F}
Thank you for the trust you placed in us. Circumstances change — you're welcome to apply again in the future. Wishing you all the best.
_Helping you move forward._`,
  },

  // 10. General Company Receipt
  {
    key: "general_receipt",
    category: "customer",
    label: "General receipt",
    description: "Reusable receipt for any transaction.",
    body: `Hi {{customerName}} ✅ Here is your Lendo receipt.
${F}
=========================
          LENDO
=========================
RECEIPT

Ref     : {{reference}}
Date    : {{date}}
Details : {{description}}
-------------------------
Amount  : TZS {{amount}}
=========================
${F}
Please keep this receipt for your records. Reply here if anything looks off.
_Borrow with confidence. Repay with ease._`,
  },
];

const TEMPLATES_BY_KEY = new Map(MESSAGE_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): MessageTemplate | undefined {
  return TEMPLATES_BY_KEY.get(key);
}

/**
 * Render a template body by substituting {{placeholder}} tokens.
 * Missing placeholders render as "—" so the message never contains
 * `{{...}}` when copied to WhatsApp.
 */
export function renderMessage(
  body: string,
  values: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    if (v === undefined || v === null || v === "") return "—";
    return String(v);
  });
}
