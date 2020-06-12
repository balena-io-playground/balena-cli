/**
 * @license
 * Copyright 2019-2020 Balena Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// tslint:disable-next-line:no-var-requires
require('./config-tests'); // required for side effects

import { execFile } from 'child_process';
import intercept = require('intercept-stdout');
import * as _ from 'lodash';
import * as nock from 'nock';
import * as path from 'path';

import * as balenaCLI from '../build/app';
import { setupSentry } from '../build/app-common';

interface TestOutput {
	err: string[]; // stderr
	out: string[]; // stdout
	exitCode?: number; // process.exitCode
}

function filterCliOutputForTests(testOutput: TestOutput): TestOutput {
	return {
		exitCode: testOutput.exitCode,
		err: testOutput.err.filter(
			(line: string) =>
				!line.match(/\[debug\]/i) &&
				// TODO stop this warning message from appearing when running
				// sdk.setSharedOptions multiple times in the same process
				!line.startsWith('Shared SDK options') &&
				// Node 12: '[DEP0066] DeprecationWarning: OutgoingMessage.prototype._headers is deprecated'
				!line.includes('[DEP0066]'),
		),
		out: testOutput.out.filter((line: string) => !line.match(/\[debug\]/i)),
	};
}

async function runCommanInProcess(cmd: string): Promise<TestOutput> {
	const preArgs = [process.argv[0], path.join(process.cwd(), 'bin', 'balena')];

	const err: string[] = [];
	const out: string[] = [];

	const stdoutHook = (log: string | Buffer) => {
		if (typeof log === 'string') {
			out.push(log);
		}
	};
	const stderrHook = (log: string | Buffer) => {
		if (typeof log === 'string') {
			err.push(log);
		}
	};
	const unhookIntercept = intercept(stdoutHook, stderrHook);

	try {
		await balenaCLI.run(preArgs.concat(cmd.split(' ')), {
			noFlush: true,
		});
	} finally {
		unhookIntercept();
	}
	return filterCliOutputForTests({
		err,
		out,
		// this makes sense if `process.exit()` was stubbed with sinon
		exitCode: process.exitCode,
	});
}

/**
 * Run the command (e.g. `balena xxx args`) in a child process, instead of
 * the same process as mocha. This is slow and does not allow mocking the
 * source code, but it is useful for testing the standalone zip package binary.
 * (Every now and then, bugs surface because of missing entries in the
 * `pkg.assets` section of `package.json`, usually because of updated
 * dependencies that don't clearly declare the have compatibility issues
 * with `pkg`.)
 *
 * `mocha` runs on the parent process, and many of the tests inspect network
 * traffic intercepted with `nock`. But this interception only works in the
 * parent process itself. To get around this, we run a HTTP proxy server on
 * the parent process, and get the child process to use it (the CLI has
 * support for proxy servers as a product feature, and this testing arrangement
 * also exercises the proxy capabilities).
 *
 * @param cmd e.g. 'push test-rpi'
 * @param proxyPort TCP port number for the HTTP proxy server running on the
 * parent process
 */
async function runCommandInSubprocess(
	cmd: string,
	proxyPort: number,
): Promise<TestOutput> {
	const binPath = path.resolve(__dirname, '..', 'build-bin', 'balena');
	let exitCode = 0;
	let stdout = '';
	let stderr = '';

	const addedEnvs = {
		// Use http instead of https, so we can intercept and test the data,
		// for example the contents of tar streams sent by the CLI to Docker
		BALENARC_API_URL: 'http://api.balena-cloud.com',
		BALENARC_BUILDER_URL: 'http://builder.balena-cloud.com',
		BALENARC_PROXY: `http://127.0.0.1:${proxyPort}`,
		// override default proxy exclusion to allow proxying to private IP addresses
		BALENARC_NO_PROXY: 'nono',
	};
	await new Promise(resolve => {
		// const output = await execFile(binPath, cmd.split(' '), opts, cb)
		const child = execFile(
			binPath, // node,
			cmd.split(' '), // [binPath, ...cmd.split(' ')],
			{ env: { ...process.env, ...addedEnvs } },
			($error, $stdout, $stderr) => {
				stderr = $stderr || '';
				stdout = $stdout || '';
				if ($error) {
					console.error(`
Error (possibly expected) executing child process "${binPath}"
The child's stdout and stderr were captured anyway.`);
					if (process.env.DEBUG) {
						console.error(`Full error output:
------------------------------------------------------------------
${$error}
------------------------------------------------------------------`);
					} else {
						console.error(
							'Set the DEBUG env var to see the full error output.',
						);
					}
				}
				resolve();
			},
		);
		child.on('exit', (code: number, signal: string) => {
			if (process.env.DEBUG) {
				console.error(
					`CLI child process exited with code=${code} signal=${signal}`,
				);
			}
			exitCode = code;
		});
	});

	const splitLines = (lines: string) =>
		lines
			.split(/[\r\n]/) // includes '\r' in isolation, used in progress bars
			.filter(l => l)
			.map(l => l + '\n');

	return filterCliOutputForTests({
		exitCode,
		err: splitLines(stderr),
		out: splitLines(stdout),
	});
}

