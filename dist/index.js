"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const googleapis_1 = require("googleapis");
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Initialize Supabase client with service role key
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// Gmail Auth setup for Service Account with Domain-Wide Delegation
const auth = new googleapis_1.google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    clientOptions: {
        subject: process.env.USER_TO_IMPERSONATE,
    },
});
const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});
// Webhook endpoint for Supabase Realtime
app.post('/webhook/notification', async (req, res) => {
    try {
        const { office_id, notification_type, data } = req.body;
        console.log('Received notification:', {
            office_id,
            notification_type,
            data,
        });
        // Process the notification
        const result = await processNotification(office_id, notification_type, data);
        if (result.success) {
            res.status(200).json({
                message: 'Notification processed successfully',
            });
        }
        else {
            res.status(500).json({ error: result.error });
        }
    }
    catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
async function processNotification(officeId, notificationType, data) {
    try {
        // 1. Get notification settings for the office
        const { data: settings, error: settingsError } = await supabase
            .from('office_notification_settings')
            .select('*')
            .eq('office_id', officeId)
            .single();
        if (settingsError || !settings) {
            return { success: false, error: 'No notification settings found' };
        }
        // 2. Check if this notification type is enabled
        const isEnabled = checkNotificationEnabled(settings, notificationType);
        if (!isEnabled) {
            console.log(`Notification type ${notificationType} disabled for office ${officeId}`);
            return { success: true, message: 'Notification disabled' };
        }
        // 3. Get office information
        const { data: office, error: officeError } = await supabase
            .from('gol')
            .select('office_name')
            .eq('office_id', officeId)
            .single();
        if (officeError || !office) {
            return { success: false, error: 'Office not found' };
        }
        // 4. Generate email content
        const emailContent = generateEmailContent(notificationType, data, office.office_name);
        // 5. Send emails to all recipients
        const emailPromises = settings.recipient_emails.map((email) => sendGmailNotification(email, emailContent));
        await Promise.all(emailPromises);
        console.log(`Sent ${notificationType} notification to ${settings.recipient_emails.length} recipients`);
        return { success: true };
    }
    catch (error) {
        console.error('Error processing notification:', error);
        return { success: false, error: error.message };
    }
}
function checkNotificationEnabled(settings, notificationType) {
    switch (notificationType) {
        case 'date_request':
            return settings.notify_on_date_request;
        case 'patient_status':
            return settings.notify_on_patient_status;
        case 'production_summary':
            return settings.notify_on_production_summary;
        default:
            return false;
    }
}
async function sendGmailNotification(to, content) {
    try {
        // Log email sending attempt
        console.log(`Attempting to send email. Recipient: ${to}, Subject: "${content.subject}"`);
        const message = [
            `To: ${to}`,
            `Subject: ${content.subject}`,
            'Content-Type: text/html; charset=utf-8',
            '',
            content.html,
        ].join('\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log(`Email sent successfully to ${to}`);
    }
    catch (error) {
        console.error(`Failed to send email to ${to}:`, error);
        throw error;
    }
}
function generateEmailContent(type, data, officeName) {
    const baseStyle = `
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .header { background-color: #1e40af; color: white; padding: 20px; text-align: center; }
      .content { padding: 20px; }
      .footer { background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #666; }
      .status-approved { color: #059669; font-weight: bold; }
      .status-denied { color: #dc2626; font-weight: bold; }
      .highlight { background-color: #fef3c7; padding: 10px; border-left: 4px solid #f59e0b; margin: 15px 0; }
    </style>
  `;
    switch (type) {
        case 'date_request':
            return {
                subject: `Date Request ${data.status === 'approved' ? 'Approved' : 'Denied'} - ${officeName}`,
                html: `
          ${baseStyle}
          <div class="header">
            <h1>Elite Sedation - Date Request Update</h1>
          </div>
          <div class="content">
            <h2>Date Request ${data.status === 'approved' ? 'Approved' : 'Denied'}</h2>
            <p><strong>Office:</strong> ${officeName}</p>
            <p><strong>Requested Date:</strong> ${data.date}</p>
            <p><strong>Status:</strong> <span class="status-${data.status}">${data.status?.toUpperCase()}</span></p>
            ${data.denial_reason
                    ? `<div class="highlight"><strong>Reason:</strong> ${data.denial_reason}</div>`
                    : ''}
            <p>Please log into your portal for more details.</p>
          </div>
          <div class="footer">
            <p>This is an automated notification from Elite Sedation</p>
          </div>
        `,
            };
        case 'patient_status':
            return {
                subject: `Patient Status Update - ${officeName}`,
                html: `
          ${baseStyle}
          <div class="header">
            <h1>Elite Sedation - Patient Status Update</h1>
          </div>
          <div class="content">
            <h2>Patient Status Changed</h2>
            <p><strong>Office:</strong> ${officeName}</p>
            <p><strong>Date:</strong> ${data.date}</p>
            <p><strong>Provider ID:</strong> ${data.provider_id || 'Not assigned'}</p>
            <p>Please review the patient details in your portal.</p>
          </div>
          <div class="footer">
            <p>This is an automated notification from Elite Sedation</p>
          </div>
        `,
            };
        case 'production_summary':
            return {
                subject: `Production Summary Updated - ${officeName}`,
                html: `
          ${baseStyle}
          <div class="header">
            <h1>Elite Sedation - Production Summary</h1>
          </div>
          <div class="content">
            <h2>Payment Update</h2>
            <p><strong>Office:</strong> ${officeName}</p>
            <p><strong>Amount:</strong> $${data.amount?.toLocaleString()}</p>
            <p><strong>Due Date:</strong> ${data.due_date}</p>
            <p><strong>Status:</strong> ${data.status}</p>
            <div class="highlight">
              <p>Your production summary has been updated. Please log into your portal to view the complete details.</p>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated notification from Elite Sedation</p>
          </div>
        `,
            };
        default:
            throw new Error('Invalid notification type');
    }
}
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Cloud Run service listening on port ${PORT}`);
});
