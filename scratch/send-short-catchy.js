require("dotenv").config();
const { SesService } = require("../dist/email-campaigns/services/ses.service");
const { TemplateEngineService } = require("../dist/email-campaigns/services/template-engine.service");
const { ConfigService } = require("@nestjs/config");

const configService = new ConfigService();
const sesService = new SesService(configService);
const templateEngine = new TemplateEngineService();

async function sendShortCatchyEmail() {
  console.log("Dispatching Short & Catchy Primary-Inbox Email to brittobritto111@gmail.com...");

  const context = {
    businessName: "Agla Kaam Technologies",
    unsubscribeUrl: "https://aglakaam.app/unsubscribe?token=demo-preview-token",
  };

  const rawHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>quick question for {{businessName}}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.55; color: #1f2937;">
  <div style="max-width: 520px; margin: 0 auto; padding: 20px 16px;">
    
    <p style="margin: 0 0 14px 0;">
      Hi Team at {{businessName}},
    </p>

    <p style="margin: 0 0 14px 0;">
      How do you currently track when a customer is due for repeat service after 3 or 6 months?
    </p>

    <p style="margin: 0 0 14px 0;">
      Most service businesses lose over 50% of repeat jobs simply because tracking revisit dates in notebooks or phone notes gets forgotten.
    </p>

    <p style="margin: 0 0 12px 0;">
      We built <strong><a href="https://aglakaam.app" target="_blank" style="color: #2563eb; text-decoration: none;">Agla Kaam</a></strong> to automate this. It automatically sends polite WhatsApp reminders before a customer's maintenance is due:
    </p>

    <div style="margin: 14px 0; padding: 12px 14px; background-color: #f8fafc; border-left: 3px solid #2563eb; border-radius: 0 6px 6px 0; font-size: 14px; line-height: 1.5; color: #1e293b;">
      <em>"Namaste Rajesh ji, your scheduled AC service is due on 15th Oct from {{businessName}}. Reply to confirm your visit time."</em>
    </div>

    <p style="margin: 0 0 16px 0;">
      It also handles 1-click GST invoices and complete customer history on your phone.
    </p>

    <p style="margin: 0 0 20px 0; font-weight: 500;">
      Would this be useful for {{businessName}}? You can test it free at <a href="https://aglakaam.app" target="_blank" style="color: #2563eb; text-decoration: underline;">aglakaam.app</a> or just reply here.
    </p>

    <div style="margin-top: 22px; padding-top: 14px; border-top: 1px solid #f3f4f6;">
      <p style="margin: 0 0 2px 0; font-weight: 700; color: #111827;">Rajeev</p>
      <p style="margin: 0 0 2px 0; color: #6b7280; font-size: 13.5px;">Agla Kaam</p>
      <p style="margin: 0; font-size: 13.5px;"><a href="mailto:support@aglakaam.app" style="color: #2563eb; text-decoration: none;">support@aglakaam.app</a></p>
    </div>

    <div style="margin-top: 28px; font-size: 11.5px; color: #9ca3af; line-height: 1.4;">
      To opt out: <a href="{{unsubscribeUrl}}" target="_blank" style="color: #9ca3af; text-decoration: underline;">unsubscribe</a>
    </div>

  </div>
</body>
</html>`;

  const rawText = `Hi Team at {{businessName}},

How do you currently track when a customer is due for repeat service after 3 or 6 months?

Most service businesses lose over 50% of repeat jobs simply because tracking revisit dates in notebooks or phone notes gets forgotten.

We built Agla Kaam (https://aglakaam.app) to automate this. It automatically sends polite WhatsApp reminders before a customer's maintenance is due:

"Namaste Rajesh ji, your scheduled AC service is due on 15th Oct from {{businessName}}. Reply to confirm your visit time."

It also handles 1-click GST invoices and complete customer history on your phone.

Would this be useful for {{businessName}}? You can test it free at https://aglakaam.app or just reply here.

Rajeev
Agla Kaam
support@aglakaam.app

---
To opt out: {{unsubscribeUrl}}`;

  const renderedHtml = templateEngine.render(rawHtml, context);
  const renderedText = templateEngine.render(rawText, context);

  const result = await sesService.sendEmail({
    to: "brittobritto111@gmail.com",
    fromName: "Rajeev - Agla Kaam",
    fromEmail: "rajeev@aglakaam.app",
    replyTo: ["support@aglakaam.app"],
    subject: "quick question for {{businessName}}",
    html: renderedHtml,
    text: renderedText,
    tags: {
      campaign: "short-catchy-primary",
      sender: "rajeev",
      replyTo: "support",
    },
  });

  console.log("\n=======================================================");
  console.log("✅ SHORT & CATCHY PRIMARY EMAIL SENT!");
  console.log("=======================================================");
  console.log("SES Message ID :", result.messageId);
  console.log("From           :", "Rajeev - Agla Kaam <rajeev@aglakaam.app>");
  console.log("Reply-To       :", "support@aglakaam.app");
  console.log("Recipient (To) :", "brittobritto111@gmail.com");
  console.log("Subject        :", "quick question for Agla Kaam Technologies");
  console.log("Status         : 200 OK — ACCEPTED BY AMAZON SES");
  console.log("=======================================================\n");
}

sendShortCatchyEmail().catch((err) => {
  console.error("FAILED to send:", err);
  process.exit(1);
});
