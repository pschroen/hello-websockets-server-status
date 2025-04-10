/**
 * @author pschroen / https://ufo.ai/
 *
 * Remix of https://glitch.com/edit/#!/glitch-blank-sqlite
 * Remix of https://glitch.com/edit/#!/glitch-hello-sqlite
 */

import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const filename = './.data/database.db';
const exists = fs.existsSync(filename);
let db;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
let resolve, reject;
const promise = new Promise((res, rej) => {
	resolve = res;
	reject = rej;
});

open({
	filename,
	driver: sqlite3.Database
}).then(async dBase => {
	db = dBase;

	try {
		if (!exists) {
			await db.run('CREATE TABLE Status (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, loadavg INTEGER, clients INTEGER)');
		}
		resolve();
	} catch (err) {
		console.error(err);
	}
});

export default {
	addStatus: async array => {
		try {
			return await db.run('INSERT INTO Status (time, loadavg, clients) VALUES (?, ?, ?)', array);
		} catch (err) {
			console.error(err);
		}
	},
	getAll: async time => {
		try {
			return await db.all('SELECT * from Status WHERE time >= ?', time);
		} catch (err) {
			console.error(err);
		}
	},
	ready: () => promise
};
