/*
	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Copyright (c) 2025 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

export interface BuildProgress {
	currentStep?: number;
	totalSteps?: number;
	percentComplete?: number;
	stepText?: string;
}

export interface BuildScanResult {
	progress?: BuildProgress;
	isSuccess?: boolean;
	isFailure?: boolean;
}

const BRACKET_PROGRESS = /^\[\s*(\d+)\/(\d+)\]\s+(.+)$/;
const SUCCESS_RE = /finished successfully/i;
const FAILURE_RE = /build failed/i;

export function parseProgressLine(line: string): BuildProgress | undefined {
	const match = BRACKET_PROGRESS.exec(line.trim());
	if (!match) {
		return undefined;
	}
	const current = Number(match[1]);
	const total = Number(match[2]);
	const rawText = match[3];

	const percent = total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : undefined;
	return {
		currentStep: current,
		totalSteps: total,
		percentComplete: percent,
		stepText: truncateStepText(rawText)
	};
}

export function truncateStepText(text: string, maxLength: number = 80): string {
	if (text.length <= maxLength) {
		return text;
	}
	if (maxLength <= 3) {
		return text.slice(0, maxLength);
	}
	return text.slice(0, maxLength - 3) + '...';
}

export function scanForCompletion(textChunk: string): { success: boolean; failure: boolean } {
	return {
		success: SUCCESS_RE.test(textChunk),
		failure: FAILURE_RE.test(textChunk)
	};
}

export function analyzeBuildOutputLine(line: string): BuildScanResult {
	const progress = parseProgressLine(line);
	const { success, failure } = scanForCompletion(line);
	return {
		progress,
		isSuccess: success,
		isFailure: failure
	};
}

