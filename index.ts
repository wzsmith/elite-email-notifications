// index.ts
import express from 'express';
import {
	createClient,
	SupabaseClient,
	RealtimeChannel,
} from '@supabase/supabase-js';
import { google } from 'googleapis';

interface OfficeNotificationSettings {
	office_id: number;
	recipient_emails: string[];
	notify_on_date_request: boolean;
	notify_on_patient_status: boolean;
	notify_on_production_summary: boolean;
	// Add any other properties that office_notification_settings might have
}

const app = express();
app.use(express.json());

// Initialize Supabase client with service role key
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
	console.error('Supabase URL or Service Role Key is not defined. Exiting.');
	process.exit(1);
}

const supabase: SupabaseClient = createClient(
	supabaseUrl,
	supabaseServiceRoleKey
);

// Gmail Auth setup
const auth = new google.auth.GoogleAuth({
	scopes: ['https://www.googleapis.com/auth/gmail.send'],
	clientOptions: {
		subject: process.env.USER_TO_IMPERSONATE,
	},
});

const gmail = google.gmail({ version: 'v1', auth });

// Health check endpoint
app.get('/health', (req, res) => {
	res.status(200).json({ status: 'healthy' });
});

function logGoogleApplicationCredentials() {
	const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

	if (gacPath) {
		console.log(
			`The GOOGLE_APPLICATION_CREDENTIALS environment variable is set to: "${gacPath}"`
		);
	} else {
		console.log(
			'The GOOGLE_APPLICATION_CREDENTIALS environment variable is NOT set.'
		);
	}
}

logGoogleApplicationCredentials();
// Webhook endpoint for Supabase Realtime
// app.post('/webhook/notification', async (req, res) => {
// 	try {
// 		const { office_id, notification_type, data } = req.body;

// 		console.log('Received notification:', {
// 			office_id,
// 			notification_type,
// 			data,
// 		});

// 		// Process the notification
// 		const result = await processNotification(
// 			office_id,
// 			notification_type,
// 			data
// 		);

// 		if (result.success) {
// 			res.status(200).json({
// 				message: 'Notification processed successfully',
// 			});
// 		} else {
// 			res.status(500).json({ error: result.error });
// 		}
// 	} catch (error) {
// 		console.error('Webhook error:', error);
// 		res.status(500).json({ error: 'Internal server error' });
// 	}
// });

async function processNotification(
	officeId: number,
	notificationType: string,
	data: any
) {
	try {
		// 1. Get notification settings for the office
		const { data: settings, error: settingsError } = await supabase
			.from('office_notification_settings')
			.select('*')
			.eq('office_id', officeId)
			.single<OfficeNotificationSettings>();

		if (settingsError || !settings) {
			return {
				success: false,
				error: `No notification settings found for office ${officeId}: ${settingsError?.message}`,
			};
		}
		console.log('Notification Settings:', settings);

		// 2. Check if this notification type is enabled
		const isEnabled = checkNotificationEnabled(settings, notificationType);
		if (!isEnabled) {
			console.log(
				`Notification type ${notificationType} disabled for office ${officeId}`
			);
			return { success: true, message: 'Notification disabled' };
		}

		// 3. Get office information
		const { data: office, error: officeError } = await supabase
			.from('gol')
			.select('office_name')
			.eq('office_id', officeId)
			.single();

		if (officeError || !office) {
			return {
				success: false,
				error: `Office not found for office_id ${officeId}: ${officeError?.message}`,
			};
		}

		// 4. Generate email content
		const emailContent = generateEmailContent(
			notificationType,
			data,
			office.office_name
		);

		// 5. Send emails to all recipients
		const emailPromises = settings.recipient_emails.map((email) =>
			sendGmailNotification(email, emailContent)
		);

		await Promise.all(emailPromises);

		console.log(
			`Sent ${notificationType} notification to ${settings.recipient_emails.length} recipients for office ${officeId}`
		);
		return { success: true };
	} catch (error) {
		console.error(
			`Error processing notification for office ${officeId}, type ${notificationType}:`,
			error
		);
		const errorMessage =
			error instanceof Error
				? error.message
				: 'An unknown error occurred';
		return { success: false, error: errorMessage };
	}
}

