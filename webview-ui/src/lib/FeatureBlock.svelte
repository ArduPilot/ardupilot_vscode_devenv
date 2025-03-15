<!-- collapsible block with checkboxes -->
<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-collapsible/index.js";
	import "@vscode-elements/elements/dist/vscode-checkbox/index.js";
	let { selected = $bindable(), features, ...props } = $props();

	let checkbox: { [feature: string]: any } = $state({});
	let mainCheckbox: any = $state(null);

	$effect(() => {
		Object.keys(checkbox).forEach((key) => {
			checkbox[key].addEventListener("change", () => {
				if (checkbox[key].checked) {
					selected = selected.filter(
						(item: string) => item !== `!${key}`,
					);
					selected = [...selected, key];
				} else {
					selected = selected.filter((item: string) => item !== key);
					selected = [...selected, `!${key}`];
				}
				console.log(selected);
				// check if all checkboxes are checked
				var mainCheckbox = document.getElementById(
					features[0].category,
				);
				if (mainCheckbox) {
					if (selected.length === features.length) {
						mainCheckbox.checked = true;
					} else if (selected.length === 0) {
						mainCheckbox.checked = false;
					} else {
						mainCheckbox.indeterminate = true;
					}
				}
			});
		});
	});

	function updateMainCheckbox(mainCheckbox: any) {
		let selectedFiltered: string[] = [];
		for (const feature of features) {
			if (selected.includes(feature.define)) {
				selectedFiltered = [...selectedFiltered, feature.define];
			}
		}
		// check if all features in the selected list
		if (selectedFiltered.length === features.length) {
			mainCheckbox.checked = true;
			mainCheckbox.indeterminate = false;
		} else if (selectedFiltered.length === 0) {
			mainCheckbox.checked = false;
			mainCheckbox.indeterminate = false;
		} else {
			mainCheckbox.indeterminate = true;
		}
	}

	$effect(() => {
		if (mainCheckbox) {
			mainCheckbox.addEventListener("change", () => {});
			updateMainCheckbox(mainCheckbox);
		}
	});
</script>

<div class="feature-block">
	<vscode-checkbox class="feature-checkbox" bind:this={mainCheckbox}
	></vscode-checkbox>
	<vscode-collapsible class="collapsible-block" title={features[0].category}>
		{#each features as feature}
			<div class="checkbox-item">
				{#if selected.includes(feature.define)}
					<vscode-checkbox
						bind:this={checkbox[feature.define]}
						value={feature.define}
						checked>{feature.description}</vscode-checkbox
					>
				{:else}
					<vscode-checkbox
						bind:this={checkbox[feature.define]}
						value={feature.define}
						>{feature.description}</vscode-checkbox
					>
				{/if}
			</div>
		{/each}
	</vscode-collapsible>
</div>

<style>
	.feature-block {
		padding: 5px;
		width: 300px;
		background-color: var(--vscode-sideBar-background);
	}
	.feature-checkbox {
		display: inline-block;
		height: 100%;
		vertical-align: top;
	}
	.collapsible-block {
		display: inline-block;
		height: 100%;
		width: 75%;
		vertical-align: middle;
	}
	.checkbox-item {
		padding: 2px;
	}
</style>
