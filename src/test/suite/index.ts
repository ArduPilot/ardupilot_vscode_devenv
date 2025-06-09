import * as path from 'path';
import * as Mocha from 'mocha';
import * as sourceMapSupport from 'source-map-support';
import { existsSync } from 'fs';

export async function run(): Promise<void> {
	sourceMapSupport.install();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		timeout: 600000 // 10 minutes timeout
	});

	const testsRoot = path.resolve(__dirname, '..');
	const testSuite = process.env.TEST_SUITE;

	// Run the mocha test
	return new Promise<void>((c, e) => {
		const testFile = `suite/${testSuite}.test.js`;
		if (!existsSync(path.join(testsRoot, testFile))) {
			e(new Error(`Test file ${testFile} does not exist in ${testsRoot}`));
			return;
		}
		mocha.addFile(path.resolve(testsRoot, testFile));
		try {
			mocha.run(failures => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
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
