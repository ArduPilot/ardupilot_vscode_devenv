<!--
	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
-->

<script lang="ts">
	import { VSCodeHooks } from './vscodeHooks';
	import { onMount } from 'svelte';
	import "@vscode-elements/elements/dist/vscode-progress-ring/index.js";

	export let vscodeHooks: VSCodeHooks;

	// Platform detection
	let showPlatformWarning = false;
	let isLoading = false;

	// Tool status
	interface ToolStatus {
		available: boolean;
		version?: string;
		path?: string;
		isCustomPath?: boolean;
		info?: string;
		status?: 'checking' | 'available' | 'missing';
	}

	interface PackageStatus {
		available: boolean;
		version?: string;
		info?: string;
		status?: 'checking' | 'available' | 'missing';
	}

	let toolStatuses: Record<string, ToolStatus> = {};
	let packageStatuses: Record<string, PackageStatus> = {};
	let summaryMessage = '';
	let summaryStatus = '';
	let showInstallPackagesButton = false;

	// Tool definitions - will be populated from extension
	let tools: Array<{ id: string; name: string }> = [];

	// Python packages - will be populated from extension
	let pythonPackages: Array<{ name: string; description?: string }> = [];

	onMount(() => {
		// Start loading state
		isLoading = true;
		
		// Initialize all tools as checking
		tools.forEach(tool => {
			toolStatuses[tool.id] = { available: false, status: 'checking' };
		});

		// Listen for messages from extension
		window.addEventListener('message', (event: MessageEvent) => {
			handleMessage(event.data);
		});

		// Request tools and packages lists first
		vscodeHooks.postMessage('getToolsList', {});
		vscodeHooks.postMessage('getPythonPackagesList', {});

		// Request initial validation
		vscodeHooks.postMessage('checkEnvironment', {});
	});

	function handleMessage(message: Record<string, any>) {
		switch (message.command) {
			case 'validationResult':
				updateToolStatus(message);
				break;
			case 'validationSummary':
				updateSummary(message);
				break;
			case 'packageResult':
				updatePackageStatus(message);
				break;
			case 'updateInstallButton':
				showInstallPackagesButton = message.show;
				break;
			case 'platformCheck':
				updatePlatformInfo(message);
				break;
			case 'pythonPackagesList':
				updatePythonPackagesList(message);
				break;
			case 'toolsList':
				updateToolsList(message);
				break;
		}
	}

	function updateToolStatus(message: Record<string, any>) {
		const { tool, available, version, path, info, isCustomPath } = message;
		toolStatuses[tool] = {
			available,
			version,
			path,
			info,
			isCustomPath,
			status: available ? 'available' : 'missing'
		};
		toolStatuses = { ...toolStatuses }; // Trigger reactivity
	}

	function updatePackageStatus(message: Record<string, any>) {
		const { package: packageName, available, version, info } = message;
		packageStatuses[packageName] = {
			available,
			version,
			info,
			status: available ? 'available' : 'missing'
		};
		packageStatuses = { ...packageStatuses }; // Trigger reactivity
	}

	function updateSummary(message: Record<string, any>) {
		summaryMessage = message.message;
		summaryStatus = message.status;
	}

	function updatePlatformInfo(message: Record<string, any>) {
		showPlatformWarning = message.platform === 'win32';
	}

	function updateToolsList(message: Record<string, any>) {
		tools = message.tools || [];
		// Initialize all tools as checking
		tools.forEach(tool => {
			toolStatuses[tool.id] = { available: false, status: 'checking' };
		});
		toolStatuses = { ...toolStatuses }; // Trigger reactivity
		isLoading = false; // Hide global loading spinner once tools are loaded
	}

	function updatePythonPackagesList(message: Record<string, any>) {
		pythonPackages = message.packages || [];
		// Initialize all packages as checking
		pythonPackages.forEach(pkg => {
			packageStatuses[pkg.name] = { available: false, status: 'checking' };
		});
		packageStatuses = { ...packageStatuses }; // Trigger reactivity
	}

	function configureToolPath(toolId: string, toolName: string) {
		vscodeHooks.postMessage('configureToolPath', { toolId, toolName });
	}

	function installTool(toolId: string) {
		vscodeHooks.postMessage('installTool', { toolId });
	}

	function selectPythonInterpreter() {
		vscodeHooks.postMessage('selectPythonInterpreter', {});
	}

	function installPythonPackages() {
		vscodeHooks.postMessage('installPythonPackages', {});
	}

	function launchWSL() {
		vscodeHooks.postMessage('launchWSL', {});
	}

	function openVSCodeWSL() {
		vscodeHooks.postMessage('openVSCodeWSL', {});
	}

	function refreshValidation() {
		// Reset all status indicators to "Checking..."
		// Only show global spinner if tools list is empty
		if (tools.length === 0) {
			isLoading = true;
		}
		tools.forEach(tool => {
			toolStatuses[tool.id] = { available: false, status: 'checking' };
		});
		pythonPackages.forEach(pkg => {
			packageStatuses[pkg.name] = { available: false, status: 'checking' };
		});
		summaryMessage = '';
		summaryStatus = '';
		toolStatuses = { ...toolStatuses };
		packageStatuses = { ...packageStatuses };

		// Request validation
		vscodeHooks.postMessage('checkEnvironment', {});
		
		// Clear loading state after a reasonable timeout (only if it was set)
		if (tools.length === 0) {
			setTimeout(() => {
				isLoading = false;
			}, 10000); // 10 seconds max
		}
	}

	function resetAllPaths() {
		vscodeHooks.postMessage('resetAllPaths', {});
	}

	function getStatusClass(status?: string): string {
		switch (status) {
			case 'checking': return 'status-checking';
			case 'available': return 'status-available';
			case 'missing': return 'status-missing';
			default: return 'status-checking';
		}
	}

	function getStatusText(status?: string): string {
		switch (status) {
			case 'checking': return 'Checking...';
			case 'available': return 'Available';
			case 'missing': return 'Missing';
			default: return 'Checking...';
		}
	}

	function getSummaryClass(): string {
		return `summary-${summaryStatus}`;
	}