export async function runCommand(cmd: string): Promise<TestOutput> {
	if (process.env.BALENA_CLI_TEST_TYPE === 'standalone') {
		const proxy = await import('./proxy-server');
		const proxyPort = await proxy.createProxyServerOnce();
		return runCommandInSubprocess(cmd, proxyPort);
	} else {
		return runCommanInProcess(cmd);
	}
}

export const balenaAPIMock = () => {
	if (!nock.isActive()) {
		nock.activate();
	}

	return nock(/./)
		.get('/config/vars')
		.reply(200, {
			reservedNames: [],
			reservedNamespaces: [],
			invalidRegex: '/^d|W/',
			whiteListedNames: [],
			whiteListedNamespaces: [],
			blackListedNames: [],
			configVarSchema: [],
		});
};

export function cleanOutput(output: string[] | string): string[] {
	return _(_.castArray(output))
		.map((log: string) => {
			return log.split('\n').map(line => {
				return monochrome(line.trim());
			});
		})
		.flatten()
		.compact()
		.value();
}

/**
 * Remove text colors (ASCII escape sequences). Example:
 * Input: '\u001b[2K\r\u001b[34m[Build]\u001b[39m   \u001b[1mmain\u001b[22m Image size: 1.14 MB'
 * Output: '[Build]   main Image size: 1.14 MB'
 *
 * TODO: check this function against a spec (ASCII escape sequences). It was
 * coded from observation of a few samples only, and may not cover all cases.
 */
export function monochrome(text: string): string {
	return text.replace(/\u001b\[\??\d+?[a-zA-Z]\r?/g, '');
}

/**
 * Dynamic template string resolution.
 * Usage example:
 *     const templateString = 'hello ${name}!';
 *     const templateVars = { name: 'world' };
 *     console.log( fillTemplate(templateString, templateVars) );
 *     // hello world!
 */
export function fillTemplate(
	templateString: string,
	templateVars: object,
): string {
	const escaped = templateString.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
	const resolved = new Function(
		...Object.keys(templateVars),
		`return \`${escaped}\`;`,
	).call(null, ...Object.values(templateVars));
	const unescaped = resolved.replace(/\\`/g, '`').replace(/\\\\/g, '\\');
	return unescaped;
}

export function fillTemplateArray(
	templateStringArray: string[],
	templateVars: object,
): string[];
export function fillTemplateArray(
	templateStringArray: Array<string | string[]>,
	templateVars: object,
): Array<string | string[]>;
export function fillTemplateArray(
	templateStringArray: Array<string | string[]>,
	templateVars: object,
): Array<string | string[]> {
	return templateStringArray.map(i =>
		Array.isArray(i)
			? fillTemplateArray(i, templateVars)
			: fillTemplate(i, templateVars),
	);
}

export async function switchSentry(
	enabled: boolean | undefined,
): Promise<boolean | undefined> {
	const sentryOpts = (await setupSentry()).getClient()?.getOptions();
	if (sentryOpts) {
		const sentryStatus = sentryOpts.enabled;
		sentryOpts.enabled = enabled;
		return sentryStatus;
	}
}
