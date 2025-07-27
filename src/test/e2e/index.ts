import * as path from 'path';
import * as Mocha from 'mocha';
import * as sourceMapSupport from 'source-map-support';
import { existsSync } from 'fs';

export async function run(): Promise<void> {
	sourceMapSupport.install();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		timeout: 2400000 // 40 minutes timeout for E2E tests
	});

	const testsRoot = path.resolve(__dirname);

	// Run the mocha test
	return new Promise<void>((c, e) => {
		// Check which test files to run based on environment variable
		const testMode = process.env.E2E_TEST_MODE || 'all';
		const testFiles: string[] = [];

		if (testMode === 'clone' || testMode === 'all') {
			testFiles.push('toolInstallationAndClone.test.js');
		}
		if (testMode === 'build' || testMode === 'all') {
			testFiles.push('ardupilotBuild.test.js');
		}

		// Verify test files exist
		for (const testFile of testFiles) {
			if (!existsSync(path.join(testsRoot, testFile))) {
				e(new Error(`E2E test file ${testFile} does not exist in ${testsRoot}`));
				return;
			}
			mocha.addFile(path.resolve(testsRoot, testFile));
		}

		if (testFiles.length === 0) {
			e(new Error(`No test files specified for E2E_TEST_MODE: ${testMode}`));
			return;
		}

		console.log(`Running E2E tests in mode: ${testMode}, files: ${testFiles.join(', ')}`);

		try {
			mocha.run(failures => {
				if (failures > 0) {
					e(new Error(`${failures} E2E tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
