<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-single-select/index.js";
	import "@vscode-elements/elements/dist/vscode-collapsible/index.js";
	import "@vscode-elements/elements/dist/vscode-option/index.js";

	let { value = $bindable(), ...props } = $props();
	let targetsList: any;

	$effect(() => {
		targetsList?.addEventListener("change", () => {
			value = targetsList.value;
		});
	});
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<vscode-single-select bind:this={targetsList} id={props.id} {value} combobox>
	{#each props.targets as targets}
		{#if targets === value}
			<vscode-option value={targets} selected>{targets}</vscode-option>
		{:else}
			<vscode-option value={targets}>{targets}</vscode-option>
		{/if}
	{/each}
</vscode-single-select>
