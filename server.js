/**
 * @author pschroen / https://ufo.ai/
 *
 * Remix of https://glitch.com/edit/#!/hello-express
 * Remix of https://glitch.com/edit/#!/multiuser-sketchpad
 */

import express from 'express';
import enableWs from 'express-ws';
import { promisify } from 'util';
import child_process from 'child_process';
const exec = promisify(child_process.exec);

let osRelease;
let numProcessingUnits;
let serverUptime;
let normalizedLoadAverage;

try {
	osRelease = (await exec('cat /etc/issue')).stdout;
	osRelease = osRelease.split(' ')[0];
} catch (err) {
	console.warn(err.stderr);
}

try {
	numProcessingUnits = (await exec('nproc --all')).stdout;
	numProcessingUnits = Number(numProcessingUnits);
} catch (err) {
	console.warn(err.stderr);
}

const interval = 4000; // 4 second heartbeat

const app = express();
const expressWs = enableWs(app);
expressWs.getWss('/');

app.use(express.static('public'));

//

import db from './sqlite.js';

await db.ready();

// Get the last ~20 status records (4 seconds x 20) = 80
console.log(await getAll(Math.floor(Date.now() / 1000) - 80));

//

const clients = [];

async function getAll(time) {
	const data = (await db.getAll(time)).map(({ time, uptime, loadavg }) => {
		return [
			time,
			uptime,
			loadavg !== null ? loadavg / 100 : null // Convert back to normalized load average in 0 to 1 range
		];
	});

	// console.log('ALL:', twoDaysSeconds, data);

	return data;
}

async function getStatus() {
	const currentTime = Math.floor(Date.now() / 1000); // seconds

	try {
		serverUptime = (await exec('cat /proc/uptime')).stdout;
		serverUptime = Number(serverUptime.split(' ')[0]);
	} catch (err) {
		console.warn(err.stderr);
	}

	try {
		normalizedLoadAverage = (await exec('cat /proc/loadavg')).stdout;
		normalizedLoadAverage = Number(normalizedLoadAverage.split(' ')[0]) / numProcessingUnits; // 0 to 1 range
		normalizedLoadAverage = Math.round((normalizedLoadAverage + Number.EPSILON) * 100) / 100;
	} catch (err) {
		console.warn(err.stderr);
	}

	const data = [currentTime, serverUptime, normalizedLoadAverage];

	// console.log('STATUS:', data);

	// Store integers for time, uptime, and load average as percentage
	await db.addStatus([currentTime, serverUptime, normalizedLoadAverage * 100]);

	return data;
}

async function getDetails() {
	const currentTime = Math.floor(Date.now() / 1000); // seconds

	try {
		serverUptime = (await exec('cat /proc/uptime')).stdout;
		serverUptime = Number(serverUptime.split(' ')[0]);
	} catch (err) {
		console.warn(err.stderr);
	}

	try {
		normalizedLoadAverage = (await exec('cat /proc/loadavg')).stdout;
		normalizedLoadAverage = Number(normalizedLoadAverage.split(' ')[0]) / numProcessingUnits; // 0 to 1 range
		normalizedLoadAverage = Math.round((normalizedLoadAverage + Number.EPSILON) * 100) / 100;
	} catch (err) {
		console.warn(err.stderr);
	}

	const data = {
		serverVersion: `Node/${process.versions.node} (${osRelease})`,
		currentTime,
		restartTime: currentTime - serverUptime,
		serverUptime,
		normalizedLoadAverage,
		numProcessingUnits
	};

	// console.log('DETAILS:', data);

	return data;
}

function add(ws, subscription) {
	clients.push(ws);

	ws._subscription = subscription;
	ws._latency;
}

function remove(ws) {
	const index = clients.indexOf(ws);

	if (~index) {
		clients.splice(index, 1);
	}
}

async function status() {
	const event = 'server-status';
	const message = {
		status: await getStatus()
	};

	for (let i = 0, l = clients.length; i < l; i++) {
		const client = clients[i];

		if (client._subscription === event && client.readyState === client.OPEN) {
			message.latency = client._latency;

			client.send(JSON.stringify({ event, message }));
		}
	}
}

app.ws('/', async (ws, request) => {
	ws.on('close', () => {
		remove(ws);
	});

	ws.on('message', async data => {
		const { event, message } = JSON.parse(data);

		switch (event) {
			case 'heartbeat':
				// console.log('HEARTBEAT:', message);
				ws._latency = Date.now() - message;
				break;
			case 'subscribe': {
				const { subscription } = message;
				// console.log('SUBSCRIBE:', subscription);

				add(ws, subscription.name);

				switch (subscription.name) {
					case 'server-status': {
						const event = 'server-status';
						const message = {
							status: await getAll(Math.floor(Date.now() / 1000) - subscription.time),
							latency: ws._latency
						};

						ws.send(JSON.stringify({ event, message }));
						break;
					}
				}
				break;
			}
		}
	});

	const event = 'server-details';
	const message = await getDetails();

	ws.send(JSON.stringify({ event, message }));

	const heartbeat = () => {
		if (ws.readyState === ws.OPEN) {
			const event = 'heartbeat';
			const message = Date.now();

			ws.send(JSON.stringify({ event, message }));

			setTimeout(heartbeat, interval);
		}
	};

	heartbeat();
});

//

import { performance } from 'perf_hooks';

let startTime = 0;
let timeout = null;

async function onUpdate() {
	startTime = performance.now();

	await status();

	if (timeout !== null) {
		timeout = setTimeout(onUpdate, Math.max(0, interval - (performance.now() - startTime)));
	}
}

// Start
startTime = 0;
timeout = setTimeout(onUpdate, 0);

// Stop
// clearTimeout(timeout);
// timeout = null;

//

const listener = app.listen(process.env.PORT, () => {
	console.log(`Your app is listening on port ${listener.address().port}`);
});
