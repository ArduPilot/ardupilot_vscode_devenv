/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as assert from 'assert';
import { parseProgressLine, truncateStepText, scanForCompletion, analyzeBuildOutputLine } from '../../lib/buildProgressParser';

suite('apBuildProgress Parser Test Suite', () => {
	suite('parseProgressLine', () => {
		test('parses standard [X/Y] with message', () => {
			const res = parseProgressLine('[12/233] Compiling AP_Compass.cpp');
			assert.ok(res);
			assert.strictEqual(res?.currentStep, 12);
			assert.strictEqual(res?.totalSteps, 233);
			assert.strictEqual(res?.percentComplete, (12 / 233) * 100);
			assert.ok(res?.stepText?.startsWith('Compiling'));
		});

		test('parses with padding inside brackets', () => {
			const res = parseProgressLine('[  5/10] Linking firmware.elf');
			assert.ok(res);
			assert.strictEqual(res?.currentStep, 5);
			assert.strictEqual(res?.totalSteps, 10);
			assert.strictEqual(res?.percentComplete, 50);
		});

		test('returns undefined on non-matching line', () => {
			const res = parseProgressLine('Waf: Entering directory "/tmp/foo"');
			assert.strictEqual(res, undefined);
		});

		test('truncates long message in parseProgressLine', () => {
			const longMsg = 'A'.repeat(200);
			const res = parseProgressLine(`[1/10] ${longMsg}`);
			assert.ok(res);
			assert.ok(res?.stepText);
			// Default max length is 80
			assert.strictEqual(res?.stepText?.length, 80);
			assert.ok(res?.stepText?.endsWith('...'));
		});

		test('handles zero total without NaN percent', () => {
			const res = parseProgressLine('[3/0] Compiling foo');
			assert.ok(res);
			assert.strictEqual(res?.percentComplete, undefined);
		});
	});

	suite('truncateStepText', () => {
		test('keeps short text as-is', () => {
			assert.strictEqual(truncateStepText('Short text', 80), 'Short text');
		});

		test('truncates long text with ellipsis', () => {
			const long = 'x'.repeat(200);
			const out = truncateStepText(long, 80);
			assert.strictEqual(out.length, 80);
			assert.ok(out.endsWith('...'));
		});
	});

	suite('scanForCompletion', () => {
		test('detects success string', () => {
			const { success, failure } = scanForCompletion('Waf: finished successfully in 12.34s');
			assert.strictEqual(success, true);
			assert.strictEqual(failure, false);
		});

		test('detects failure string', () => {
			const { success, failure } = scanForCompletion('Build failed');
			assert.strictEqual(success, false);
			assert.strictEqual(failure, true);
		});
	});

	suite('analyzeBuildOutputLine', () => {
		test('combines progress and completion scan', () => {
			const r1 = analyzeBuildOutputLine('[1/2] Compiling foo');
			assert.ok(r1.progress);
			assert.strictEqual(r1.isSuccess, false);
			assert.strictEqual(r1.isFailure, false);

			const r2 = analyzeBuildOutputLine('Waf: finished successfully');
			assert.strictEqual(r2.progress, undefined);
			assert.strictEqual(r2.isSuccess, true);
		});
	});
});
