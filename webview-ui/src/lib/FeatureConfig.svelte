<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-label/index.js";

	let { value = $bindable(), ...props } = $props();

	interface FeatureFlag {
		name: string;
		enabled: boolean;
	}

	function parseFeatureFlags(configString: string): FeatureFlag[] {
		if (!configString?.trim()) return [];
		
		const parts = configString.split(/\s+/).filter(part => part.trim());
		const flags: FeatureFlag[] = [];
		
		parts.forEach(part => {
			if (part.startsWith('--enable-')) {
				flags.push({
					name: part.replace('--enable-', ''),
					enabled: true
				});
			} else if (part.startsWith('--disable-')) {
				flags.push({
					name: part.replace('--disable-', ''),
					enabled: false
				});
			}
		});
		
		return flags;
	}

	function toggleFeature(featureName: string) {
		const flags = parseFeatureFlags(value || '');
		const existingIndex = flags.findIndex(f => f.name === featureName);
		
		if (existingIndex >= 0) {
			flags[existingIndex].enabled = !flags[existingIndex].enabled;
		}
		
		// Rebuild the config string
		const configParts = flags.map(flag => 
			flag.enabled ? `--enable-${flag.name}` : `--disable-${flag.name}`
		);
		
		value = configParts.join(' ');
	}

	function removeFeature(featureName: string) {
		const flags = parseFeatureFlags(value || '');
		const filteredFlags = flags.filter(f => f.name !== featureName);
		
		const configParts = filteredFlags.map(flag => 
			flag.enabled ? `--enable-${flag.name}` : `--disable-${flag.name}`
		);
		
		value = configParts.join(' ');
	}

	const featureFlags = $derived(parseFeatureFlags(value));
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<div class="feature-blocks-container">
	{#each featureFlags as flag (flag.name)}
		<div class="feature-block" class:enabled={flag.enabled} class:disabled={!flag.enabled}>
			<span class="feature-name">{flag.name}</span>
			<button class="toggle-btn" class:enabled={flag.enabled} class:disabled={!flag.enabled} onclick={() => toggleFeature(flag.name)}>
				{flag.enabled ? 'Disable' : 'Enable'}
			</button>
			<button class="remove-btn" onclick={() => removeFeature(flag.name)}>×</button>
		</div>
	{/each}
	{#if featureFlags.length === 0}
		<div class="empty-state">No feature flags configured</div>
	{/if}
</div>

<style>
	.feature-blocks-container {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
		padding: 8px;
		border: 1px solid var(--vscode-input-border);
		border-radius: 4px;
		min-height: 40px;
		background-color: var(--vscode-input-background);
	}

	.feature-block {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 4px;
		font-size: 12px;
		border: 1px solid;
		transition: all 0.2s ease;
	}

	.feature-block.enabled {
		background-color: #1f4e1f;
		border-color: #4caf50;
		color: #e8f5e8;
	}

	.feature-block.disabled {
		background-color: #4e1f1f;
		border-color: #f44336;
		color: #f5e8e8;
	}

	.feature-name {
		font-weight: 500;
		flex: 1;
	}

	.toggle-btn {
		border: 1px solid currentColor;
		color: inherit;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 10px;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.toggle-btn.enabled {
		background-color: #4e1f1f;
	}

	.toggle-btn.disabled {
		background-color: #1f4e1f;
	}

	.toggle-btn.enabled:hover {
		background-color:  #5a2a2a;
	}

	.toggle-btn.disabled:hover {
		background-color: #2a5a2a;
	}

	.remove-btn {
		background: none;
		border: none;
		color: inherit;
		padding: 2px 4px;
		border-radius: 3px;
		font-size: 14px;
		cursor: pointer;
		font-weight: bold;
		line-height: 1;
		transition: background-color 0.2s ease;
	}

	.remove-btn:hover {
		background-color: rgba(255, 255, 255, 0.2);
	}

	.empty-state {
		color: var(--vscode-input-placeholderForeground);
		font-style: italic;
		padding: 8px;
		text-align: center;
		width: 100%;
	}
</style>