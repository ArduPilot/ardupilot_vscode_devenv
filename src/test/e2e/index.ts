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
		const testFile = 'toolInstallationAndBuild.test.js';
		if (!existsSync(path.join(testsRoot, testFile))) {
			e(new Error(`E2E test file ${testFile} does not exist in ${testsRoot}`));
			return;
		}
		mocha.addFile(path.resolve(testsRoot, testFile));
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
