/**
 * @author pschroen / https://ufo.ai/
 *
 * Remix of https://glitch.com/edit/#!/hello-express
 * Remix of https://glitch.com/edit/#!/multiuser-sketchpad
 */

import config from './package.json' with { type: 'json' };
import { promisify } from 'node:util';
import child_process from 'node:child_process';
const exec = promisify(child_process.exec);

let osRelease;
let processorName;
let numProcessingUnits;
let memTotal;
let memAvailable;
let swapTotal;
let swapFree;
let storageTotal;
let storageAvailable;
let ipinfo;
let serverUptime;
let normalizedLoadAverage;

try {
	osRelease = (await exec('cat /etc/issue')).stdout;
	osRelease = osRelease.split(' ')[0];
} catch (err) {
	console.warn(err.stderr);
}

try {
	processorName = (await exec('lscpu | sed -nr "/Model name/ s/.*:\\s*(.*)/\\1/p"')).stdout;
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
	memTotal = (await exec('sed -n "/^MemTotal:/ s/[^0-9]//gp" /proc/meminfo')).stdout;
	memTotal = Number(memTotal) / 1024 / 1024;
	memTotal = Math.round((memTotal + Number.EPSILON) * 100) / 100;
} catch (err) {
	console.warn(err.stderr);
}

try {
	memAvailable = (await exec('sed -n "/^MemAvailable:/ s/[^0-9]//gp" /proc/meminfo')).stdout;
	memAvailable = Number(memAvailable) / 1024 / 1024;
	memAvailable = Math.round((memAvailable + Number.EPSILON) * 100) / 100;
} catch (err) {
	console.warn(err.stderr);
}

try {
	swapTotal = (await exec('sed -n "/^SwapTotal:/ s/[^0-9]//gp" /proc/meminfo')).stdout;
	swapTotal = Number(swapTotal) / 1024 / 1024;
	swapTotal = Math.round((swapTotal + Number.EPSILON) * 100) / 100;
} catch (err) {
	console.warn(err.stderr);
}

try {
	swapFree = (await exec('sed -n "/^SwapFree:/ s/[^0-9]//gp" /proc/meminfo')).stdout;
	swapFree = Number(swapFree) / 1024 / 1024;
	swapFree = Math.round((swapFree + Number.EPSILON) * 100) / 100;
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

try {
	ipinfo = (await exec('curl https://ipinfo.io/')).stdout;
	ipinfo = JSON.parse(ipinfo);
} catch (err) {
	console.warn(err.stderr);
}

async function getDetails() {
	const data = {
		projectName: config.name,
		serverName: `${config.name}.glitch.me`,
		networkName: `${ipinfo.hostname} (${ipinfo.ip})`,
		serverVersion: `Node/${process.versions.node} (${osRelease})`,
		processorName,
		numProcessingUnits,
		memTotal,
		memAvailable,
		swapTotal,
		swapFree,
		storageTotal,
		storageAvailable
	};

	// console.log('DETAILS:', data);

	return data;
}

const serverDetails = await getDetails();
console.log(serverDetails);

//

import db from './sqlite.js';

await db.ready();

// Get the last ~20 status records (4 seconds x 20) = 80
console.log(await getAll(Math.floor(Date.now() / 1000) - 80));

//

import express from 'express';
import enableWs from 'express-ws';

const interval = 4000; // 4 second heartbeat

const app = express();
const expressWs = enableWs(app);
expressWs.getWss('/');

app.use(express.static('public'));

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
	const message = serverDetails;

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

import { performance } from 'node:perf_hooks';

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
