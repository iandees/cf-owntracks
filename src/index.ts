/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { cors } from 'hono/cors';

interface Env {
	STORAGE: R2Bucket;
	BASIC_AUTH_USER: string;    // Username environment variable
	BASIC_AUTH_PASS: string;    // Password environment variable
	LAST_LOCATIONS: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// 添加 CORS 支持
app.use('/*', cors({
	origin: 'http://localhost:5173',
	allowHeaders: ['Content-Type', 'Authorization'],
	credentials: true
}));

app.use('/*', async (c, next) => {
	return basicAuth({
		username: c.env.BASIC_AUTH_USER,
		password: c.env.BASIC_AUTH_PASS,
		realm: 'Secure Area'
	})(c, next);
});

app.post('/', async (c) => {
	try {
		const payload = await c.req.json();

		if (payload._type !== 'location') {
			return c.json([]);
		}

		// Validate basic fields
		if (payload._type !== 'location' || !payload.lat || !payload.lon) {
			return c.json({ error: 'Invalid location payload' }, 400);
		}

		// Validate and parse topic
		if (!payload.topic) {
			return c.json({ error: 'Missing topic' }, 400);
		}

		const topicParts = payload.topic.split('/');
		if (topicParts.length !== 3 || topicParts[0] !== 'owntracks') {
			return c.json({ error: 'Invalid topic format. Expected: owntracks/<username>/<devicename>' }, 400);
		}

		const [_, username, device] = topicParts;

		await updateLastLocations(c.env, username, device, payload);

		// Generate storage path
		const now = new Date();
		// If payload contains tst (Unix timestamp), use it as the timestamp
		const timestamp = payload.tst
			? new Date(payload.tst * 1000).toISOString()
			: now.toISOString();

		const month = timestamp.substring(0, 7); // YYYY-MM
		const storagePath = `rec/${username}/${device}/${month}.rec`;
		console.log(storagePath);

		// Format record line
		const newRecord = `${timestamp} * ${JSON.stringify(payload)}\n`;

		// Read existing content or create new file
		let content = '';
		const existingFile = await c.env.STORAGE.get(storagePath);
		if (existingFile) {
			content = await existingFile.text();
		}

		// Append new record
		content += newRecord;
		console.log(content);

		// Store updated content
		await c.env.STORAGE.put(storagePath, content, {
			httpMetadata: {
				contentType: 'text/plain',
			}
		});

		// Return empty array according to Owntracks specification
		return c.json([]);

	} catch (error) {
		console.error('Error processing location:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

app.get('/api/0/locations', async (c) => {
	try {
		const user = c.req.query('user');
		const device = c.req.query('device');
		const from = c.req.query('from');
		const to = c.req.query('to');

		// Validate required parameters
		if (!user || !device) {
			return c.json({ error: 'User and device parameters are required' }, 400);
		}

		// Parse time range
		const fromDate = from ? new Date(from) : new Date(0); // If no from, use earliest time
		const toDate = to ? new Date(to) : new Date(); // If no to, use current time

		// Get list of months to read
		const months: string[] = [];
		const currentMonth = new Date(fromDate);
		while (currentMonth <= toDate) {
			months.push(currentMonth.toISOString().substring(0, 7)); // YYYY-MM
			currentMonth.setMonth(currentMonth.getMonth() + 1);
		}

		// Store all location data
		let locations: any[] = [];

		// Only read required month files
		for (const month of months) {
			const filePath = `rec/${user}/${device}/${month}.rec`;
			const file = await c.env.STORAGE.get(filePath);
			if (!file) continue;

			const content = await file.text();
			const lines = content.split('\n').filter(line => line.trim());

			for (const line of lines) {
				const [timestamp, _, jsonStr] = line.split(' ');
				if (!jsonStr) continue;

				const recordDate = new Date(timestamp);

				// Time filtering
				if (recordDate < fromDate || recordDate > toDate) continue;

				try {
					const location = JSON.parse(jsonStr);
					locations.push(location);
				} catch (e) {
					console.error('Error parsing location data:', e);
				}
			}
		}

		return c.json({ data: locations });

	} catch (error) {
		console.error('Error processing locations request:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

app.get('/api/0/list', async (c) => {
	try {
		const user = c.req.query('user');
		const device = c.req.query('device');

		if (user && device) {
			const prefix = `rec/${user}/${device}/`;
			const objects = await c.env.STORAGE.list({ prefix });
			const recFiles = objects.objects
				.map(obj => obj.key.split('/').pop()) // Only return file names
				.filter(name => name?.endsWith('.rec'));
			return c.json(recFiles);
		}

		// List all devices for specified user
		if (user) {
			const prefix = `rec/${user}/`;
			const objects = await c.env.STORAGE.list({ prefix });
			const devices = new Set(
				objects.objects
					.map(obj => obj.key.split('/')[2]) // Get device name
					.filter(Boolean)
			);
			return c.json({ results: Array.from(devices) });
		}

		// List all users
		const prefix = 'rec/';
		const objects = await c.env.STORAGE.list({ prefix });
		const users = new Set(
			objects.objects
				.map(obj => obj.key.split('/')[1]) // Get user name
				.filter(Boolean)
		);
		return c.json({ results: Array.from(users) });

	} catch (error) {
		console.error('Error listing data:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

app.get('/api/0/version', async (c) => {
	return c.json({ version: '0.0.1' });
});

app.get('/api/0/last', async (c) => {
	try {
		const user = c.req.query('user');
		const device = c.req.query('device');
		const fields = c.req.query('fields')?.split(',');

		let key;
		if (user && device) {
			key = `last:${user}:${device}`;
		} else if (user) {
			key = `last:${user}`;
		} else {
			key = 'last:all';
		}

		const lastLocation = await c.env.LAST_LOCATIONS.get(key);
		if (!lastLocation) {
			return c.json({ error: 'No location data found' }, 404);
		}

		let result = JSON.parse(lastLocation);

		return c.json(result);
	} catch (error) {
		console.error('Error fetching last location:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

async function updateLastLocations(env: Env, username: string, device: string, lastLocation: any) {
	try {
		// 1. Update the latest location for the specific user and device
		const userDeviceKey = `last:${username}:${device}`;
		await env.LAST_LOCATIONS.put(userDeviceKey, JSON.stringify([lastLocation]));

		// 2. Update the latest location list for all devices of the user
		const userKey = `last:${username}`;
		const existingUserData = await env.LAST_LOCATIONS.get(userKey);
		let userDevices = [];
		if (existingUserData) {
			userDevices = JSON.parse(existingUserData);
			// Filter by parsing device information from topic
			userDevices = userDevices.filter(loc => {
				const [_, __, deviceId] = loc.topic.split('/');
				return deviceId !== device;
			});
		}
		userDevices.push(lastLocation);
		await env.LAST_LOCATIONS.put(userKey, JSON.stringify(userDevices));

		// 3. Update the global latest location
		const globalKey = 'last:all';
		const existingGlobalData = await env.LAST_LOCATIONS.get(globalKey);
		let allLocations = [];
		if (existingGlobalData) {
			allLocations = JSON.parse(existingGlobalData);
			// Filter by parsing user and device information from topic
			allLocations = allLocations.filter(loc => {
				const [_, userId, deviceId] = loc.topic.split('/');
				return !(userId === username && deviceId === device);
			});
		}
		allLocations.push(lastLocation);
		await env.LAST_LOCATIONS.put(globalKey, JSON.stringify(allLocations));
	} catch (error) {
		console.error('Error updating last locations:', error);
		throw error; // Propagate error to be handled by the main function
	}
}



export default app;
