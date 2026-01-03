/**
 * @author pschroen / https://ufo.ai/
 *
 * Remix of https://glitch.com/edit/#!/hello-express
 * Remix of https://glitch.com/edit/#!/multiuser-sketchpad
 */

import { promisify } from 'node:util';
import child_process from 'node:child_process';
const exec = promisify(child_process.exec);

let osRelease;
let processorName;
let numProcessingUnits;
let ipinfo;
let memTotal;
let memFree;
let swapTotal;
let swapFree;
let storageTotal;
let storageAvailable;
let serverUptime;
let normalizedLoadAverage;

try {
	osRelease = (await exec('cat /etc/issue')).stdout;
	osRelease = osRelease.split(' ')[0];
} catch (err) {
	console.warn(err.stderr);
}

try {
	processorName = (await exec('lscpu | sed -nr "/Model name/ s/.*:\\s*(.*)/\\1/p" | tr -d "\\n"')).stdout;
} catch (err) {
	console.warn(err.stderr);
}

try {
	numProcessingUnits = (await exec('nproc --all')).stdout;
	numProcessingUnits = Number(numProcessingUnits);
} catch (err) {
	console.warn(err.stderr);
}

try {
	ipinfo = (await exec('curl https://ipinfo.io/')).stdout;
	ipinfo = JSON.parse(ipinfo);
} catch (err) {
	console.warn(err.stderr);
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
		let free = (await exec('free -b | tail -2 | tr -s " " | cut -d " " -f 2,4')).stdout;
		free = free.split('\n').map(stdout => stdout.split(' '));
		memTotal = Number(free[0][0]);
		memFree = Number(free[0][1]);
		swapTotal = Number(free[1][0]);
		swapFree = Number(free[1][1]);
	} catch (err) {
		console.warn(err.stderr);
	}

	try {
		let storage = (await exec('df -B1 . | tail -1 | tr -s " " | cut -d " " -f 2,4')).stdout;
		storage = storage.split(' ');
		storageTotal = Number(storage[0]);
		storageAvailable = Number(storage[1]);
	} catch (err) {
		console.warn(err.stderr);
	}

	const data = {
		packageVersion: process.env.npm_package_name && process.env.npm_package_version ? `${process.env.npm_package_name}/${process.env.npm_package_version}` : undefined,
		projectDomain: process.env.PROJECT_DOMAIN ? `${process.env.PROJECT_DOMAIN}.glitch.me` : undefined,
		networkName: `${ipinfo.hostname} (${ipinfo.ip})`,
		serverVersion: `Node/${process.versions.node}${osRelease ? ` (${osRelease})` : ''}`,
		restartTime: currentTime - serverUptime || undefined,
		memTotal: memTotal || undefined,
		memFree: memFree || undefined,
		swapTotal: swapTotal || undefined,
		swapFree: swapFree || undefined,
		storageTotal: storageTotal || undefined,
		storageAvailable: storageAvailable || undefined,
		processorName: processorName || undefined,
		numProcessingUnits: numProcessingUnits || undefined
	};

	// console.log('DETAILS:', data);

	return data;
}

let serverDetails = await getDetails();
console.log(serverDetails);

//

import db from './sqlite.js';

await db.ready();

async function getAll(time) {
	const array = (await db.getAll(time)).map(({ time, loadavg, clients }) => {
		return [
			time,
			loadavg / 100, // Convert back to normalized load average in 0 to 1 range
			clients
		];
	});

	// console.log('ALL:', array);

	return array;
}

// Get the last ~20 status records (4 seconds x 20) = 80
console.log(await getAll(Math.floor(Date.now() / 1000) - 80));

//

import express from 'express';
import enableWs from 'express-ws';

const app = express();
const port = process.env.PORT || 3000;

const expressWs = enableWs(app);
expressWs.getWss('/');

const interval = 4000; // 4 second heartbeat
const clients = [];

//

app.use(express.static('public'));

//

// Healthcheck endpoint
app.get('/health', (req, res) => {
	res.send('UP');
});

//

app.ws('/', async (ws, req) => {
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
					case 'status': {
						const event = 'status';
						const message = {
							status: await getAll(Math.floor(Date.now() / 1000) - subscription.time),
							serverUptime,
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

	const event = 'details';
	const message = {
		details: serverDetails, // Send cached details right away
		serverUptime
	};

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

const server = app.listen(port, () => console.log(`Listening on port ${port}`));

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM signal received: closing HTTP server');
	server.close(() => {
		console.log('HTTP server closed');
	});
});

//

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

	const array = [
		currentTime,
		normalizedLoadAverage || 0,
		clients.length
	];

	// console.log('STATUS:', array);

	// Store integers for time, load average as percentage, and clients
	await db.addStatus([
		currentTime,
		normalizedLoadAverage * 100,
		clients.length
	]);

	return array;
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

async function details() {
	// Refresh cache
	serverDetails = await getDetails();

	const event = 'details';
	const message = {
		details: serverDetails
	};

	for (let i = 0, l = clients.length; i < l; i++) {
		const client = clients[i];

		if (client._subscription === 'status' && client.readyState === client.OPEN) {
			message.serverUptime = serverUptime;
			message.latency = client._latency;

			client.send(JSON.stringify({ event, message }));
		}
	}
}

async function status() {
	const event = 'status';
	const message = {
		status: await getStatus()
	};

	for (let i = 0, l = clients.length; i < l; i++) {
		const client = clients[i];

		if (client._subscription === 'status' && client.readyState === client.OPEN) {
			message.serverUptime = serverUptime;
			message.latency = client._latency;

			client.send(JSON.stringify({ event, message }));
		}
	}
}

//

import { performance } from 'node:perf_hooks';

const detailsInterval = 60000; // Update once per minute
let lastDetails = 0;

let startTime = 0;
let timeout = null;

async function onUpdate() {
	startTime = performance.now();

	if (startTime - lastDetails > detailsInterval) {
		lastDetails = startTime;
		await details();
	}

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
