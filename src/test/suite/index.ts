import * as path from 'path';
import * as Mocha from 'mocha';
import * as fg from 'fast-glob';
import * as sourceMapSupport from 'source-map-support';

export async function run(): Promise<void> {
	sourceMapSupport.install();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd'
	});

	const testsRoot = path.resolve(__dirname, '..');
	const testSuiteFilter = process.env.TEST_SUITE_FILTER;

	// Run the mocha test
	return new Promise<void>((c, e) => {
		let globPattern = '**/**.test.js';

		// If a specific test suite is requested, filter for that file
		if (testSuiteFilter) {
			// Support both with and without .test extension
			const testFileName = testSuiteFilter.endsWith('.test') ? testSuiteFilter : `${testSuiteFilter}.test`;
			globPattern = `**/${testFileName}.js`;
			console.log(`Filtering tests for suite: ${testSuiteFilter} (pattern: ${globPattern})`);
		}

		fg(globPattern, {
			cwd: testsRoot,
			absolute: false
		}).then(files => {
			if (files.length === 0) {
				if (testSuiteFilter) {
					e(new Error(`No test files found matching pattern: ${globPattern}. Available test suites: apActions, apBuildConfig, apBuildConfigPanel, apCloneArdupilot, apConnectedDevices, apEnvironmentValidator, apLaunch, apLog, apProgramUtils, apToolsConfig, apUIHooks, apWelcomeItem, apWelcomeProvider, extension, taskProvider`));
				} else {
					e(new Error('No test files found.'));
				}
				return;
			}

			console.log(`Found ${files.length} test file(s):`, files);

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
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
		}).catch (err => {
			console.error(err);
			e(err);
		});
	});
}
