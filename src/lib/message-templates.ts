// Lendo WhatsApp message templates. All bodies use {{placeholder}} tokens
// which are filled server-side from the loan / payment / customer being
// messaged. Staff copy-and-paste the rendered text into WhatsApp (or open
// wa.me with it pre-filled), so tone matters as much as accuracy: warm,
// respectful, concise, unmistakably Lendo.

export type MessageCategory = "loan" | "payment" | "customer";

export type MessageTemplate = {
  key: string;
  category: MessageCategory;
  label: string;
  description: string;
  body: string;
};

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // -------------------------------------------------------------------
  // 1. 7-Day Payment Reminder
  // -------------------------------------------------------------------
  {
    key: "reminder_7d",
    category: "loan",
    label: "7-day payment reminder",
    description: "Friendly heads-up one week before the due date.",
    body: `Hi {{customerName}} 👋

Just a friendly reminder — your Lendo loan payment is due in *7 days*.

*Payment details*
• Loan ref: {{loanRef}}
• Principal: TSh {{principal}}
• Interest ({{interestRate}}): TSh {{interest}}
• Outstanding balance: TSh {{outstanding}}
• Total due: TSh {{totalDue}}
• Due date: {{dueDate}}

Kindly plan ahead so we can keep your account in good standing. Thank you for choosing Lendo.

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 2. 3-Day Payment Reminder
  // -------------------------------------------------------------------
  {
    key: "reminder_3d",
    category: "loan",
    label: "3-day payment reminder",
    description: "A gentler nudge as the due date approaches.",
    body: `Hi {{customerName}} 👋

Your Lendo loan payment is due in *3 days*. Please arrange payment to avoid any late fees or impact on your account.

*Payment details*
• Loan ref: {{loanRef}}
• Outstanding balance: TSh {{outstanding}}
• Total due: TSh {{totalDue}}
• Due date: {{dueDate}}

We appreciate your prompt attention. If you've already sent payment, kindly disregard this message — thank you.

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 3. Due Today
  // -------------------------------------------------------------------
  {
    key: "due_today",
    category: "loan",
    label: "Due today",
    description: "Same-day reminder — respectful, not alarming.",
    body: `Hi {{customerName}} 👋

A quick reminder — your Lendo loan payment is *due today*, {{dueDate}}.

• Loan ref: {{loanRef}}
• Amount due: TSh {{totalDue}}

Please settle before the end of the day to keep your account current. If you need any help, just reply to this message — we're here for you.

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 4. Overdue Notice
  // -------------------------------------------------------------------
  {
    key: "overdue",
    category: "loan",
    label: "Overdue notice",
    description: "Sent when the due date has passed. Firm but respectful.",
    body: `Hi {{customerName}},

We noticed your Lendo loan payment of *TSh {{totalDue}}* was due on {{dueDate}} and is now *{{daysOverdue}} day(s) overdue*.

• Loan ref: {{loanRef}}
• Outstanding balance: TSh {{outstanding}}

Please make the payment as soon as possible. If you're facing any difficulty, please reach out — we'd rather find a way forward together than let this affect your standing with Lendo.

Reply to this message anytime.

— Lendo
_Helping you move forward._`,
  },

  // -------------------------------------------------------------------
  // 5. Loan Disbursed
  // -------------------------------------------------------------------
  {
    key: "loan_disbursed",
    category: "loan",
    label: "Loan disbursed",
    description: "Confirmation that funds have gone out.",
    body: `Hi {{customerName}} 🎉

Your Lendo loan has been *successfully disbursed*.

*Loan summary*
• Loan ref: {{loanRef}}
• Amount received: TSh {{principal}}
• Disbursed on: {{disbursedDate}}
• Interest rate: {{interestRate}} per 30-day cycle
• Full repayment due by: {{dueDate}}

Thank you for choosing Lendo. If you have any questions about your repayment schedule, we're just a message away.

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 6. Payment Received Receipt
  // -------------------------------------------------------------------
  {
    key: "payment_received",
    category: "payment",
    label: "Payment received receipt",
    description: "Sent right after recording a payment.",
    body: `Hi {{customerName}} ✅

We've received your payment. Thank you for paying — we truly appreciate it.

*Payment receipt*
• Loan ref: {{loanRef}}
• Amount received: TSh {{amountReceived}}
• Received on: {{paidAt}}
• Method: {{method}}
• Remaining balance: TSh {{remainingBalance}}

Please keep this message for your records. You're doing great — keep it up!

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 7. Loan Fully Repaid
  // -------------------------------------------------------------------
  {
    key: "loan_settled",
    category: "loan",
    label: "Loan fully repaid",
    description: "Celebration message when the balance hits zero.",
    body: `Congratulations, {{customerName}} 🎊

You have *fully repaid* your Lendo loan. Your account is now cleared with a zero balance.

*Final receipt*
• Loan ref: {{loanRef}}
• Total repaid: TSh {{totalRepaid}}
• Cleared on: {{paidAt}}

Thank you for your trust and discipline. You are a valued member of the Lendo family, and we'd be honored to serve you again whenever you need us.

— Lendo
_Helping you move forward._`,
  },

  // -------------------------------------------------------------------
  // 8. Loan Approved
  // -------------------------------------------------------------------
  {
    key: "loan_approved",
    category: "loan",
    label: "Loan approved",
    description: "Sent after approval, before disbursal.",
    body: `Hi {{customerName}} 🎉

Great news — your Lendo loan has been *approved*.

• Loan ref: {{loanRef}}
• Approved amount: TSh {{principal}}

Our team will process the disbursal shortly. You'll receive a confirmation as soon as the funds are on their way.

Thank you for choosing Lendo.

— Lendo
_Borrow with confidence. Repay with ease._`,
  },

  // -------------------------------------------------------------------
  // 9. Loan Declined
  // -------------------------------------------------------------------
  {
    key: "loan_declined",
    category: "customer",
    label: "Loan declined",
    description: "Respectful decline that leaves the door open.",
    body: `Hi {{customerName}},

Thank you for considering Lendo. After careful review, we're unable to approve your loan request at this time.

We know this may not be the news you were hoping for, and we sincerely appreciate the trust you placed in us. Circumstances change — please feel free to apply again in the future. We'd love the opportunity to serve you.

Wishing you all the best.

— Lendo
_Helping you move forward._`,
  },

  // -------------------------------------------------------------------
  // 10. General Company Receipt
  // -------------------------------------------------------------------
  {
    key: "general_receipt",
    category: "customer",
    label: "General receipt",
    description: "Reusable receipt for any transaction.",
    body: `Hi {{customerName}} ✅

This is your official Lendo receipt.

*Transaction*
• Reference: {{reference}}
• Amount: TSh {{amount}}
• Date: {{date}}
• Description: {{description}}

Please keep this receipt for your records. If anything looks off, reply to this message and we'll make it right.

— Lendo
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