function checkNotificationEnabled(
	settings: OfficeNotificationSettings,
	notificationType: string
): boolean {
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

async function sendGmailNotification(
	to: string,
	content: { subject: string; html: string }
) {
	try {
		// Log email sending attempt
		console.log(
			`Attempting to send email. Recipient: ${to}, Subject: "${content.subject}"`
		);

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
	} catch (error) {
		console.error(`Failed to send email to ${to}:`, error);
		throw error; // Re-throw to be caught by processNotification
	}
}

function generateEmailContent(type: string, data: any, officeName: string) {
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
				subject: `Date Request ${
					data.status === 'approved' ? 'Approved' : 'Denied'
				} - ${officeName}`,
				html: `
          ${baseStyle}
          <div class="header">
            <h1>Elite Sedation - Date Request Update</h1>
          </div>
          <div class="content">
            <h2>Date Request ${
				data.status === 'approved' ? 'Approved' : 'Denied'
			}</h2>
            <p><strong>Office:</strong> ${officeName}</p>
            <p><strong>Requested Date:</strong> ${data.date}</p>
            <p><strong>Status:</strong> <span class="status-${
				data.status
			}">${data.status?.toUpperCase()}</span></p>
            ${
				data.denial_reason
					? `<div class="highlight"><strong>Reason:</strong> ${data.denial_reason}</div>`
					: ''
			}
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
            <p><strong>Provider ID:</strong> ${
				data.provider_id || 'Not assigned'
			}</p>
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
			console.warn(
				`Invalid notification type for email generation: ${type}`
			); // Log a warning
			return {
				subject: `Notification Update - ${officeName}`,
				html: `${baseStyle}<div><h2>Generic Notification</h2><p>Office: ${officeName}</p><p>Type: ${type}</p><p>Data: ${JSON.stringify(
					data
				)}</p></div>`,
			};
	}
}

// --- Supabase Realtime Subscription ---
const REALTIME_CHANNEL_NAME = 'cloudrun_notifications'; // Matches topic in realtime.send()

console.log(
	`Attempting to subscribe to Supabase Realtime channel: ${REALTIME_CHANNEL_NAME}`
);
const channel: RealtimeChannel = supabase.channel(REALTIME_CHANNEL_NAME, {
	config: {
		private: true, // Add this to indicate the channel may have RLS policies
	},
});

channel
	.on(
		'broadcast', // Listen for broadcast messages
		{ event: '*' }, // Listen for any event type on this channel
		(message) => {
			// 'message' contains { event: string, payload: any }
			console.log(
				'Received Supabase Realtime message. Event:',
				message.event,
				'Payload:',
				message.payload
			);

			const notificationPayload = message.payload; // This is the 'notification_data' from the database

			if (
				notificationPayload &&
				notificationPayload.office_id &&
				notificationPayload.notification_type
			) {
				// It's good practice to use message.event as the definitive event type
				if (message.event !== notificationPayload.notification_type) {
					console.warn(
						`Mismatch: message.event is "${message.event}" while payload.notification_type is "${notificationPayload.notification_type}". Using message.event.`
					);
				}

				console.log(
					`Processing Realtime notification for event: ${message.event}, office_id: ${notificationPayload.office_id}`
				);
				processNotification(
					notificationPayload.office_id,
					message.event, // Use the event from the broadcast message wrapper
					notificationPayload.data // This is the nested 'data' object from your notification_data
				)
					.then((result) => {
						if (result.success) {
							console.log(
								`Successfully processed notification for office ${notificationPayload.office_id} (Event: ${message.event}) from Realtime.`
							);
						} else {
							console.error(
								`Failed to process notification for office ${notificationPayload.office_id} (Event: ${message.event}) from Realtime: ${result.error}`
							);
						}
					})
					.catch((error) => {
						console.error(
							'Unhandled error in processNotification triggered by Realtime:',
							error
						);
					});
			} else {
				console.error(
					'Received invalid or incomplete Realtime message structure:',
					message
				);
			}
		}
	)
	.subscribe((status, err) => {
		// Call subscribe to connect
		if (status === 'SUBSCRIBED') {
			console.log(
				`Successfully subscribed to Supabase Realtime channel: ${REALTIME_CHANNEL_NAME} (private mode)`
			);
		} else if (
			status === 'CHANNEL_ERROR' ||
			status === 'TIMED_OUT' ||
			status === 'CLOSED'
		) {
			console.error(
				`Subscription to ${REALTIME_CHANNEL_NAME} failed or closed. Status: ${status}`,
				err
			);
			// Consider retry logic if appropriate
		} else {
			console.log(
				`Subscription status for ${REALTIME_CHANNEL_NAME}: ${status}`,
				err || ''
			);
		}
	});

// --- End Supabase Realtime Subscription ---

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
	console.log(`Cloud Run service listening on port ${PORT}`);
	console.log(`Supabase URL configured: ${supabaseUrl}`); // Log to confirm URL is loaded
	// Supabase client initialization and subscription are now part of the instance startup.
});
