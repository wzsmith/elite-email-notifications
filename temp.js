const { google } = require('googleapis');
const fs = require('fs');

// Load credentials from a service account key file
const keyFile = './elite-website-v1-a7752efd130f.json'; // Ensure this file exists
let serviceAccount;
try {
	serviceAccount = require(keyFile);
} catch (error) {
	console.error(
		`Error loading service account key file from ${keyFile}:`,
		error
	);
	console.error(
		'Please ensure the file exists and is a valid JSON service account key.'
	);
	process.exit(1);
}

const scopes = ['https://www.googleapis.com/auth/gmail.send'];
const userToImpersonate = 'notifications@elitesedation.com';

if (!userToImpersonate) {
	console.error(
		'Error: The USER_TO_IMPERSONATE environment variable is not set.'
	);
	console.error(
		'Please set it to the email address of the Google Workspace user you want to send emails as.'
	);
	process.exit(1);
}

const jwtClient = new google.auth.JWT({
	email: serviceAccount.client_email,
	key: serviceAccount.private_key,
	scopes,
	subject: userToImpersonate,
});

const gmail = google.gmail({ version: 'v1', auth: jwtClient });

const recipientEmail = 'temp@elitesedation.com';
const subject = 'Test Email from Node Script';
const emailBody =
	'This is a test message sent via the Gmail API using a Node.js script with impersonation.';

// Construct the raw email message in RFC 2822 format
const emailLines = [
	`To: ${recipientEmail}`,
	`From: ${userToImpersonate}`, // The "From" header should be the impersonated user
	`Subject: ${subject}`,
	'Content-Type: text/plain; charset=utf-8', // Or text/html for HTML emails
	'',
	emailBody,
];
const rawEmail = emailLines.join('\n');

// Encode the raw email message to base64url format
const encodedMessage = Buffer.from(rawEmail)
	.toString('base64')
	.replace(/\+/g, '-')
	.replace(/\//g, '_')
	.replace(/=+$/, ''); // Remove padding

console.log(
	`Attempting to send email as ${userToImpersonate} to ${recipientEmail}...`
);

async function sendEmail() {
	try {
		const response = await gmail.users.messages.send({
			userId: 'me', // 'me' refers to the impersonated user
			requestBody: {
				raw: encodedMessage,
			},
		});
		console.log('Email sent successfully! Message ID:', response.data.id);
		console.log('Response data:', response.data);
	} catch (error) {
		console.error('Failed to send email:');
		if (error.response) {
			console.error('Status:', error.response.status);
			console.error('Data:', error.response.data);
			console.error('Headers:', error.response.headers);
		} else {
			console.error('Error details:', error.message);
		}
		console.error('\nFull error object:', error);
		console.error('\nTroubleshooting tips:');
		console.error(
			'1. Verify USER_TO_IMPERSONATE is correct and the user has a Gmail license.'
		);
		console.error(
			'2. Ensure the service account has domain-wide delegation with the "https://www.googleapis.com/auth/gmail.send" scope in Google Workspace Admin console.'
		);
		console.error(
			'3. Check if the Gmail API is enabled in your Google Cloud Project.'
		);
	}
}

sendEmail();