</script>

<main>
	<h1>ArduPilot Environment Validation</h1>
	
	{#if isLoading}
		<div class="loading-spinner">
			<vscode-progress-ring>Validating development environment...</vscode-progress-ring>
		</div>
	{/if}
	
	{#if showPlatformWarning}
		<div class="platform-warning">
			<h2>Unsupported Platform Detected</h2>
			<p>ArduPilot development is only supported on macOS and Linux.</p>
			<p>You appear to be using Windows. Please install Windows Subsystem for Linux (WSL) to continue.</p>
			<div class="action-buttons">
				<button on:click={launchWSL}>Launch WSL Installation Guide</button>
				<button on:click={openVSCodeWSL}>Open VSCode with WSL</button>
			</div>
		</div>
	{:else}
		<div id="validation-results">
			{#each tools as tool}
				<div class="tool-container" data-tool-id={tool.id}>
						<div class="tool-header">
							<div class="tool-name">{tool.name}</div>
							{#if toolStatuses[tool.id]?.status === 'checking'}
								<vscode-progress-ring class="tool-progress-ring"></vscode-progress-ring>
							{:else}
								<div class="tool-status {getStatusClass(toolStatuses[tool.id]?.status)}">
									{getStatusText(toolStatuses[tool.id]?.status)}
								</div>
							{/if}
						</div>
						
						{#if toolStatuses[tool.id]?.version}
							<div class="tool-version">Version: {toolStatuses[tool.id].version}</div>
						{/if}
						
						<div class="tool-path">
							{#if toolStatuses[tool.id]?.path}
								<div class="tool-path-text">Path: {toolStatuses[tool.id].path}</div>
							{/if}
							
							{#if tool.id === 'python'}
								<button class="config-button select-interpreter-btn" on:click={selectPythonInterpreter}>
									Select Interpreter
								</button>
							{:else}
								<button class="config-button config-path-btn" on:click={() => configureToolPath(tool.id, tool.name)}>
									Configure Path
								</button>
							{/if}
							
							{#if !toolStatuses[tool.id]?.available}
								<button class="install-button" on:click={() => installTool(tool.id)}>
									Install
								</button>
							{/if}
						</div>
						
						{#if toolStatuses[tool.id]?.isCustomPath}
							<div class="custom-path-notification">Using custom configured path</div>
						{/if}
						
						{#if tool.id === 'python'}
							<div class="python-packages">
								{#each pythonPackages as pkg}
									<div class="package-item" data-package={pkg.name}>
										<div>
											<div class="package-name">{pkg.name}</div>
											{#if packageStatuses[pkg.name]?.version && packageStatuses[pkg.name]?.available}
												<div class="package-version">v{packageStatuses[pkg.name].version}</div>
											{/if}
										</div>
										{#if packageStatuses[pkg.name]?.status === 'checking'}
											<vscode-progress-ring class="package-progress-ring"></vscode-progress-ring>
										{:else}
											<div class="package-status {getStatusClass(packageStatuses[pkg.name]?.status)}">
												{getStatusText(packageStatuses[pkg.name]?.status)}
											</div>
										{/if}
									</div>
								{/each}
								
								{#if showInstallPackagesButton}
									<button class="install-packages-button" on:click={installPythonPackages}>
										Install Missing Packages in Terminal
									</button>
								{/if}
							</div>
						{/if}
						
						{#if toolStatuses[tool.id]?.info}
							<div class="tool-info">{@html toolStatuses[tool.id].info}</div>
						{/if}
				</div>
			{/each}
			
			{#if summaryMessage}
				<div id="summary" class={getSummaryClass()}>
					{summaryMessage}
				</div>
			{/if}
			
			<div class="action-buttons">
				<button on:click={refreshValidation}>Refresh Validation</button>
				<button on:click={resetAllPaths}>Reset All Paths</button>
			</div>
		</div>
	{/if}
</main>

<style>
	/* Replicate the exact styles from the original HTML */
	main {
		font-family: var(--vscode-font-family);
		padding: 20px;
		color: var(--vscode-foreground);
		background-color: var(--vscode-editor-background);
	}
	
	h1 {
		color: var(--vscode-editor-foreground);
		font-size: 24px;
		margin-bottom: 20px;
	}
	
	.tool-container {
		margin-bottom: 20px;
		padding: 10px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 5px;
	}
	
	.tool-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	
	.tool-name {
		font-weight: bold;
		font-size: 16px;
	}
	
	.tool-status {
		font-size: 14px;
		padding: 3px 8px;
		border-radius: 3px;
	}
	
	.status-checking {
		background-color: #5c5c5c;
		color: white;
	}
	
	.status-available {
		background-color: #388a34;
		color: white;
	}
	
	.status-missing {
		background-color: #cc2222;
		color: white;
	}
	
	.install-button {
		background-color: #007acc;
		color: white;
		border: none;
		padding: 4px 8px;
		border-radius: 2px;
		cursor: pointer;
		font-size: 12px;
		margin-left: 5px;
		margin-top: 0;
	}
	
	.install-button:hover {
		background-color: #005a9e;
	}
	
	.tool-version {
		margin-top: 5px;
		font-size: 14px;
		color: var(--vscode-descriptionForeground);
	}
	
	.tool-path {
		margin-top: 5px;
		font-size: 14px;
		color: var(--vscode-descriptionForeground);
		word-break: break-all;
		display: flex;
		align-items: center;
	}
	
	.tool-path-text {
		flex-grow: 1;
		margin-right: 10px;
	}
	
	button {
		background-color: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		padding: 8px 12px;
		border-radius: 2px;
		cursor: pointer;
		font-size: 14px;
		margin-top: 5px;
		margin-right: 5px;
	}
	
	button:hover {
		background-color: var(--vscode-button-hoverBackground);
	}
	
	.config-button {
		padding: 4px 8px;
		font-size: 12px;
		margin-top: 0;
	}
	
	.action-buttons {
		margin-top: 20px;
		display: flex;
		gap: 10px;
	}
	
	#summary {
		margin-top: 20px;
		padding: 10px;
		border-radius: 5px;
		font-weight: bold;
	}
	
	.summary-ok {
		background-color: rgba(56, 138, 52, 0.1);
		border: 1px solid #388a34;
	}
	
	.summary-warning {
		background-color: rgba(204, 129, 0, 0.1);
		border: 1px solid #cc8100;
	}
	
	.summary-error {
		background-color: rgba(204, 34, 34, 0.1);
		border: 1px solid #cc2222;
	}
	
	.tool-info {
		margin-top: 5px;
		font-size: 14px;
		color: var(--vscode-descriptionForeground);
	}
	
	.custom-path-notification {
		font-style: italic;
		color: var(--vscode-notificationsInfoIcon-foreground);
		margin-top: 5px;
		font-size: 12px;
	}
	
	.python-packages {
		margin-top: 10px;
		margin-left: 20px;
		border-left: 2px solid var(--vscode-panel-border);
		padding-left: 15px;
	}
	
	.package-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
		padding: 5px 8px;
		border-radius: 3px;
		background-color: var(--vscode-editor-background);
	}
	
	.package-name {
		font-size: 14px;
		font-weight: 500;
	}
	
	.package-status {
		font-size: 12px;
		padding: 2px 6px;
		border-radius: 2px;
	}
	
	.package-version {
		font-size: 12px;
		color: var(--vscode-descriptionForeground);
		margin-top: 2px;
	}
	
	.install-packages-button {
		background-color: #007acc;
		color: white;
		border: none;
		padding: 6px 12px;
		border-radius: 3px;
		cursor: pointer;
		font-size: 12px;
		margin-top: 8px;
	}
	
	.install-packages-button:hover {
		background-color: #005a9e;
	}
	
	.platform-warning {
		margin-bottom: 20px;
		padding: 15px;
		background-color: rgba(204, 34, 34, 0.1);
		border: 1px solid #cc2222;
		border-radius: 5px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	
	.platform-warning h2 {
		margin-top: 0;
		color: #cc2222;
	}
	
	.loading-spinner {
		display: flex;
		justify-content: center;
		margin: 40px 0;
	}
	
	.tool-progress-ring {
		--vscode-progress-ring-size: 16px;
	}
	
	.package-progress-ring {
		--vscode-progress-ring-size: 12px;
	}
</style>