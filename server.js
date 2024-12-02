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
	// const pastDaySeconds = Math.floor(Date.now() / 1000) - 86400; // 24 x 60 x 60

	const data = (await db.getAll(time)).map(({ time, uptime, loadavg }) => {
		return [
			time,
			uptime,
			loadavg / 100 // Convert back to normalized load average in 0 to 1 range
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

	const data = {
		serverVersion: `Node/${process.versions.node} (${osRelease})`,
		currentTime,
		restartTime: currentTime - serverUptime,
		serverUptime,
		normalizedLoadAverage,
		numProcessingUnits
	};

	// console.log('STATUS:', data);

	// Store integers for time, uptime, and load average as percentage
	await db.addStatus([currentTime, serverUptime, normalizedLoadAverage * 100]);

	return data;
}

function add(ws, subscription) {
	clients.push(ws);

	ws._subscription = subscription;
}

function remove(ws) {
	const index = clients.indexOf(ws);

	if (~index) {
		clients.splice(index, 1);
	}
}

async function status() {
	const event = 'server-status';
	const message = await getStatus();

	for (let i = 0, l = clients.length; i < l; i++) {
		const client = clients[i];

		if (client._subscription === event && client.readyState === client.OPEN) {
			client.send(JSON.stringify({ event, message }));
		}
	}
}

app.ws('/', (ws, request) => {
	ws.on('close', () => {
		remove(ws);
	});

	ws.on('message', data => {
		data = JSON.parse(data);

		switch (data.event) {
			case 'subscribe': {
				const { subscription } = data.message;
				// console.log('SUBSCRIBE:', subscription);

				add(ws, subscription);
				break;
			}
		}
	});
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
